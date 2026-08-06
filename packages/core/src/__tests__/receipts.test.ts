import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { eq } from 'drizzle-orm'
import { ConfigSchema } from '@sm-rn/shared/schemas'
import { db, schema } from '../db'

mock.module('../services/ai-json', () => ({
  chatJson: async () => ({ items: [] }),
}))

const { recordReceiptItems, updateReceiptItem, getItemPriceHistory } =
  await import('../services/receipt-items')
const { getReceiptDetail, updateReceipt, recalculateReceiptTotal } =
  await import('../services/receipts')

const mockConfig = ConfigSchema.parse({
  paperless: {},
  processing: {},
  ai: { provider: 'ollama', model: 'test-model' },
})

const TEST_DOC_ID = 9_300_001

async function cleanup() {
  await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, TEST_DOC_ID)).run()
  await db
    .delete(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
    .run()
}

async function seedLog(overrides: Partial<schema.NewProcessingLogEntry> = {}) {
  const now = new Date().toISOString()
  await db
    .insert(schema.processingLogs)
    .values({
      documentId: TEST_DOC_ID,
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

describe('getReceiptDetail / updateReceipt', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it('returns null for an unknown document', async () => {
    expect(await getReceiptDetail(TEST_DOC_ID)).toBeNull()
  })

  it('returns the log plus its recorded line items', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    const detail = await getReceiptDetail(TEST_DOC_ID)
    expect(detail?.log.vendor).toBe('Carrefour')
    expect(detail?.items).toHaveLength(1)
  })

  it('merges date/time/category edits into receiptData and keeps column fields in sync', async () => {
    await seedLog()

    const updated = await updateReceipt(TEST_DOC_ID, {
      vendor: 'Lulu',
      currency: 'USD',
      storeLocation: 'Deira City Centre',
      date: '2026-02-02',
      time: '14:30',
      category: 'dining',
    })

    expect(updated?.vendor).toBe('Lulu')
    expect(updated?.currency).toBe('USD')
    expect(updated?.storeLocation).toBe('Deira City Centre')

    const parsed = JSON.parse(updated?.receiptData ?? '{}')
    expect(parsed.date).toBe('2026-02-02')
    expect(parsed.time).toBe('14:30')
    expect(parsed.category).toBe('dining')
  })
})

describe('recalculateReceiptTotal', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it('no-ops when the receipt has no recorded line items', async () => {
    await seedLog({ amount: 1234 })
    await recalculateReceiptTotal(TEST_DOC_ID)

    const log = await getReceiptDetail(TEST_DOC_ID)
    expect(log?.log.amount).toBe(1234)
  })

  it('sums recorded line items and persists the total', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [
        { name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 },
        { name: 'Bread', quantity: 1, unitPrice: 3, totalPrice: 3 },
      ],
      config: mockConfig,
    })

    await recalculateReceiptTotal(TEST_DOC_ID)

    const detail = await getReceiptDetail(TEST_DOC_ID)
    expect(detail?.log.amount).toBe(800) // (5 + 3) * 100 cents
  })

  it('editing an item total price automatically recalculates the receipt total', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    const [item] = await getItemPriceHistory(['Milk'])
    await updateReceiptItem(item.id, { totalPrice: 9 })

    const detail = await getReceiptDetail(TEST_DOC_ID)
    expect(detail?.log.amount).toBe(900)
  })
})
