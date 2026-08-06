import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@sm-rn/core'
import { app } from '../index'

const DOC_ID = 9_600_001
const OTHER_DOC_ID = 9_600_002

async function cleanup() {
  for (const id of [DOC_ID, OTHER_DOC_ID]) {
    await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, id)).run()
    await db.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, id)).run()
  }
}

async function seedLog(documentId: number, overrides: Partial<schema.NewProcessingLogEntry> = {}) {
  const now = new Date().toISOString()
  await db
    .insert(schema.processingLogs)
    .values({
      documentId,
      status: 'completed',
      progress: 100,
      attempts: 1,
      vendor: 'Carrefour',
      amount: 1000,
      currency: 'AED',
      receiptData: JSON.stringify({
        vendor: 'Carrefour',
        amount: 10,
        currency: 'AED',
        date: '2026-01-01',
        category: 'groceries',
      }),
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run()
}

async function seedItem(documentId: number, overrides: Partial<schema.NewReceiptItemEntry> = {}) {
  const now = new Date().toISOString()
  const [row] = await db
    .insert(schema.receiptItems)
    .values({
      documentId,
      vendor: 'Carrefour',
      itemName: 'almond milk 1l',
      canonicalName: 'Almond Milk',
      quantity: 1,
      unitPrice: 500,
      totalPrice: 500,
      currency: 'AED',
      purchaseDate: '2026-01-01',
      createdAt: now,
      ...overrides,
    })
    .returning()
  return row
}

describe('receipts routes', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  describe('GET /api/receipts/:documentId', () => {
    test('returns the log plus its recorded line items', async () => {
      await seedLog(DOC_ID)
      await seedItem(DOC_ID)

      const res = await app.request(`/api/receipts/${DOC_ID}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { log: { vendor: string }; items: Array<unknown> }
      expect(body.log.vendor).toBe('Carrefour')
      expect(body.items).toHaveLength(1)
    })

    test('404s for an unknown document', async () => {
      const res = await app.request('/api/receipts/999999999')
      expect(res.status).toBe(404)
    })

    test('400s for a non-numeric documentId', async () => {
      const res = await app.request('/api/receipts/not-a-number')
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/receipts/:documentId', () => {
    test('corrects receipt fields and cascades vendor to its line items', async () => {
      await seedLog(DOC_ID)
      await seedItem(DOC_ID)

      const res = await app.request(`/api/receipts/${DOC_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: 'Lulu', storeLocation: 'Deira City Centre' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { log: { vendor: string; storeLocation: string | null } }
      expect(body.log.vendor).toBe('Lulu')
      expect(body.log.storeLocation).toBe('Deira City Centre')

      const item = await db.query.receiptItems.findFirst({
        where: eq(schema.receiptItems.documentId, DOC_ID),
      })
      expect(item?.vendor).toBe('Lulu')
    })

    test('404s for an unknown document', async () => {
      const res = await app.request('/api/receipts/999999999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: 'Lulu' }),
      })
      expect(res.status).toBe(404)
    })

    test('400s for an invalid edit payload', async () => {
      await seedLog(DOC_ID)

      const res = await app.request(`/api/receipts/${DOC_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: '' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/receipts/:documentId', () => {
    test('removes the log and its line items', async () => {
      await seedLog(DOC_ID)
      await seedItem(DOC_ID)

      const res = await app.request(`/api/receipts/${DOC_ID}`, { method: 'DELETE' })
      expect(res.status).toBe(200)

      const log = await db
        .select()
        .from(schema.processingLogs)
        .where(eq(schema.processingLogs.documentId, DOC_ID))
        .get()
      expect(log).toBeUndefined()

      const items = await db
        .select()
        .from(schema.receiptItems)
        .where(eq(schema.receiptItems.documentId, DOC_ID))
        .all()
      expect(items).toHaveLength(0)
    })

    test('404s for an unknown document', async () => {
      const res = await app.request('/api/receipts/999999999', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/receipts/vendor-rename-preview', () => {
    test('previews receipts matching the vendor, case-insensitively', async () => {
      await seedLog(DOC_ID, { vendor: 'carrefour' })

      const res = await app.request(
        `/api/receipts/vendor-rename-preview?from=${encodeURIComponent('Carrefour')}`,
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: Array<{ documentId: number }> }
      expect(body.rows.map((r) => r.documentId)).toContain(DOC_ID)
    })

    test('requires a non-empty from, and is not swallowed by the /:documentId route', async () => {
      const res = await app.request('/api/receipts/vendor-rename-preview')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/receipts/vendor-rename', () => {
    test('renames the vendor across every matched receipt and cascades to its items', async () => {
      await seedLog(DOC_ID, { vendor: 'Carrefour' })
      await seedItem(DOC_ID, { vendor: 'Carrefour' })
      await seedLog(OTHER_DOC_ID, { vendor: 'Spinneys' })

      const res = await app.request('/api/receipts/vendor-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Carrefour', to: 'Carrefour Market' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { count: number }
      expect(body.count).toBe(1)

      const log = await db
        .select()
        .from(schema.processingLogs)
        .where(eq(schema.processingLogs.documentId, DOC_ID))
        .get()
      expect(log?.vendor).toBe('Carrefour Market')

      const item = await db.query.receiptItems.findFirst({
        where: eq(schema.receiptItems.documentId, DOC_ID),
      })
      expect(item?.vendor).toBe('Carrefour Market')

      const otherLog = await db
        .select()
        .from(schema.processingLogs)
        .where(eq(schema.processingLogs.documentId, OTHER_DOC_ID))
        .get()
      expect(otherLog?.vendor).toBe('Spinneys')
    })

    test('400s when "to" is missing', async () => {
      const res = await app.request('/api/receipts/vendor-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Carrefour' }),
      })
      expect(res.status).toBe(400)
    })
  })
})
