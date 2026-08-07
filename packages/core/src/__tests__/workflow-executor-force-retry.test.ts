import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Workflow } from '../db/schema'
import type { PaperlessClient } from '../services/paperless'

let extractCallCount = 0
mock.module('../services/extract', () => ({
  extractWithSchema: async () => {
    extractCallCount++
    return [{ vendor: 'Fresh Vendor', amount: 42, date: '2024-01-01', line_items: [] }]
  },
}))

const { executeWorkflow } = await import('../services/workflow-executor')

const TEST_DOC_ID = 8_800_001

const testWorkflow: Workflow = {
  id: 1,
  name: 'Test Workflow',
  slug: 'test-workflow',
  description: null,
  enabled: true,
  priority: 0,
  triggerTag: 'receipt',
  zodSource: '',
  jsonSchema: '{}',
  promptInstructions: null,
  titleTemplate: null,
  includeOcrText: false,
  outputMapping: JSON.stringify({
    tagsToApply: [],
    tagFields: [],
    customFields: {},
  }),
  processedTag: 'ai-processed',
  failedTag: null,
  skippedTag: null,
  isBuiltIn: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function makeFakeClient(): PaperlessClient {
  return {
    getDocument: async () => ({ id: TEST_DOC_ID, tags: [], content: '' }),
    getDocumentImage: async () => Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0]),
    getTags: async () => [],
    getOrCreateTag: async () => 1,
    updateDocument: async () => {},
    addNote: async () => {},
  } as unknown as PaperlessClient
}

async function cleanup() {
  await db
    .delete(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
    .run()
}

describe('executeWorkflow force retry strategy', () => {
  beforeEach(async () => {
    await cleanup()
    extractCallCount = 0
  })
  afterEach(async () => {
    await cleanup()
  })

  it('reuses cached extractedData instead of re-running AI extraction by default', async () => {
    await db
      .insert(schema.processingLogs)
      .values({
        documentId: TEST_DOC_ID,
        status: 'completed',
        extractedData: JSON.stringify({ vendor: 'Stale Vendor', amount: 1, date: '2020-01-01' }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run()

    await executeWorkflow(makeFakeClient(), TEST_DOC_ID, testWorkflow)

    expect(extractCallCount).toBe(0)
  })

  it('re-runs AI extraction when forceRetryStrategy is "full", ignoring stale cached data', async () => {
    await db
      .insert(schema.processingLogs)
      .values({
        documentId: TEST_DOC_ID,
        status: 'completed',
        extractedData: JSON.stringify({ vendor: 'Stale Vendor', amount: 1, date: '2020-01-01' }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run()

    await executeWorkflow(makeFakeClient(), TEST_DOC_ID, testWorkflow, undefined, 'full')

    expect(extractCallCount).toBe(1)
  })
})
