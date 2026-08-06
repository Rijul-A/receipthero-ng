import { describe, it, expect } from 'bun:test'
import { ConfigSchema } from '@sm-rn/shared/schemas'
import { extractWithSchema } from '../services/extract'

// extractWithSchema calls fetch() directly against the OpenAI-compatible
// /v1/chat/completions endpoint (see extract.ts for why it bypasses the
// @tanstack/ai adapters), so the mock needs to be at the fetch level.
const mockResult = {
  items: [
    {
      vendor: 'Test Store',
      amount: 12.34,
      date: '2024-01-01',
    },
  ],
}

describe('extractWithSchema', () => {
  // Minimal JPEG magic bytes so normalizeImageForVision() passes the image
  // through unchanged instead of invoking sharp for transcoding.
  const mockImageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0])
  const mockJsonSchema = {
    type: 'object',
    properties: {
      vendor: { type: 'string' },
      amount: { type: 'number' },
      date: { type: 'string' },
    },
    required: ['vendor', 'amount', 'date'],
  }
  const mockConfig = ConfigSchema.parse({
    paperless: {},
    processing: {},
    ai: { provider: 'ollama', model: 'test-model' },
  })

  it('should extract data correctly using a JSON Schema', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockResult) } }] }),
        { status: 200 },
      )) as unknown as typeof fetch

    try {
      const result = await extractWithSchema(
        mockImageBuffer,
        mockJsonSchema,
        'Test instructions',
        mockConfig,
      )

      expect(result).toHaveLength(1)
      expect(result[0].vendor).toBe('Test Store')
      expect(result[0].amount).toBe(12.34)
      expect(result[0].date).toBe('2024-01-01')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
