import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../db'

export interface ReceiptDetail {
  log: schema.ProcessingLogEntry
  items: schema.ReceiptItemEntry[]
}

/** Fetches a processed receipt's log entry plus its recorded line items, for the edit UI. */
export async function getReceiptDetail(documentId: number): Promise<ReceiptDetail | null> {
  const log = await db
    .select()
    .from(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, documentId))
    .orderBy(desc(schema.processingLogs.id))
    .get()
  if (!log) return null

  const items = await db
    .select()
    .from(schema.receiptItems)
    .where(eq(schema.receiptItems.documentId, documentId))
    .all()

  return { log, items }
}

export interface ReceiptEdit {
  vendor?: string
  amount?: number // major units (e.g. dollars) - internal use only; not user-settable via the edit UI, see recalculateReceiptTotal
  currency?: string
  date?: string
  time?: string // HH:MM, display/edit only - not used by any date-bucketing logic
  category?: string
  storeLocation?: string
}

/**
 * Applies manual corrections to a receipt's extracted data. `date`, `time`,
 * and `category` only ever live inside the `receiptData` JSON blob (no
 * dedicated columns), so they're merged into that JSON; `vendor`, `amount`,
 * `currency`, and `storeLocation` also have their own columns (read by
 * currency-totals/spending-report/CSV export) and are kept in sync with the
 * same values.
 *
 * `vendor`, `currency`, and `storeLocation` are also denormalized onto every
 * receipt_items row for this document (recordReceiptItems always writes them
 * equal to the receipt's own values), so correcting them here has to cascade
 * to those rows too - otherwise price comparison keeps grouping/filtering
 * this receipt's items under the old, now-wrong value (e.g. a vendor-name
 * correction would silently split one store into two buckets on the Prices
 * page, or a currency correction would leave items excluded from
 * comparisons under the wrong currency).
 */
export async function updateReceipt(
  documentId: number,
  edits: ReceiptEdit,
): Promise<schema.ProcessingLogEntry | null> {
  const existing = await db
    .select()
    .from(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, documentId))
    .orderBy(desc(schema.processingLogs.id))
    .get()
  if (!existing) return null

  const raw = existing.receiptData || existing.extractedData
  let parsed: Record<string, unknown> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = {}
    }
  }

  if (edits.vendor !== undefined) parsed.vendor = edits.vendor
  if (edits.amount !== undefined) parsed.amount = edits.amount
  if (edits.currency !== undefined) parsed.currency = edits.currency
  if (edits.date !== undefined) parsed.date = edits.date
  if (edits.time !== undefined) parsed.time = edits.time
  if (edits.category !== undefined) parsed.category = edits.category
  if (edits.storeLocation !== undefined) parsed.storeLocation = edits.storeLocation

  const updates: Partial<schema.NewProcessingLogEntry> = {
    receiptData: JSON.stringify(parsed),
    updatedAt: new Date().toISOString(),
  }
  if (edits.vendor !== undefined) updates.vendor = edits.vendor
  if (edits.amount !== undefined) updates.amount = Math.round(edits.amount * 100)
  if (edits.currency !== undefined) updates.currency = edits.currency
  if (edits.storeLocation !== undefined) updates.storeLocation = edits.storeLocation

  const itemUpdates: Partial<schema.NewReceiptItemEntry> = {}
  if (edits.vendor !== undefined) itemUpdates.vendor = edits.vendor
  if (edits.currency !== undefined) itemUpdates.currency = edits.currency
  if (edits.storeLocation !== undefined) itemUpdates.storeLocation = edits.storeLocation

  await db
    .update(schema.processingLogs)
    .set(updates)
    .where(eq(schema.processingLogs.id, existing.id))
    .run()

  if (Object.keys(itemUpdates).length > 0) {
    await db
      .update(schema.receiptItems)
      .set(itemUpdates)
      .where(eq(schema.receiptItems.documentId, documentId))
      .run()
  }

  return (
    (await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.id, existing.id))
      .get()) ?? null
  )
}

