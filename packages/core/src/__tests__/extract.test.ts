import { describe, it, expect } from 'bun:test'
import { ConfigSchema } from '@sm-rn/shared/schemas'
import { extractWithSchema } from '../services/extract'

// extractWithSchema calls fetch() directly against the OpenAI-compatible
// /v1/chat/completions endpoint (see extract.ts for why it bypasses the
// @tanstack/ai adapters), so the mock needs to be at the fetch level.
const mockResult = {
  documents: [
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

  it('omits the OCR text section when no ocrText is given (the default - opt-in per workflow)', async () => {
    const originalFetch = globalThis.fetch
    let requestBody: any
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(init!.body as string)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockResult) } }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    try {
      await extractWithSchema(mockImageBuffer, mockJsonSchema, undefined, mockConfig)

      const systemPrompt = requestBody.messages[0].content as string
      expect(systemPrompt).not.toContain('PAPERLESS OCR TEXT')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('includes the OCR text as reference (not authoritative) when ocrText is given', async () => {
    const originalFetch = globalThis.fetch
    let requestBody: any
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(init!.body as string)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockResult) } }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    try {
      await extractWithSchema(mockImageBuffer, mockJsonSchema, undefined, mockConfig, {
        ocrText: 'WALMART\nPET TOY 1.97\nTOTAL 98.21',
      })

      const systemPrompt = requestBody.messages[0].content as string
      expect(systemPrompt).toContain('PAPERLESS OCR TEXT')
      expect(systemPrompt).toContain('for reference only')
      expect(systemPrompt).toContain('WALMART\nPET TOY 1.97\nTOTAL 98.21')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
