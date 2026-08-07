import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'

const updateDocumentCalls: Array<{ id: number; updates: Record<string, unknown> }> = []
const getOrCreateCorrespondentCalls: Array<string> = []
const ensureCustomFieldCalls: Array<string> = []

mock.module('../services/config', () => ({
  loadConfig: () => ({
    paperless: { host: 'http://paperless.test', apiKey: 'test-key' },
    processing: { processedTag: 'ai-processed' },
  }),
}))

mock.module('../services/ai-json', () => ({
  chatJson: async () => ({ items: [] }),
}))

mock.module('../services/paperless', () => ({
  PaperlessClient: class {
    async getOrCreateCorrespondent(name: string) {
      getOrCreateCorrespondentCalls.push(name)
      return 42
    }
    async ensureCustomField(name: string) {
      ensureCustomFieldCalls.push(name)
      return 7
    }
    async updateDocument(id: number, updates: Record<string, unknown>) {
      updateDocumentCalls.push({ id, updates })
    }
  },
}))

const { updateReceipt } = await import('../services/receipts')
const { updateReceiptItem, createReceiptItem, deleteReceiptItem, recordReceiptItems } =
  await import('../services/receipt-items')

const TEST_DOC_ID = 9_320_001

async function cleanup() {
  await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, TEST_DOC_ID)).run()
  await db
    .delete(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, TEST_DOC_ID))
    .run()
  await db.delete(schema.workflows).where(eq(schema.workflows.slug, 'sync-test-workflow')).run()
}

