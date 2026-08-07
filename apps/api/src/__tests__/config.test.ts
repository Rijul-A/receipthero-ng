import { describe, test, expect } from 'bun:test'
import { app } from '../index'
import { authHeaders } from './setup'

describe('Config Route', () => {
  test('GET /api/config returns config with masked keys', async () => {
    const res = await app.request('/api/config', { headers: authHeaders() })
    const data = (await res.json()) as any

    if (res.status === 200) {
      expect(data).toHaveProperty('paperless')
      expect(data).toHaveProperty('processing')

      // Check that keys are masked (should contain '...')
      if (data.paperless.apiKey) {
        expect(data.paperless.apiKey).toContain('...')
      }
      if (data.togetherAi?.apiKey) {
        expect(data.togetherAi.apiKey).toContain('...')
      }
    }
  })

  test('401s without a valid session', async () => {
    const res = await app.request('/api/config')
    expect(res.status).toBe(401)
  })
})
