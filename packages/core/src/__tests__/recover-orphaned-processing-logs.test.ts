import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { recoverOrphanedProcessingLogs } from '../services/worker-state'

const PROCESSING_DOC_ID = 9_600_001
const RETRYING_DOC_ID = 9_600_002
const COMPLETED_DOC_ID = 9_600_003

async function cleanup() {
  for (const id of [PROCESSING_DOC_ID, RETRYING_DOC_ID, COMPLETED_DOC_ID]) {
    await db.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, id)).run()
  }
}

describe('recoverOrphanedProcessingLogs', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it('marks stuck processing/retrying rows as failed, leaving completed rows untouched', async () => {
    const now = new Date().toISOString()
    await db
      .insert(schema.processingLogs)
      .values([
        { documentId: PROCESSING_DOC_ID, status: 'processing', createdAt: now, updatedAt: now },
        { documentId: RETRYING_DOC_ID, status: 'retrying', createdAt: now, updatedAt: now },
        { documentId: COMPLETED_DOC_ID, status: 'completed', createdAt: now, updatedAt: now },
      ])
      .run()

    await recoverOrphanedProcessingLogs()

    const processing = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, PROCESSING_DOC_ID))
      .get()
    const retrying = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, RETRYING_DOC_ID))
      .get()
    const completed = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, COMPLETED_DOC_ID))
      .get()

    expect(processing?.status).toBe('failed')
    expect(processing?.message).toContain('restart')
    expect(retrying?.status).toBe('failed')
    expect(completed?.status).toBe('completed')
  })

  it('is a no-op when nothing is stuck', async () => {
    await expect(recoverOrphanedProcessingLogs()).resolves.toBeUndefined()
  })
})
