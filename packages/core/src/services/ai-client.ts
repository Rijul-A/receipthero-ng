import { createOpenaiChat } from '@tanstack/ai-openai'
import { createOllamaChat } from '@tanstack/ai-ollama'
import type { AnyTextAdapter } from '@tanstack/ai'
import type { Config } from '@sm-rn/shared/schemas'
import { resolveEndpoint } from './extract'

const APP_NAME_HELICONE = 'receipthero'

/** The adapter type returned by createAIAdapter */
export type AIAdapter = AnyTextAdapter

/** Options for testing an AI connection */
export interface TestAIConnectionOptions {
  provider: 'openai-compat' | 'together-ai' | 'ollama' | 'openrouter'
  apiKey?: string
  baseURL?: string
  model: string
}

/** Result of testing an AI connection */
export interface TestAIConnectionResult {
  success: boolean
  response?: string
  provider: string
  model: string
  error?: string
}

/**
 * Tests an AI provider connection by sending a simple chat message.
 * Creates a temporary adapter from the provided config and validates connectivity.
 */
export async function testAIConnection(
  options: TestAIConnectionOptions,
): Promise<TestAIConnectionResult> {
  const { provider, apiKey, baseURL, model } = options

  if (
    (provider === 'openai-compat' || provider === 'together-ai' || provider === 'openrouter') &&
    !apiKey
  ) {
    return {
      success: false,
      error: `API key is required for ${provider} provider`,
      provider,
      model,
    }
  }

  try {
    // Deliberately a raw fetch, not the @tanstack/ai adapter's chat() - as
    // of v0.5.0 that routes every call through client.responses.create()
    // (OpenAI's Responses API), which Ollama and most OpenAI-compatible
    // providers don't implement, surfacing as a bare "404 page not found"
    // with no indication of what actually went wrong. Same reasoning as
    // extractWithSchema in extract.ts.
    const { baseURL: resolvedBaseURL, apiKey: resolvedApiKey } = resolveEndpoint({
      ai: { provider, apiKey: apiKey || 'ollama', baseURL, model },
    } as Config)

    const res = await fetch(`${resolvedBaseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say hello in 5 words or less.' }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return {
        success: false,
        error: `Provider returned ${res.status}: ${errText.slice(0, 300)}`,
        provider,
        model,
      }
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const responseText = json.choices?.[0]?.message?.content

    if (!responseText) {
      return { success: false, error: 'Provider returned an empty response.', provider, model }
    }

    return {
      success: true,
      response: responseText,
      provider,
      model,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      provider,
      model,
    }
  }
}

/**
 * Creates a TanStack AI text adapter based on the configured provider.
 * Supports OpenAI-compatible APIs (Together AI, vLLM, OpenRouter, etc.) and Ollama.
 *
 * OpenRouter is handled via openai-compat since its API is OpenAI-compatible.
 */
export function createAIAdapter(config: Config): AIAdapter {
  const { ai, observability } = config

  switch (ai.provider) {
    case 'openai-compat':
    case 'together-ai': {
      if (!ai.apiKey) {
        throw new Error(
          'AI API key is required for openai-compat provider. Set AI_API_KEY or TOGETHER_API_KEY.',
        )
      }

      let baseURL = ai.baseURL || 'https://api.together.xyz/v1'
      const headers: Record<string, string> = {}

      // Helicone observability proxy
      if (observability?.heliconeEnabled && observability.heliconeApiKey) {
        baseURL = 'https://together.helicone.ai/v1'
        headers['Helicone-Auth'] = `Bearer ${observability.heliconeApiKey}`
        headers['Helicone-Property-Appname'] = APP_NAME_HELICONE
      }

      // Cast model to satisfy the literal union type — users pass arbitrary model names for custom endpoints
      // The returned adapter is structurally compatible with AnyTextAdapter
      return createOpenaiChat(ai.model as never, ai.apiKey, {
        baseURL,
        defaultHeaders: Object.keys(headers).length > 0 ? headers : undefined,
      }) as unknown as AIAdapter
    }

    case 'ollama': {
      const host = ai.baseURL || 'http://localhost:11434'
      return createOllamaChat(ai.model as never, host) as unknown as AIAdapter
    }

    case 'openrouter': {
      if (!ai.apiKey) {
        throw new Error('AI API key is required for openrouter provider. Set AI_API_KEY.')
      }
      // OpenRouter is OpenAI-compatible — use the OpenAI adapter with OpenRouter's base URL
      return createOpenaiChat(ai.model as never, ai.apiKey, {
        baseURL: ai.baseURL || 'https://openrouter.ai/api/v1',
      }) as unknown as AIAdapter
    }

    default:
      throw new Error(`Unknown AI provider: ${ai.provider}`)
  }
}
