import type { Config } from '@sm-rn/shared/schemas'
import { normalizeImageForVision } from './image-format'
import { createLogger } from './logger'

const logger = createLogger('ocr')

export interface ExtractionContext {
  existingTags?: string[]
  // Paperless-NGX's own OCR'd text for this document (opt-in per workflow -
  // see Workflow.includeOcrText), included as additional grounding
  // alongside the image. Not necessarily correct - faded thermal receipts
  // in particular can OCR badly - so the model is told to treat it as
  // reference, not as an authority to blindly trust over the image.
  ocrText?: string
  // When set, extraction logs (including the raw AI response) are tagged
  // with this document so they show up in its own log view, not just
  // stdout. Omitted for Test Extraction, which has no real document.
  documentId?: number
}

/**
 * Ensures a base URL ends with /v1, as required by the OpenAI-compatible
 * chat completions endpoint this module calls directly via fetch(). Users
 * commonly supply a "plain" host (e.g. Ollama's own docs show just
 * `http://host:11434`), so this normalizes either form.
 */
function withV1(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

/** Derive the chat completions base URL and API key from config. */
export function resolveEndpoint(config: Config): {
  baseURL: string
  apiKey: string
  model: string
} {
  const { ai } = config
  switch (ai.provider) {
    case 'openai-compat':
      if (!ai.apiKey) throw new Error('AI API key is required for openai-compat provider.')
      return {
        baseURL: withV1(ai.baseURL || 'https://api.openai.com/v1'),
        apiKey: ai.apiKey,
        model: ai.model,
      }
    case 'together-ai':
      if (!ai.apiKey) throw new Error('AI API key is required for Together AI provider.')
      return {
        baseURL: withV1(ai.baseURL || 'https://api.together.xyz/v1'),
        apiKey: ai.apiKey,
        model: ai.model,
      }
    case 'openrouter':
      if (!ai.apiKey) throw new Error('AI API key is required for openrouter provider.')
      return {
        baseURL: withV1(ai.baseURL || 'https://openrouter.ai/api/v1'),
        apiKey: ai.apiKey,
        model: ai.model,
      }
    case 'ollama':
      return {
        baseURL: withV1(ai.baseURL || 'http://localhost:11434'),
        apiKey: 'ollama',
        model: ai.model,
      }
    default:
      throw new Error(`Unknown AI provider: ${(ai as any).provider}`)
  }
}

/**
 * Wraps the user's schema in a top-level `documents` array wrapper, which is required
 * because response_format/json_schema must describe a single root object (not an array).
 *
 * Deliberately NOT called `items` - the receipt schema has its own `line_items` field for
 * products, and a wrapper literally named "items" (described as "one entry per item") reads
 * as a synonym for that to a smaller model. Observed in practice: a 7B model would flatten
 * the receipt's fields onto a separate wrapper entry per PRODUCT ("PET TOY", "FLOPPY PUPPY", ...)
 * instead of one receipt entry with a nested line_items array - ballooning output size ~20x
 * and blowing past the model's own output token limit mid-response.
 */
function buildResponseSchema(itemSchema: any): any {
  // Strip $schema (Zod v4 emits 2020-12) — providers may reject unknown meta-schema keys
  const { $schema: _ignored, ...cleanItemSchema } = itemSchema
  return {
    type: 'object',
    properties: {
      documents: {
        type: 'array',
        items: cleanItemSchema,
        description:
          "One entry per separate document/receipt visible in the image - almost always exactly one. Do NOT create a separate entry per product or line item here; those belong nested inside this schema's own line_items field, if it has one.",
      },
    },
    required: ['documents'],
    additionalProperties: false,
  }
}

/**
 * Generic extraction engine that uses a JSON Schema to extract structured data from an image.
 *
 * Uses `response_format: { type: "json_schema" }` on the /v1/chat/completions endpoint —
 * this is the proper structured outputs API supported by all OpenAI-compatible providers
 * (Together AI, OpenRouter, Ollama, etc.). No text parsing or regex cleaning is performed;
 * the provider guarantees the response matches the schema.
 *
 * NOTE: We deliberately bypass the @tanstack/ai-openai adapter because, as of v0.5.0, it
 * still routes all calls through client.responses.create() (the Responses API), which is
 * only supported by OpenAI itself and not by OpenAI-compatible providers.
 */
export async function extractWithSchema(
  imageBuffer: Buffer,
  jsonSchema: any,
  promptInstructions: string | undefined,
  config: Config,
  context?: ExtractionContext,
): Promise<Record<string, unknown>[]> {
  const { base64: base64Image, mimeType } = await normalizeImageForVision(imageBuffer)
  const existingTagsSection = context?.existingTags?.length
    ? `\n\nEXISTING DOCUMENT TAGS:\nThe document already has these tags: [${context.existingTags.join(', ')}]\nDo not repeat them; suggest complementary ones only.`
    : ''

  // Opt-in per workflow (Workflow.includeOcrText) - Paperless's own OCR
  // text isn't necessarily correct (faded thermal receipts OCR badly), so
  // it's framed as a cross-reference, not ground truth to blindly defer to.
  const ocrTextSection = context?.ocrText?.trim()
    ? `\n\nPAPERLESS OCR TEXT (for reference only - this OCR pass can contain errors, especially on faded receipts; cross-reference it against the image rather than trusting it blindly, and prefer what you see in the image if they disagree):\n${context.ocrText.trim()}`
    : ''

  const systemPrompt = [
    'You are a structured data extraction engine.',
    'Extract data from the provided image according to the JSON schema defined in the response format.',
    "Populate the `documents` array — one entry per separate document/receipt visible in the image (almost always exactly one). Do not create a separate entry per product or line item - those belong nested inside the schema's own line_items field, if present.",
    'Dates MUST be in YYYY-MM-DD format.',
    'If information is not visible, use reasonable defaults or omit optional fields.',
    promptInstructions ? `\nADDITIONAL INSTRUCTIONS:\n${promptInstructions}` : '',
    existingTagsSection,
    ocrTextSection,
  ]
    .filter(Boolean)
    .join('\n')

  const extractLogger = context?.documentId ? logger.withDocument(context.documentId) : logger
  const { baseURL, apiKey, model } = resolveEndpoint(config)
  extractLogger.info(`Running extraction with "${model}" from ${config.ai.provider} at ${baseURL}`)
  const responseSchema = buildResponseSchema(jsonSchema)

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // Configurable in Settings (defaults: temperature 0, maxTokens 8192).
      // Structured extraction wants the same answer every time for the same
      // image, not creative variation - the default sampling temperature
      // (usually ~0.7-0.8) is why identical input could non-deterministically
      // extract 0 items on one run and several on the next. And no cap risks
      // running on the provider's own default output-length limit, which can
      // be too small to finish a dense receipt's JSON.
      temperature: config.ai.temperature,
      max_tokens: config.ai.maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'extraction_result',
          strict: true,
          schema: responseSchema,
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all data from this image.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI provider returned ${res.status}: ${errText.slice(0, 300)}`)
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const rawContent = json.choices?.[0]?.message?.content

  if (!rawContent) {
    throw new Error('AI provider returned an empty response.')
  }

  extractLogger.debug(
    `Raw AI response (${rawContent.length} chars): ${rawContent.slice(0, 4000)}${rawContent.length > 4000 ? '…(truncated)' : ''}`,
  )

  // The provider is expected to guarantee valid JSON matching the schema via
  // response_format, but a struggling/overloaded small local model can still
  // emit truncated or malformed output (e.g. hitting its own output token
  // limit mid-object) - surface the raw text on failure instead of just the
  // generic SyntaxError, since that's the only way to tell "cut off" apart
  // from "genuinely empty".
  let parsed: { documents: Record<string, unknown>[] }
  try {
    parsed = JSON.parse(rawContent) as { documents: Record<string, unknown>[] }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `AI provider returned invalid JSON (${reason}). Raw response (${rawContent.length} chars): ${rawContent.slice(0, 2000)}`,
    )
  }
  return Array.isArray(parsed.documents) ? parsed.documents : []
}
