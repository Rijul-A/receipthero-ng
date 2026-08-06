import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { ConfigSchema } from '@sm-rn/shared/schemas'
import { db, schema } from '../db'

let chatJsonImpl: (args: unknown) => unknown = () => ({ items: [] })
mock.module('../services/ai-json', () => ({
  chatJson: async (args: unknown) => chatJsonImpl(args),
}))

const {
  recordReceiptItems,
  getItemPriceHistory,
  updateReceiptItem,
  previewCanonicalRename,
  renameCanonicalGroup,
  upsertItemNameOverride,
} = await import('../services/receipt-items')

const mockConfig = ConfigSchema.parse({
  paperless: {},
  processing: {},
  ai: { provider: 'ollama', model: 'test-model' },
})

const TEST_DOC_ID = 9_200_001
const TEST_DOC_ID_2 = 9_200_002

// Distinct raw names (never reused elsewhere in the test suite) so this
// file's overrides can't leak into or collide with other test files sharing
// the same real test database.
const OVERRIDE_RAW_NAMES = ['kombucha 500ml', 'widget item 9200', 'almond drink 1l']

async function cleanup(...documentIds: number[]) {
  for (const id of documentIds) {
    await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, id)).run()
    await db.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, id)).run()
  }
  await db
    .delete(schema.itemNameOverrides)
    .where(inArray(schema.itemNameOverrides.rawItemNameLower, OVERRIDE_RAW_NAMES))
    .run()
}

describe('name overrides', () => {
  beforeEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
    chatJsonImpl = () => ({ items: [] })
  })
  afterEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
  })

  it('uses a stored override instead of the AI guess for a matching raw name, case-insensitively', async () => {
    await upsertItemNameOverride('Kombucha 500ml', 'Kombucha')

    // The AI would otherwise guess something else entirely.
    chatJsonImpl = () => ({
      items: [
        { raw: 'KOMBUCHA 500ML', canonical: 'Fermented Tea Drink', totalSize: 500, sizeUnit: 'ml' },
      ],
    })

    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'KOMBUCHA 500ML', quantity: 1, unitPrice: 8, totalPrice: 8 }],
      config: mockConfig,
    })

    const rows = await getItemPriceHistory(['Kombucha'])
    expect(rows).toHaveLength(1)
    expect(rows[0].canonicalName).toBe('Kombucha')
    // Size annotation from the AI is still used even though naming was overridden.
    expect(rows[0].totalSize).toBe(500)
  })
})

describe('updateReceiptItem', () => {
  beforeEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
    chatJsonImpl = () => ({ items: [] })
  })
  afterEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
  })

  it('corrects a single row without affecting other rows of the same raw name', async () => {
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Widget Item 9200', quantity: 1, unitPrice: 3, totalPrice: 3 }],
      config: mockConfig,
    })
    await recordReceiptItems({
      documentId: TEST_DOC_ID_2,
      lineItems: [{ name: 'Widget Item 9200', quantity: 1, unitPrice: 3, totalPrice: 3 }],
      config: mockConfig,
    })

    const [row1] = await getItemPriceHistory(['Widget Item 9200'])
    await updateReceiptItem(row1.id, {
      canonicalName: 'Sparkling Water',
      quantity: 2,
      totalPrice: 6,
    })

    const corrected = await db
      .select()
      .from(schema.receiptItems)
      .where(eq(schema.receiptItems.id, row1.id))
      .get()
    expect(corrected?.canonicalName).toBe('Sparkling Water')
    expect(corrected?.quantity).toBe(2)
    expect(corrected?.totalPrice).toBe(600)

    // The other document's row, sharing the same raw name, is untouched.
    const untouched = await getItemPriceHistory(['Widget Item 9200'])
    expect(untouched).toHaveLength(1)
    expect(untouched[0].documentId).toBe(TEST_DOC_ID_2)
  })

  it('recording a future receipt with the same raw name now uses the corrected canonical name', async () => {
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Widget Item 9200', quantity: 1, unitPrice: 3, totalPrice: 3 }],
      config: mockConfig,
    })
    const [row] = await getItemPriceHistory(['Widget Item 9200'])
    await updateReceiptItem(row.id, { canonicalName: 'Sparkling Water' })

    await recordReceiptItems({
      documentId: TEST_DOC_ID_2,
      lineItems: [{ name: 'Widget Item 9200', quantity: 1, unitPrice: 3, totalPrice: 3 }],
      config: mockConfig,
    })

    const rows = await getItemPriceHistory(['Sparkling Water'])
    expect(rows.map((r) => r.documentId).sort()).toEqual([TEST_DOC_ID, TEST_DOC_ID_2])
  })
})

describe('bulk canonical rename', () => {
  beforeEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
    chatJsonImpl = () => ({ items: [] })
  })
  afterEach(async () => {
    await cleanup(TEST_DOC_ID, TEST_DOC_ID_2)
  })

  it('previews affected rows without changing anything', async () => {
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Almond Drink 1L', quantity: 1, unitPrice: 10, totalPrice: 10 }],
      config: mockConfig,
    })

    const preview = await previewCanonicalRename('Almond Drink 1L')
    expect(preview).toHaveLength(1)

    const stillOriginal = await getItemPriceHistory(['Almond Drink 1L'])
    expect(stillOriginal).toHaveLength(1)
  })

  it('renames every row in the group and future receipts with the same raw names', async () => {
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Almond Drink 1L', quantity: 1, unitPrice: 10, totalPrice: 10 }],
      config: mockConfig,
    })
    await recordReceiptItems({
      documentId: TEST_DOC_ID_2,
      lineItems: [{ name: 'Almond Drink 1L', quantity: 1, unitPrice: 11, totalPrice: 11 }],
      config: mockConfig,
    })

    const result = await renameCanonicalGroup('Almond Drink 1L', 'Almond Milk')
    expect(result.count).toBe(2)

    const renamed = await getItemPriceHistory(['Almond Milk'])
    expect(renamed).toHaveLength(2)

    // A third, later receipt with the same raw text picks up the rename too.
    await db
      .delete(schema.receiptItems)
      .where(eq(schema.receiptItems.documentId, TEST_DOC_ID))
      .run()
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Almond Drink 1L', quantity: 1, unitPrice: 10, totalPrice: 10 }],
      config: mockConfig,
    })
    const afterReprocess = await getItemPriceHistory(['Almond Milk'])
    expect(afterReprocess.some((r) => r.documentId === TEST_DOC_ID)).toBe(true)
  })
})
