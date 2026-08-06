import type { Config } from '@sm-rn/shared/schemas'
import { resolveEndpoint } from './extract'

/**
 * Sends a text-only chat completion request with a JSON Schema response
 * format and returns the parsed result. Shares the same OpenAI-compatible
 * /v1/chat/completions call style as extract.ts (see that file for why the
 * @tanstack/ai adapters are bypassed).
 */
export async function chatJson<T>(params: {
  config: Config
  systemPrompt: string
  userPrompt: string
  responseSchema: Record<string, unknown>
  schemaName: string
}): Promise<T> {
  const { config, systemPrompt, userPrompt, responseSchema, schemaName } = params
  const { baseURL, apiKey, model } = resolveEndpoint(config)

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: responseSchema,
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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

  return JSON.parse(rawContent) as T
}
