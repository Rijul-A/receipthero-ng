import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getReceiptDetail, updateReceipt } from '@sm-rn/core'

const receipts = new Hono()

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
  date: z.string().min(1).optional(),
  time: z.string().optional(),
  category: z.string().min(1).optional(),
  storeLocation: z.string().optional(),
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

export default receipts
