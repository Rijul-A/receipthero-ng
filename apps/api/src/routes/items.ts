import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { searchItemNames, getItemPriceHistory, db, receiptItems } from '@sm-rn/core'
import { desc } from 'drizzle-orm'
import { toCsv } from '../lib/csv'

const items = new Hono()

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

export default items
