import { createServerFn } from '@tanstack/react-start'
import { apiCall } from './api-client'

export interface TestConnectionResponse {
  success: boolean
  message?: string
  error?: string
}

/**
 * Test Paperless connection - proxies to POST /api/config/test-paperless
 */
export const testPaperlessConnection = createServerFn({ method: 'POST' })
  .inputValidator((data: { host: string; apiKey: string }) => data)
  .handler(async ({ data }: any) => {
    return apiCall<TestConnectionResponse>('/api/config/test-paperless', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

/**
 * Test AI provider connection - proxies to POST /api/config/test-ai
 */
export const testAiConnection = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      provider: string
      apiKey?: string
      baseURL?: string
      model: string
    }) => data,
  )
  .handler(async ({ data }: any) => {
    return apiCall<TestConnectionResponse>('/api/config/test-ai', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })
