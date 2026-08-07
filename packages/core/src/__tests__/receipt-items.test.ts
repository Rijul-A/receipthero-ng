import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { eq } from 'drizzle-orm'
import { ConfigSchema } from '@sm-rn/shared/schemas'
import { db, schema } from '../db'

// Stubs the AI call so these tests never hit a real provider. Each test can
// override the response via `chatJsonImpl`.
let chatJsonImpl: (args: unknown) => unknown = () => ({ items: [] })
mock.module('../services/ai-json', () => ({
  chatJson: async (args: unknown) => chatJsonImpl(args),
}))

const {
  recordReceiptItems,
  getItemPriceHistory,
  searchItemNames,
  getItemCountsByDocument,
  createReceiptItem,
} = await import('../services/receipt-items')

const mockConfig = ConfigSchema.parse({
  paperless: {},
  processing: {},
  ai: { provider: 'ollama', model: 'test-model' },
})

// Distinct documentId ranges per test to avoid cross-test collisions, since
// these hit the real (test) sqlite database rather than a mock.
const TEST_DOC_ID = 9_000_001
const TEST_DOC_ID_2 = 9_000_002

async function cleanup(...documentIds: number[]) {
  for (const id of documentIds) {
    await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, id)).run()
  }
}

describe('recordReceiptItems', () => {
  beforeEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
    chatJsonImpl = () => ({ items: [] })
  })
  afterEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
  })

  it('is idempotent: reprocessing the same document replaces, not duplicates, its rows', async () => {
    chatJsonImpl = () => ({
      items: [{ raw: 'Diet Coke 330ml', canonical: 'Diet Coke', totalSize: 330, sizeUnit: 'ml' }],
    })

    const params = {
      documentId: TEST_DOC_ID,
      vendor: 'Carrefour',
      currency: 'AED',
      purchaseDate: '2026-01-01',
      lineItems: [{ name: 'Diet Coke 330ml', quantity: 1, unitPrice: 2, totalPrice: 2 }],
      config: mockConfig,
    }

    await recordReceiptItems(params)
    await recordReceiptItems(params)

    const rows = await getItemPriceHistory(['Diet Coke'])
    expect(rows).toHaveLength(1)
    expect(rows[0].documentId).toBe(TEST_DOC_ID)
  })

  it('reprocessing with zero line items clears previously-recorded rows', async () => {
    chatJsonImpl = () => ({
      items: [{ raw: 'Milk 1L', canonical: 'Milk', totalSize: 1000, sizeUnit: 'ml' }],
    })
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk 1L', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })
    expect(await getItemPriceHistory(['Milk'])).toHaveLength(1)

    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [],
      config: mockConfig,
    })
    expect(await getItemPriceHistory(['Milk'])).toHaveLength(0)
  })

  it('snaps a case-differing canonical name to the existing casing', async () => {
    chatJsonImpl = () => ({
      items: [{ raw: 'Milk 1L', canonical: 'Almarai Milk', totalSize: 1000, sizeUnit: 'ml' }],
    })
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk 1L', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    // Second receipt: model returns different casing for the "same" product.
    chatJsonImpl = () => ({
      items: [
        { raw: 'ALMARAI MILK 1L', canonical: 'almarai milk', totalSize: 1000, sizeUnit: 'ml' },
      ],
    })
    await recordReceiptItems({
      documentId: TEST_DOC_ID_2,
      lineItems: [{ name: 'ALMARAI MILK 1L', quantity: 1, unitPrice: 6, totalPrice: 6 }],
      config: mockConfig,
    })

    const rows = await getItemPriceHistory(['Almarai Milk'])
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.canonicalName === 'Almarai Milk')).toBe(true)

    const names = await searchItemNames('almarai')
    expect(names).toEqual(['Almarai Milk'])
  })

  it('falls back to the raw item name when AI annotation fails', async () => {
    chatJsonImpl = () => {
      throw new Error('provider unreachable')
    }
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Mystery Item', quantity: 1, unitPrice: 3, totalPrice: 3 }],
      config: mockConfig,
    })

    const rows = await getItemPriceHistory(['Mystery Item'])
    expect(rows).toHaveLength(1)
    expect(rows[0].canonicalName).toBe('Mystery Item')
    expect(rows[0].totalSize).toBeNull()
  })
})

