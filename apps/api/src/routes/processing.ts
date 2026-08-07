import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  loadConfig,
  PaperlessClient,
  processPaperlessDocument,
  processDocumentsByIds,
  createAIAdapter,
  RetryQueue,
  createLogger,
} from '@sm-rn/core'

const logger = createLogger('api')
const processing = new Hono()

const RetrySchema = z.object({
  strategy: z.enum(['full', 'partial']).default('partial'),
})

// POST /api/processing/:id/retry - Trigger a manual retry
processing.post('/:id/retry', zValidator('json', RetrySchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const { strategy } = c.req.valid('json')

  try {
    const config = loadConfig()
    const client = new PaperlessClient({
      host: config.paperless.host,
      apiKey: config.paperless.apiKey,
      processedTagName: config.processing.processedTag,
    })
    const adapter = createAIAdapter(config)
    const retryQueue = new RetryQueue(config.processing.maxRetries)

    // Run processing in background
    processPaperlessDocument(
      client,
      id,
      adapter,
      retryQueue,
      config.processing.failedTag,
      strategy,
    ).catch((err) => {
      logger.error(`Background retry for document ${id} failed`, err)
    })

    return c.json({ success: true, message: `Retry triggered using ${strategy} strategy` })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

const BatchReprocessSchema = z.object({
  // Capped since this fans out to a Paperless + AI provider call per
  // document in an unbounded background loop - an accidental huge selection
  // shouldn't be able to hammer a paid AI provider or Paperless instance.
  documentIds: z.array(z.number().int()).min(1).max(500),
})

// POST /api/processing/batch-reprocess - Re-run processing for multiple already-processed documents
processing.post('/batch-reprocess', zValidator('json', BatchReprocessSchema), async (c) => {
  const { documentIds } = c.req.valid('json')

  // Run in background — matches the single-document /:id/retry pattern.
  // Documents already tagged "processed" wouldn't be picked up by the
  // normal tag-based scan, so this bypasses that and reprocesses the
  // given IDs directly (reusing cached extraction data where the
  // workflow engine finds it, so this is cheap — it mainly exists to
  // backfill data like price-comparison line items for older receipts).
  processDocumentsByIds(documentIds, 'reprocess').catch((err) => {
    logger.error(`Background batch reprocess failed`, err)
  })

  return c.json({
    success: true,
    message: `Reprocessing ${documentIds.length} document(s)`,
  })
})

export default processing
