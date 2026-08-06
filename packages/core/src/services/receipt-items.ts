import { desc, inArray, like, sql } from 'drizzle-orm'
import { db, schema } from '../db'

interface LineItemInput {
  name?: unknown
  quantity?: unknown
  unitPrice?: unknown
  totalPrice?: unknown
}

/**
 * Records the line items from a processed receipt for cross-vendor price
 * comparison. Tolerant of malformed/missing fields since `line_items` shape
 * varies by workflow (custom workflows define their own JSON Schema).
 */
export async function recordReceiptItems(params: {
  documentId: number
  vendor?: string
  currency?: string
  purchaseDate?: string
  lineItems: unknown
}): Promise<void> {
  const { documentId, vendor, currency, purchaseDate, lineItems } = params

  if (!Array.isArray(lineItems) || lineItems.length === 0) return

  const now = new Date().toISOString()
  const rows: schema.NewReceiptItemEntry[] = []

  for (const raw of lineItems as LineItemInput[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) continue

    const totalPrice = typeof raw.totalPrice === 'number' ? Math.round(raw.totalPrice * 100) : null
    const unitPrice = typeof raw.unitPrice === 'number' ? Math.round(raw.unitPrice * 100) : null
    const quantity =
      typeof raw.quantity === 'number' && raw.quantity > 0 ? Math.round(raw.quantity) : 1

    rows.push({
      documentId,
      vendor,
      itemName: name,
      quantity,
      unitPrice,
      totalPrice,
      currency,
      purchaseDate,
      createdAt: now,
    })
  }

  if (rows.length === 0) return

  await db.insert(schema.receiptItems).values(rows).run()
}

/** Autocomplete: distinct item names seen so far, matching a search term. */
export async function searchItemNames(query: string, limit = 20): Promise<string[]> {
  const rows = await db
    .selectDistinct({ itemName: schema.receiptItems.itemName })
    .from(schema.receiptItems)
    .where(like(sql`lower(${schema.receiptItems.itemName})`, `%${query.toLowerCase()}%`))
    .limit(limit)
    .all()

  return rows.map((r) => r.itemName)
}

/** Price history for one or more (user-selected) item names, newest first. */
export async function getItemPriceHistory(itemNames: string[]): Promise<schema.ReceiptItemEntry[]> {
  if (itemNames.length === 0) return []

  return await db
    .select()
    .from(schema.receiptItems)
    .where(inArray(schema.receiptItems.itemName, itemNames))
    .orderBy(desc(schema.receiptItems.purchaseDate))
    .all()
}