/**
 * Recomputes a receipt's total from the sum of its currently-recorded line
 * items' totalPrice, and persists it. The total is intentionally never
 * directly user-editable - it should always reflect what the line items
 * actually say, so it's derived after every item edit (or deletion)
 * instead.
 *
 * By default, no-ops if the receipt has no recorded line items - nothing to
 * derive from (some receipts predate line-item recording, or come from
 * custom workflows with no line_items), so the existing stored total is
 * left untouched rather than being zeroed out for a document that simply
 * never had items in the first place. Pass `force: true` when the caller
 * knows items existed a moment ago (e.g. the last one was just deleted),
 * where zero items really does mean the total should become zero.
 */
export async function recalculateReceiptTotal(
  documentId: number,
  options: { force?: boolean } = {},
): Promise<number | null> {
  const items = await db
    .select()
    .from(schema.receiptItems)
    .where(eq(schema.receiptItems.documentId, documentId))
    .all()
  if (items.length === 0 && !options.force) return null

  const totalCents = items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0)
  const total = totalCents / 100
  await updateReceipt(documentId, { amount: total })
  return total
}

export interface VendorRenamePreviewRow {
  documentId: number
  fileName: string | null
  vendor: string | null
  storeLocation: string | null
  amount: number | null
  currency: string | null
}

/** Latest processing_logs row per documentId - a document can have more than one row (retries), but only the newest is live. */
async function latestLogPerDocument(): Promise<schema.ProcessingLogEntry[]> {
  const logs = await db
    .select()
    .from(schema.processingLogs)
    .orderBy(desc(schema.processingLogs.id))
    .all()

  const seen = new Set<number>()
  const latest: schema.ProcessingLogEntry[] = []
  for (const log of logs) {
    if (seen.has(log.documentId)) continue
    seen.add(log.documentId)
    latest.push(log)
  }
  return latest
}

/**
 * Receipts (one row per document) that would be affected by renaming vendor
 * `from` to something else - reviewed before committing, same as the item
 * canonical-name rename tool on the Prices page. Matches case-insensitively,
 * same reasoning as getVendorSpendReport grouping.
 */
export async function previewVendorRename(from: string): Promise<VendorRenamePreviewRow[]> {
  const fromLower = from.trim().toLowerCase()
  const logs = await latestLogPerDocument()

  return logs
    .filter((log) => (log.vendor ?? '').toLowerCase() === fromLower)
    .map((log) => ({
      documentId: log.documentId,
      fileName: log.fileName,
      vendor: log.vendor,
      storeLocation: log.storeLocation,
      amount: log.amount,
      currency: log.currency,
    }))
}

/**
 * Renames vendor `from` to `to` across every receipt with that vendor
 * (case-insensitive match) - for correcting a systemically-wrong AI
 * extraction (e.g. a consistent typo) across every receipt from a store at
 * once, rather than fixing each receipt individually.
 *
 * Reuses updateReceipt per document rather than writing directly to the
 * columns, so the vendor correction cascades to receipt_items.vendor the
 * same way a single-receipt edit does - required to keep price comparison
 * grouping consistent (see updateReceipt's own docs).
 */
export async function renameVendor(from: string, to: string): Promise<{ count: number }> {
  const trimmedTo = to.trim()
  if (!trimmedTo) return { count: 0 }

  const affected = await previewVendorRename(from)
  if (affected.length === 0) return { count: 0 }

  for (const row of affected) {
    await updateReceipt(row.documentId, { vendor: trimmedTo })
  }

  return { count: affected.length }
}

/**
 * Deletes a receipt entirely - its processing_logs row(s) and every
 * receipt_items row recorded for it. This only removes ReceiptHero's own
 * tracking of the document; it never touches the underlying document in
 * Paperless, which stays the source of truth for the file itself. If the
 * same Paperless document gets reprocessed later, it's tracked fresh.
 */
export async function deleteReceipt(documentId: number): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.processingLogs)
    .where(eq(schema.processingLogs.documentId, documentId))
    .get()
  if (!existing) return false

  db.transaction((tx) => {
    tx.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, documentId)).run()
    tx.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, documentId)).run()
  })

  return true
}
