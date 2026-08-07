import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@sm-rn/core'
import { app } from '../index'
import { authHeaders } from './setup'

const DOC_ID = 9_500_001
const OTHER_DOC_ID = 9_500_002

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
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run()
}

async function seedItem(overrides: Partial<schema.NewReceiptItemEntry> = {}) {
  const now = new Date().toISOString()
  const [row] = await db
    .insert(schema.receiptItems)
    .values({
      documentId: DOC_ID,
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

describe('items routes', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  describe('GET /api/items/frequency', () => {
    test('returns tallied purchase frequency rows', async () => {
      await seedLog(DOC_ID)
      await seedItem()

      const res = await app.request('/api/items/frequency', { headers: authHeaders() })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: Array<{ name: string; purchaseCount: number }> }
      expect(body.rows.some((r) => r.name === 'Almond Milk')).toBe(true)
    })

    test('rejects a limit of zero', async () => {
      const res = await app.request('/api/items/frequency?limit=0', { headers: authHeaders() })
      expect(res.status).toBe(400)
    })

    test('rejects a non-numeric limit', async () => {
      const res = await app.request('/api/items/frequency?limit=abc', { headers: authHeaders() })
      expect(res.status).toBe(400)
    })

    test('401s without a valid session', async () => {
      const res = await app.request('/api/items/frequency')
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/items/search', () => {
    test('finds a matching item name', async () => {
      await seedLog(DOC_ID)
      await seedItem()

      const res = await app.request('/api/items/search?q=Almond', { headers: authHeaders() })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { names: Array<string> }
      expect(body.names).toContain('Almond Milk')
    })

    test('requires a non-empty q', async () => {
      const res = await app.request('/api/items/search?q=', { headers: authHeaders() })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/items/history', () => {
    test('returns price history for the given names', async () => {
      await seedLog(DOC_ID)
      await seedItem()

      const res = await app.request(
        `/api/items/history?names=${encodeURIComponent('Almond Milk')}`,
        { headers: authHeaders() },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { history: Array<{ canonicalName: string | null }> }
      expect(body.history).toHaveLength(1)
    })
  })

  describe('POST /api/items', () => {
    test('adds a manually-entered item, inheriting vendor/currency from a sibling', async () => {
      await seedLog(DOC_ID)
      await seedItem()

      const res = await app.request('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ documentId: DOC_ID, itemName: 'Bread', totalPrice: 3 }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        item: { itemName: string; vendor: string | null; totalPrice: number | null }
      }
      expect(body.item.itemName).toBe('Bread')
      expect(body.item.vendor).toBe('Carrefour')
      expect(body.item.totalPrice).toBe(300)
    })

    test('404s when the document has no items and no log entry', async () => {
      const res = await app.request('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ documentId: 999999999, itemName: 'Ghost item' }),
      })
      expect(res.status).toBe(404)
    })

    test('400s for a missing itemName', async () => {
      const res = await app.request('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ documentId: DOC_ID }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/items/:id', () => {
    test('corrects a row and returns the updated item', async () => {
      await seedLog(DOC_ID)
      const item = await seedItem()

      const res = await app.request(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ totalPrice: 7, quantity: 2 }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { item: { totalPrice: number; quantity: number } }
      // updateReceiptItem takes totalPrice in major units and stores cents.
      expect(body.item.totalPrice).toBe(700)
      expect(body.item.quantity).toBe(2)
    })

    test('404s for an unknown item id', async () => {
      const res = await app.request('/api/items/999999999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ totalPrice: 700 }),
      })
      expect(res.status).toBe(404)
    })

    test('400s for a non-numeric item id', async () => {
      const res = await app.request('/api/items/not-a-number', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ totalPrice: 700 }),
      })
      expect(res.status).toBe(400)
    })

    test('400s for an invalid edit payload', async () => {
      await seedLog(DOC_ID)
      const item = await seedItem()

      const res = await app.request(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ quantity: -1 }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/items/:id', () => {
    test('removes the row', async () => {
      await seedLog(DOC_ID)
      const item = await seedItem()

      const res = await app.request(`/api/items/${item.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      expect(res.status).toBe(200)

      const remaining = await db
        .select()
        .from(schema.receiptItems)
        .where(eq(schema.receiptItems.id, item.id))
        .get()
      expect(remaining).toBeUndefined()
    })

    test('404s for an unknown item id', async () => {
      const res = await app.request('/api/items/999999999', {
        method: 'DELETE',
        headers: authHeaders(),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/items/rename-preview', () => {
    test('previews rows grouped under the canonical name', async () => {
      await seedLog(DOC_ID)
      await seedItem()

      const res = await app.request(
        `/api/items/rename-preview?from=${encodeURIComponent('Almond Milk')}`,
        { headers: authHeaders() },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: Array<unknown> }
      expect(body.rows).toHaveLength(1)
    })

    test('requires a non-empty from', async () => {
      const res = await app.request('/api/items/rename-preview', { headers: authHeaders() })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/items/rename', () => {
    test('renames every row in the group', async () => {
      await seedLog(DOC_ID)
      await seedItem()

      const res = await app.request('/api/items/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ from: 'Almond Milk', to: 'Oat Milk' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { count: number }
      expect(body.count).toBe(1)

      const updated = await db.query.receiptItems.findFirst({
        where: eq(schema.receiptItems.documentId, DOC_ID),
      })
      expect(updated?.canonicalName).toBe('Oat Milk')
    })

    test('400s when "to" is missing', async () => {
      const res = await app.request('/api/items/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ from: 'Almond Milk' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/items/counts', () => {
    test('counts recorded items per document, omitting a document with zero', async () => {
      await seedLog(DOC_ID)
      await seedItem()
      await seedLog(OTHER_DOC_ID)

      const res = await app.request(`/api/items/counts?documentIds=${DOC_ID},${OTHER_DOC_ID}`, {
        headers: authHeaders(),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { counts: Record<number, number> }
      expect(body.counts[DOC_ID]).toBe(1)
      expect(body.counts[OTHER_DOC_ID]).toBeUndefined()
    })

    test('400s without a documentIds query param', async () => {
      const res = await app.request('/api/items/counts', { headers: authHeaders() })
      expect(res.status).toBe(400)
    })
  })
})