describe('getItemCountsByDocument', () => {
  beforeEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
    chatJsonImpl = () => ({ items: [] })
  })
  afterEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
  })

  it('counts recorded items per document, omitting documents with zero', async () => {
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [
        { name: 'Milk 1L', quantity: 1, unitPrice: 5, totalPrice: 5 },
        { name: 'Bread', quantity: 1, unitPrice: 3, totalPrice: 3 },
      ],
      config: mockConfig,
    })
    // TEST_DOC_ID_2 is recorded with zero line items - a valid-but-empty
    // extraction, the exact case this function exists to surface.
    await recordReceiptItems({
      documentId: TEST_DOC_ID_2,
      lineItems: [],
      config: mockConfig,
    })

    const counts = await getItemCountsByDocument([TEST_DOC_ID, TEST_DOC_ID_2])

    expect(counts[TEST_DOC_ID]).toBe(2)
    expect(counts[TEST_DOC_ID_2]).toBeUndefined()
  })

  it('returns an empty object for an empty input array', async () => {
    expect(await getItemCountsByDocument([])).toEqual({})
  })
})

describe('createReceiptItem', () => {
  const NEW_DOC_ID = 9_000_101
  const NEW_DOC_ID_EMPTY = 9_000_102

  beforeEach(async () => {
    await cleanup(NEW_DOC_ID, NEW_DOC_ID_EMPTY)
    await db
      .delete(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, NEW_DOC_ID_EMPTY))
      .run()
  })
  afterEach(async () => {
    await cleanup(NEW_DOC_ID, NEW_DOC_ID_EMPTY)
    await db
      .delete(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, NEW_DOC_ID_EMPTY))
      .run()
  })

  it('inherits vendor/currency/purchaseDate from a sibling item on the same receipt', async () => {
    await recordReceiptItems({
      documentId: NEW_DOC_ID,
      vendor: 'Carrefour',
      currency: 'AED',
      purchaseDate: '2026-01-01',
      lineItems: [{ name: 'Milk 1L', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    const created = await createReceiptItem({
      documentId: NEW_DOC_ID,
      itemName: 'Bread',
      totalPrice: 3,
    })

    expect(created?.vendor).toBe('Carrefour')
    expect(created?.currency).toBe('AED')
    expect(created?.purchaseDate).toBe('2026-01-01')
    expect(created?.totalPrice).toBe(300)
  })

  it('falls back to the receipt log when there are no existing items yet - the exact "0 items" case', async () => {
    const now = new Date().toISOString()
    await db
      .insert(schema.processingLogs)
      .values({
        documentId: NEW_DOC_ID_EMPTY,
        status: 'completed',
        progress: 100,
        attempts: 1,
        vendor: 'Walmart',
        currency: 'USD',
        receiptData: JSON.stringify({ date: '2017-07-28' }),
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const created = await createReceiptItem({
      documentId: NEW_DOC_ID_EMPTY,
      itemName: 'Pet Toy',
      totalPrice: 1.97,
    })

    expect(created?.vendor).toBe('Walmart')
    expect(created?.currency).toBe('USD')
    expect(created?.purchaseDate).toBe('2017-07-28')
    expect(created?.totalPrice).toBe(197)

    const counts = await getItemCountsByDocument([NEW_DOC_ID_EMPTY])
    expect(counts[NEW_DOC_ID_EMPTY]).toBe(1)
  })

  it('returns null for a blank name or a document with no items and no log entry', async () => {
    expect(await createReceiptItem({ documentId: NEW_DOC_ID_EMPTY, itemName: '  ' })).toBeNull()
    expect(await createReceiptItem({ documentId: 999_999_999, itemName: 'Ghost item' })).toBeNull()
  })

  it('leaves totalPrice/unitPrice null when left blank, matching "price unknown"', async () => {
    await recordReceiptItems({
      documentId: NEW_DOC_ID,
      lineItems: [{ name: 'Milk 1L', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    const created = await createReceiptItem({
      documentId: NEW_DOC_ID,
      itemName: 'Mystery item',
    })

    expect(created?.totalPrice).toBeNull()
    expect(created?.unitPrice).toBeNull()
  })
})
