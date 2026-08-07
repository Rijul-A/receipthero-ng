import { createServerFn } from '@tanstack/react-start'
import { apiCall } from './api-client'

export interface WebhookQueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  total: number
}

export interface WebhookStatusResponse {
  enabled: boolean
  hasSecret: boolean
  queue: WebhookQueueStats
}

/**
 * Get webhook status - proxies to GET /api/webhooks/status
 */
export const getWebhookStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WebhookStatusResponse> => {
    return apiCall<WebhookStatusResponse>('/api/webhooks/status')
  },
)
