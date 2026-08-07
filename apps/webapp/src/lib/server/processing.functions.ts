import { createServerFn } from '@tanstack/react-start'
import { apiCall } from './api-client'
import type { LogEntry, ProcessingLog } from '@sm-rn/shared/types'

export interface RetryDocumentResponse {
  success: boolean
  message: string
  error?: string
}

// Re-export the type for convenience
export type { ProcessingLog }

/**
 * Get recent processing logs - proxies to GET /api/events
 */
export const getProcessingLogs = createServerFn({ method: 'GET' }).handler(
  async () => {
    return apiCall<Array<ProcessingLog>>('/api/events')
  },
)

/**
 * Get logs for a specific document - proxies to GET /api/events/logs/document/:id
 */
export const getDocumentLogs = createServerFn({ method: 'POST' })
  .inputValidator((input: { documentId: number }) => input)
  .handler(async (ctx: { data: { documentId: number } }) => {
    const documentId = ctx.data.documentId
    console.log('[getDocumentLogs] Received documentId:', documentId)

    if (!documentId) {
      console.log(
        '[getDocumentLogs] No documentId provided, returning empty array',
      )
      return []
    }

    try {
      const result = await apiCall<Array<LogEntry>>(
        `/api/events/logs/document/${documentId}`,
      )
      console.log('[getDocumentLogs] Got', result.length, 'logs')
      return result
    } catch (error) {
      console.error('[getDocumentLogs] Error:', error)
      return []
    }
  })

/**
 * Get app logs - proxies to GET /api/events/logs
 */
export const getAppLogs = createServerFn({ method: 'POST' })
  .inputValidator((input: { source?: string }) => input)
  .handler(async (ctx: { data: { source?: string } }) => {
    const source = ctx.data.source
    const queryParam = source ? `?source=${source}` : ''
    try {
      return await apiCall<Array<LogEntry>>(`/api/events/logs${queryParam}`)
    } catch (error) {
      console.error('[getAppLogs] Error:', error)
      return []
    }
  })

/**
 * Retry document processing - proxies to POST /api/processing/:id/retry
 */
export const retryDocument = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { id: number; strategy: 'full' | 'partial' }) => input,
  )
  .handler((async ({ data }: any) => {
    return apiCall<RetryDocumentResponse>(`/api/processing/${data.id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ strategy: data.strategy }),
    })
  }) as any) as (opts: {
  data: { id: number; strategy: 'full' | 'partial' }
}) => Promise<RetryDocumentResponse>

/**
 * Batch reprocess multiple already-processed documents - proxies to
 * POST /api/processing/batch-reprocess
 */
export const batchReprocessDocuments = createServerFn({ method: 'POST' })
  .inputValidator((input: { documentIds: Array<number> }) => input)
  .handler(async ({ data }: { data: { documentIds: Array<number> } }) => {
    return apiCall<RetryDocumentResponse>('/api/processing/batch-reprocess', {
      method: 'POST',
      body: JSON.stringify({ documentIds: data.documentIds }),
    })
  })
