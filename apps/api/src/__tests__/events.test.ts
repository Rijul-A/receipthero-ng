import { describe, test, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@sm-rn/core'
import { app } from '../index'

const TEST_DOC_ID = 9_400_001

afterEach(async () => {
  await db
    .delete(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
    .run()
})

async function postEvent(type: string, payload: Record<string, unknown>) {
  return app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload: { documentId: TEST_DOC_ID, ...payload } }),
  })
}

describe('POST /api/events status mapping', () => {
  test('receipt:success maps to status completed', async () => {
    const res = await postEvent('receipt:success', { progress: 100 })
    expect(res.status).toBe(200)

    const log = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
      .get()
    expect(log?.status).toBe('completed')
  })

  test('workflow:success maps to status completed, same as receipt:success', async () => {
    const res = await postEvent('workflow:success', {
      workflowId: 1,
      workflowName: 'Custom Workflow',
      progress: 100,
    })
    expect(res.status).toBe(200)

    const log = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
      .get()
    expect(log?.status).toBe('completed')
  })

  test('workflow:failed maps to status failed', async () => {
    await postEvent('workflow:failed', { message: 'boom', progress: 100 })

    const log = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
      .get()
    expect(log?.status).toBe('failed')
  })
})
