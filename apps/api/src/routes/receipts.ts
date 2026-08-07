import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  getReceiptDetail,
  updateReceipt,
  deleteReceipt,
  previewVendorRename,
  renameVendor,
} from '@sm-rn/core'

const receipts = new Hono()

/**
 * GET /api/receipts/vendor-rename-preview?from=Carrfeour
 *
 * Receipts that would be affected by renaming vendor `from` to something
 * else - reviewed before committing to a bulk rename. Registered ahead of
 * the /:documentId routes below since it's a static path.
 */
receipts.get(
  '/vendor-rename-preview',
  zValidator('query', z.object({ from: z.string().min(1) })),
  async (c) => {
    const { from } = c.req.valid('query')
    const rows = await previewVendorRename(from)
    return c.json({ rows })
  },
)

const VendorRenameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

/**
 * POST /api/receipts/vendor-rename
 *
 * Renames vendor `from` to `to` across every receipt with that vendor
 * (e.g. fixing a consistent AI misspelling across every visit to a store).
 */
receipts.post('/vendor-rename', zValidator('json', VendorRenameSchema), async (c) => {
  const { from, to } = c.req.valid('json')
  const result = await renameVendor(from, to)
  return c.json(result)
})

/**
 * GET /api/receipts/:documentId
 *
 * A processed receipt's extracted data plus its recorded line items, for
 * the receipt edit view.
 */
receipts.get('/:documentId', async (c) => {
  const documentId = parseInt(c.req.param('documentId'), 10)
  if (Number.isNaN(documentId)) return c.json({ error: 'Invalid documentId' }, 400)

  const detail = await getReceiptDetail(documentId)
  if (!detail) return c.json({ error: 'Receipt not found' }, 404)

  return c.json(detail)
})

const ReceiptEditSchema = z.object({
  vendor: z.string().min(1).optional(),
  amount: z.number().optional(),
  currency: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format')
    .optional(),
  // '' clears it (the edit dialog's Time field can be blanked out) -
  // distinct from omitting the field entirely, which leaves it untouched.
  time: z
    .union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'time must be in HH:MM format')])
    .optional(),
  category: z.string().min(1).optional(),
  storeLocation: z.string().optional(),
  taxAmount: z.number().nullable().optional(),
})

/**
 * PATCH /api/receipts/:documentId
 *
 * Corrects receipt-level extracted fields (vendor, total, currency, date,
 * category, store location).
 */
receipts.patch('/:documentId', zValidator('json', ReceiptEditSchema), async (c) => {
  const documentId = parseInt(c.req.param('documentId'), 10)
  if (Number.isNaN(documentId)) return c.json({ error: 'Invalid documentId' }, 400)

  const edits = c.req.valid('json')
  const updated = await updateReceipt(documentId, edits)
  if (!updated) return c.json({ error: 'Receipt not found' }, 404)

  return c.json({ log: updated })
})

/**
 * DELETE /api/receipts/:documentId
 *
 * Deletes ReceiptHero's tracking of a receipt (its log entry and recorded
 * line items) entirely. Does not touch the underlying document in
 * Paperless.
 */
receipts.delete('/:documentId', async (c) => {
  const documentId = parseInt(c.req.param('documentId'), 10)
  if (Number.isNaN(documentId)) return c.json({ error: 'Invalid documentId' }, 400)

  const deleted = await deleteReceipt(documentId)
  if (!deleted) return c.json({ error: 'Receipt not found' }, 404)

  return c.json({ success: true })
})

export default receipts
