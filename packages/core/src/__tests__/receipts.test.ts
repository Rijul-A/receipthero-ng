import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { eq } from 'drizzle-orm'
import { ConfigSchema } from '@sm-rn/shared/schemas'
import { db, schema } from '../db'

mock.module('../services/ai-json', () => ({
  chatJson: async () => ({ items: [] }),
}))

const { recordReceiptItems, updateReceiptItem, getItemPriceHistory } =
  await import('../services/receipt-items')
const {
  getReceiptDetail,
  updateReceipt,
  recalculateReceiptTotal,
  deleteReceipt,
  previewVendorRename,
  renameVendor,
} = await import('../services/receipts')

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

  it('cascades vendor/currency/storeLocation corrections to already-recorded line items', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      vendor: 'Carrefour Express',
      currency: 'AED',
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    await updateReceipt(TEST_DOC_ID, {
      vendor: 'Carrefour',
      currency: 'USD',
      storeLocation: 'Deira City Centre',
    })

    const detail = await getReceiptDetail(TEST_DOC_ID)
    expect(detail?.items).toHaveLength(1)
    expect(detail?.items[0].vendor).toBe('Carrefour')
    expect(detail?.items[0].currency).toBe('USD')
    expect(detail?.items[0].storeLocation).toBe('Deira City Centre')
  })

  it('does not touch line items when neither vendor, currency, nor storeLocation is being edited', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      vendor: 'Carrefour',
      currency: 'AED',
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    await updateReceipt(TEST_DOC_ID, { category: 'groceries' })

    const detail = await getReceiptDetail(TEST_DOC_ID)
    expect(detail?.items[0].vendor).toBe('Carrefour')
    expect(detail?.items[0].currency).toBe('AED')
  })
})

describe('recalculateReceiptTotal', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it('no-ops when the receipt has no recorded line items, returning null', async () => {
    await seedLog({ amount: 1234 })
    const result = await recalculateReceiptTotal(TEST_DOC_ID)
    expect(result).toBeNull()

    const log = await getReceiptDetail(TEST_DOC_ID)
    expect(log?.log.amount).toBe(1234)
  })

  it('sums recorded line items, persists the total, and returns it in major units', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [
        { name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 },
        { name: 'Bread', quantity: 1, unitPrice: 3, totalPrice: 3 },
      ],
      config: mockConfig,
    })

    const result = await recalculateReceiptTotal(TEST_DOC_ID)
    expect(result).toBe(8) // major units, not cents

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

describe('deleteReceipt', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it('returns false for an unknown document', async () => {
    expect(await deleteReceipt(TEST_DOC_ID)).toBe(false)
  })

  it('removes the log entry and all of its line items', async () => {
    await seedLog()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    expect(await deleteReceipt(TEST_DOC_ID)).toBe(true)

    expect(await getReceiptDetail(TEST_DOC_ID)).toBeNull()
    expect(await getItemPriceHistory(['Milk'])).toHaveLength(0)
  })
})

describe('previewVendorRename / renameVendor', () => {
  const DOC_A = 9_310_001
  const DOC_B = 9_310_002
  const DOC_OTHER = 9_310_003

  async function cleanupVendorRenameDocs() {
    for (const id of [DOC_A, DOC_B, DOC_OTHER]) {
      await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, id)).run()
      await db.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, id)).run()
    }
  }

  beforeEach(cleanupVendorRenameDocs)
  afterEach(cleanupVendorRenameDocs)

  it('previews every receipt with a case-insensitive vendor match, across locations', async () => {
    await seedLog({ documentId: DOC_A, vendor: 'Carrfeour', storeLocation: 'Deira' })
    await seedLog({ documentId: DOC_B, vendor: 'CARRFEOUR', storeLocation: 'Mall of the Emirates' })
    await seedLog({ documentId: DOC_OTHER, vendor: 'Lulu' })

    const preview = await previewVendorRename('carrfeour')
    expect(preview.map((r) => r.documentId).sort()).toEqual([DOC_A, DOC_B])
  })

  it('renames the vendor across every matched receipt and cascades to its items', async () => {
    await seedLog({ documentId: DOC_A, vendor: 'Carrfeour', storeLocation: 'Deira' })
    await seedLog({ documentId: DOC_B, vendor: 'Carrfeour', storeLocation: 'Mall of the Emirates' })
    await recordReceiptItems({
      documentId: DOC_A,
      vendor: 'Carrfeour',
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: mockConfig,
    })

    const result = await renameVendor('Carrfeour', 'Carrefour')
    expect(result.count).toBe(2)

    const detailA = await getReceiptDetail(DOC_A)
    const detailB = await getReceiptDetail(DOC_B)
    expect(detailA?.log.vendor).toBe('Carrefour')
    expect(detailB?.log.vendor).toBe('Carrefour')
    // Location is preserved - only the vendor name itself is corrected.
    expect(detailA?.log.storeLocation).toBe('Deira')
    // Cascades to items, same as a single-receipt vendor edit.
    expect(detailA?.items[0].vendor).toBe('Carrefour')
  })

  it('does not touch receipts under a different vendor', async () => {
    await seedLog({ documentId: DOC_A, vendor: 'Carrfeour' })
    await seedLog({ documentId: DOC_OTHER, vendor: 'Lulu' })

    await renameVendor('Carrfeour', 'Carrefour')

    const other = await getReceiptDetail(DOC_OTHER)
    expect(other?.log.vendor).toBe('Lulu')
  })

  it('no-ops when nothing matches', async () => {
    const result = await renameVendor('Nonexistent Store', 'Carrefour')
    expect(result.count).toBe(0)
  })
})