async function seedWorkflow(overrides: Partial<schema.NewWorkflow> = {}) {
  const now = new Date().toISOString()
  const [workflow] = await db
    .insert(schema.workflows)
    .values({
      name: 'Sync Test Workflow',
      slug: 'sync-test-workflow',
      triggerTag: 'receipt',
      zodSource: 'z.object({})',
      jsonSchema: '{}',
      titleTemplate: '{vendor} - {date} - {amount} {currency}',
      outputMapping: JSON.stringify({ correspondentField: 'vendor', dateField: 'date' }),
      processedTag: 'ai-processed',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
  return workflow
}

async function seedLog(workflowId: number) {
  const now = new Date().toISOString()
  await db
    .insert(schema.processingLogs)
    .values({
      documentId: TEST_DOC_ID,
      workflowId,
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
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

describe('syncReceiptToPaperless (via updateReceipt)', () => {
  beforeEach(async () => {
    await cleanup()
    updateDocumentCalls.length = 0
    getOrCreateCorrespondentCalls.length = 0
    ensureCustomFieldCalls.length = 0
  })
  afterEach(cleanup)

  it('pushes a recomputed title, correspondent, and created date after a vendor/date edit', async () => {
    const workflow = await seedWorkflow()
    await seedLog(workflow.id)

    await updateReceipt(TEST_DOC_ID, { vendor: 'Lulu', date: '2026-02-02' })

    expect(getOrCreateCorrespondentCalls).toEqual(['Lulu'])
    expect(updateDocumentCalls).toHaveLength(1)
    expect(updateDocumentCalls[0].id).toBe(TEST_DOC_ID)
    expect(updateDocumentCalls[0].updates).toEqual({
      title: 'Lulu - 2026-02-02 - 10 AED',
      correspondent: 42,
      created: '2026-02-02',
    })
  })

  it('still resyncs (title/correspondent/created recomputed from unchanged data) when only category changes', async () => {
    const workflow = await seedWorkflow()
    await seedLog(workflow.id)

    await updateReceipt(TEST_DOC_ID, { category: 'dining' })

    expect(updateDocumentCalls).toHaveLength(1)
    expect(updateDocumentCalls[0].updates.title).toBe('Carrefour - 2026-01-01 - 10 AED')
  })

  it('does not call Paperless at all when edits is empty', async () => {
    const workflow = await seedWorkflow()
    await seedLog(workflow.id)

    await updateReceipt(TEST_DOC_ID, {})

    expect(updateDocumentCalls).toHaveLength(0)
  })

  it('leaves the title untouched when the template references a field the data lacks', async () => {
    const workflow = await seedWorkflow({ titleTemplate: '{vendor} - {missingField}' })
    await seedLog(workflow.id)

    await updateReceipt(TEST_DOC_ID, { vendor: 'Lulu' })

    expect(updateDocumentCalls).toHaveLength(1)
    expect(updateDocumentCalls[0].updates.title).toBeUndefined()
    // correspondent still applies independently of the broken title template
    expect(updateDocumentCalls[0].updates.correspondent).toBe(42)
  })

  it('rewrites a "*"-mapped custom field (e.g. json_payload) with the full corrected extractedData, including current line items', async () => {
    const workflow = await seedWorkflow({
      outputMapping: JSON.stringify({
        correspondentField: 'vendor',
        dateField: 'date',
        customFields: { json_payload: '*' },
      }),
    })
    await seedLog(workflow.id)
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: {} as never,
    })
    updateDocumentCalls.length = 0 // recordReceiptItems doesn't sync - only clear noise, not asserting on it

    await updateReceipt(TEST_DOC_ID, { vendor: 'Lulu' })

    expect(ensureCustomFieldCalls).toEqual(['json_payload'])
    const customFields = updateDocumentCalls[0].updates.custom_fields as Array<{
      field: number
      value: string
    }>
    expect(customFields).toHaveLength(1)
    expect(customFields[0].field).toBe(7)
    const payload = JSON.parse(customFields[0].value)
    expect(payload.vendor).toBe('Lulu')
    expect(payload.line_items).toEqual([{ name: 'Milk', quantity: 1, totalPrice: 5, unitPrice: 5 }])
  })
})

describe('item-level edits also resync Paperless', () => {
  beforeEach(async () => {
    await cleanup()
    updateDocumentCalls.length = 0
    getOrCreateCorrespondentCalls.length = 0
    ensureCustomFieldCalls.length = 0
  })
  afterEach(cleanup)

  it('updateReceiptItem resyncs, reflecting the item correction in line_items', async () => {
    const workflow = await seedWorkflow({
      outputMapping: JSON.stringify({ customFields: { json_payload: '*' } }),
    })
    await seedLog(workflow.id)
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: {} as never,
    })
    const [item] = await db
      .select()
      .from(schema.receiptItems)
      .where(eq(schema.receiptItems.documentId, TEST_DOC_ID))
      .all()
    updateDocumentCalls.length = 0

    await updateReceiptItem(item.id, { totalPrice: 9 })

    expect(updateDocumentCalls).toHaveLength(1)
    const customFields = updateDocumentCalls[0].updates.custom_fields as Array<{
      field: number
      value: string
    }>
    const payload = JSON.parse(customFields[0].value)
    expect(payload.line_items[0].totalPrice).toBe(9)
  })

  it('createReceiptItem resyncs with the new item included', async () => {
    const workflow = await seedWorkflow({
      outputMapping: JSON.stringify({ customFields: { json_payload: '*' } }),
    })
    await seedLog(workflow.id)

    await createReceiptItem({ documentId: TEST_DOC_ID, itemName: 'Bread', totalPrice: 3 })

    expect(updateDocumentCalls).toHaveLength(1)
    const customFields = updateDocumentCalls[0].updates.custom_fields as Array<{
      field: number
      value: string
    }>
    const payload = JSON.parse(customFields[0].value)
    expect(payload.line_items).toHaveLength(1)
    expect(payload.line_items[0].name).toBe('Bread')
  })

  it('deleteReceiptItem resyncs with the item removed', async () => {
    const workflow = await seedWorkflow({
      outputMapping: JSON.stringify({ customFields: { json_payload: '*' } }),
    })
    await seedLog(workflow.id)
    await recordReceiptItems({
      documentId: TEST_DOC_ID,
      lineItems: [{ name: 'Milk', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      config: {} as never,
    })
    const [item] = await db
      .select()
      .from(schema.receiptItems)
      .where(eq(schema.receiptItems.documentId, TEST_DOC_ID))
      .all()
    updateDocumentCalls.length = 0

    await deleteReceiptItem(item.id)

    expect(updateDocumentCalls).toHaveLength(1)
    const customFields = updateDocumentCalls[0].updates.custom_fields as Array<{
      field: number
      value: string
    }>
    const payload = JSON.parse(customFields[0].value)
    expect(payload.line_items).toEqual([])
  })
})
