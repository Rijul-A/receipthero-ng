import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  searchItemNames,
  getItemPriceHistory,
  createReceiptItem,
  updateReceiptItem,
  deleteReceiptItem,
  previewCanonicalRename,
  renameCanonicalGroup,
  getItemFrequencyReport,
  getItemCountsByDocument,
  db,
  receiptItems,
} from '@sm-rn/core'
import { desc } from 'drizzle-orm'
import { toCsv } from '../lib/csv'

const items = new Hono()

/**
 * GET /api/items/frequency?limit=50&startDate=...&endDate=...
 *
 * Per-product total spend and purchase frequency across all recorded line
 * items - "how much have I spent on X, and how often do I buy it".
 * startDate/endDate (both optional, inclusive) filter to items whose own
 * purchaseDate falls in that range.
 */
items.get(
  '/frequency',
  zValidator(
    'query',
    z.object({
      limit: z.coerce.number().int().positive().max(200).default(50),
      startDate: z.string().min(1).optional(),
      endDate: z.string().min(1).optional(),
    }),
  ),
  async (c) => {
    const { limit, startDate, endDate } = c.req.valid('query')
    const rows = await getItemFrequencyReport(limit, { start: startDate, end: endDate })
    return c.json({ rows })
  },
)

/**
 * GET /api/items/counts?documentIds=1,2,3
 *
 * Number of recorded line items per document - used to flag processed
 * receipts that came back with zero items (a valid-but-useless AI
 * response, since line_items is optional in the extraction schema) so
 * they're easy to spot and reprocess.
 */
items.get(
  '/counts',
  zValidator('query', z.object({ documentIds: z.string().min(1) })),
  async (c) => {
    const { documentIds } = c.req.valid('query')
    const ids = documentIds
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id))
    const counts = await getItemCountsByDocument(ids)
    return c.json({ counts })
  },
)

/**
 * GET /api/items/search?q=milk
 *
 * Autocomplete over distinct item names seen across processed receipts.
 */
items.get('/search', zValidator('query', z.object({ q: z.string().min(1) })), async (c) => {
  const { q } = c.req.valid('query')
  const names = await searchItemNames(q)
  return c.json({ names })
})

/**
 * GET /api/items/history?names=Milk%201L,Almarai%20Milk
 *
 * Price history (newest first) for one or more user-selected item names,
 * for cross-vendor comparison.
 */
items.get('/history', zValidator('query', z.object({ names: z.string().min(1) })), async (c) => {
  const { names } = c.req.valid('query')
  const itemNames = names
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  const history = await getItemPriceHistory(itemNames)
  return c.json({ history })
})

/**
 * GET /api/items/export
 *
 * CSV export of every recorded line item, for analysis (e.g. pivot tables)
 * outside the app.
 */
items.get('/export', async (c) => {
  const rows = await db.query.receiptItems.findMany({
    orderBy: desc(receiptItems.purchaseDate),
  })

  const csvRows = rows.map((row) => ({
    documentId: row.documentId,
    vendor: row.vendor ?? '',
    itemName: row.itemName,
    canonicalName: row.canonicalName ?? row.itemName,
    quantity: row.quantity,
    totalSize: row.totalSize ?? '',
    sizeUnit: row.sizeUnit ?? '',
    unitPrice: row.unitPrice !== null ? (row.unitPrice / 100).toFixed(2) : '',
    totalPrice: row.totalPrice !== null ? (row.totalPrice / 100).toFixed(2) : '',
    currency: row.currency ?? '',
    purchaseDate: row.purchaseDate ?? '',
  }))

  const csv = toCsv(csvRows, [
    'documentId',
    'vendor',
    'itemName',
    'canonicalName',
    'quantity',
    'totalSize',
    'sizeUnit',
    'unitPrice',
    'totalPrice',
    'currency',
    'purchaseDate',
  ])

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="receipt-items.csv"')
  return c.body(csv)
})

const NewItemSchema = z.object({
  documentId: z.number().int().positive(),
  itemName: z.string().min(1),
  quantity: z.number().positive().optional(),
  totalPrice: z.number().nullable().optional(),
  totalSize: z.number().positive().nullable().optional(),
  sizeUnit: z.enum(['ml', 'g', 'count']).nullable().optional(),
})

/**
 * POST /api/items
 *
 * Adds a manually-entered line item to a receipt - for a breakdown line
 * the AI missed entirely.
 */
items.post('/', zValidator('json', NewItemSchema), async (c) => {
  const input = c.req.valid('json')
  const item = await createReceiptItem(input)
  if (!item) return c.json({ error: 'Receipt not found' }, 404)

  return c.json({ item }, 201)
})

const ItemEditSchema = z.object({
  itemName: z.string().min(1).optional(),
  canonicalName: z.string().min(1).optional(),
  unitPrice: z.number().optional(),
  totalPrice: z.number().nullable().optional(),
  quantity: z.number().int().positive().optional(),
  totalSize: z.number().positive().nullable().optional(),
  sizeUnit: z.enum(['ml', 'g', 'count']).nullable().optional(),
  storeLocation: z.string().optional(),
  sortOrder: z.number().int().optional(),
})

/**
 * PATCH /api/items/:id
 *
 * Corrects a single receipt-item row (per-row, not per-product) - e.g. the
 * AI mis-grouped one specific occurrence, or the price/quantity was
 * extracted wrong. Correcting canonicalName also records a raw-name
 * override for future receipts with that exact raw text.
 */
items.patch('/:id', zValidator('json', ItemEditSchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid item id' }, 400)

  const edits = c.req.valid('json')
  const updated = await updateReceiptItem(id, edits)
  if (!updated) return c.json({ error: 'Item not found' }, 404)

  return c.json({ item: updated })
})

/**
 * DELETE /api/items/:id
 *
 * Removes a single line item (e.g. a refund/discount/free line the user
 * wants off the receipt entirely). Recalculates the receipt's total
 * afterward.
 */
items.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid item id' }, 400)

  const deleted = await deleteReceiptItem(id)
  if (!deleted) return c.json({ error: 'Item not found' }, 404)

  return c.json({ success: true })
})

/**
 * GET /api/items/rename-preview?from=Almond%20Milk
 *
 * Rows that would be affected by renaming canonical product `from` to
 * something else - reviewed before committing to a bulk rename.
 */
items.get(
  '/rename-preview',
  zValidator('query', z.object({ from: z.string().min(1) })),
  async (c) => {
    const { from } = c.req.valid('query')
    const rows = await previewCanonicalRename(from)
    return c.json({ rows })
  },
)

const RenameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

/**
 * POST /api/items/rename
 *
 * Renames every row currently grouped under canonical name `from` to `to`
 * (merging two product groups, or fixing a systemically-wrong AI guess).
 */
items.post('/rename', zValidator('json', RenameSchema), async (c) => {
  const { from, to } = c.req.valid('json')
  const result = await renameCanonicalGroup(from, to)
  return c.json(result)
})

export default items
