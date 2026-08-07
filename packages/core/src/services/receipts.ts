import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { loadConfig } from './config'
import { PaperlessClient } from './paperless'
import { interpolateTemplate } from './template'
import { normalizeDateForPaperless } from './date-format'
import { createLogger } from './logger'
import type { WorkflowOutputMapping } from '@sm-rn/shared/workflow-schemas'

const logger = createLogger('core')

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
    .orderBy(schema.receiptItems.sortOrder, schema.receiptItems.id)
    .all()

  return { log, items }
}

/**
 * Best-effort push of the CURRENT DB state (receipt fields + line items)
 * back onto the underlying Paperless document, so nothing stays
 * permanently stuck on whatever the original AI extraction produced once
 * a user corrects it. Rebuilds `extractedData` fresh from the DB (not
 * whatever the caller happens to have in hand) so this stays correct
 * regardless of which edit triggered it - a receipt-field edit, a single
 * item's price/name correction, an add, a delete, or a reorder.
 *
 * Applies the same titleTemplate/correspondentField/dateField/customFields
 * the workflow itself would have applied during normal processing,
 * recomputed from the now-corrected data - including re-writing the
 * `'*'`-mapped custom field (json_payload by default) with the full
 * corrected payload, so it doesn't silently drift from what's actually
 * true once someone edits a line item.
 *
 * Failure here (Paperless unreachable, document deleted upstream, etc.)
 * is logged and swallowed - the local correction has already been saved
 * and should not be undone by a sync step that's inherently best-effort.
 * Callers should fire this after their own DB write completes, without
 * awaiting it block their response if that matters - it's safe to run
 * concurrently with other in-flight syncs for the same document since it
 * always reads fresh state at the moment it runs.
 */
export async function syncReceiptToPaperless(documentId: number): Promise<void> {
  const docLogger = logger.withDocument(documentId)
  try {
    const existing = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, documentId))
      .orderBy(desc(schema.processingLogs.id))
      .get()
    if (!existing) return

    const workflow = existing.workflowId
      ? await db
          .select()
          .from(schema.workflows)
          .where(eq(schema.workflows.id, existing.workflowId))
          .get()
      : await db.select().from(schema.workflows).where(eq(schema.workflows.slug, 'receipt')).get()
    if (!workflow) return

    const raw = existing.receiptData || existing.extractedData
    let parsed: Record<string, unknown> = {}
    if (raw) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = {}
      }
    }

    const items = await db
      .select()
      .from(schema.receiptItems)
      .where(eq(schema.receiptItems.documentId, documentId))
      .orderBy(schema.receiptItems.sortOrder, schema.receiptItems.id)
      .all()

    // Column values (vendor/amount/currency) are the source of truth - kept
    // in sync with receiptData by updateReceipt - so they win over whatever
    // the JSON blob says. Everything else (date/time/category/taxAmount/
    // title/summary) only ever lives in the JSON, with no dedicated column.
    const extractedData: Record<string, unknown> = {
      ...parsed,
      vendor: existing.vendor ?? parsed.vendor,
      amount: existing.amount !== null ? existing.amount / 100 : parsed.amount,
      currency: existing.currency ?? parsed.currency,
      line_items: items.map((item) => ({
        name: item.canonicalName ?? item.itemName,
        quantity: item.quantity,
        totalPrice: item.totalPrice !== null ? item.totalPrice / 100 : null,
        ...(item.unitPrice !== null ? { unitPrice: item.unitPrice / 100 } : {}),
      })),
    }

    const config = loadConfig()
    const client = new PaperlessClient({
      host: config.paperless.host,
      apiKey: config.paperless.apiKey,
      processedTagName: config.processing.processedTag,
    })

    const updates: {
      title?: string
      created?: string
      correspondent?: number
      custom_fields?: Array<{ field: number; value: string }>
    } = {}

    if (workflow.titleTemplate) {
      const interpolatedTitle = interpolateTemplate(workflow.titleTemplate, extractedData)
      if (!/{[a-zA-Z_]\w*}/.test(interpolatedTitle)) {
        updates.title = interpolatedTitle
      }
    }

    const mapping: WorkflowOutputMapping = JSON.parse(workflow.outputMapping)
    if (mapping.correspondentField && extractedData[mapping.correspondentField]) {
      updates.correspondent = await client.getOrCreateCorrespondent(
        String(extractedData[mapping.correspondentField]),
      )
    }
    if (mapping.dateField && extractedData[mapping.dateField]) {
      const normalizedDate = normalizeDateForPaperless(String(extractedData[mapping.dateField]))
      if (normalizedDate) updates.created = normalizedDate
    }

    if (mapping.customFields && Object.keys(mapping.customFields).length > 0) {
      const customFields: Array<{ field: number; value: string }> = []
      for (const [paperlessField, extractedField] of Object.entries(mapping.customFields)) {
        try {
          const fieldId = await client.ensureCustomField(paperlessField, 'longtext')
          const val =
            extractedField === '*'
              ? JSON.stringify(extractedData)
              : String(extractedData[extractedField as string] || '')
          if (val) customFields.push({ field: fieldId, value: val })
        } catch {
          docLogger.warn(`Failed to sync custom field ${paperlessField} to Paperless`)
        }
      }
      if (customFields.length > 0) updates.custom_fields = customFields
    }

    if (Object.keys(updates).length === 0) return
    await client.updateDocument(documentId, updates)
    docLogger.info('Synced receipt correction to Paperless document', {
      fields: Object.keys(updates),
    })
  } catch (error) {
    docLogger.warn(
      'Failed to sync receipt correction to Paperless - local correction still saved',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

export interface ReceiptEdit {
  vendor?: string
  amount?: number // major units (e.g. dollars) - internal use only; not user-settable via the edit UI, see recalculateReceiptTotal
  currency?: string
  date?: string
  time?: string // HH:MM, display/edit only - not used by any date-bucketing logic
  category?: string
  storeLocation?: string
  // Major units, like amount. null explicitly clears it (receipt's line
  // items are tax-inclusive, or the tax portion just isn't known) -
  // undefined leaves whatever's already stored untouched.
  taxAmount?: number | null
}

/**
 * Applies manual corrections to a receipt's extracted data. `date`, `time`,
 * `category`, and `taxAmount` only ever live inside the `receiptData` JSON
 * blob (no dedicated columns), so they're merged into that JSON; `vendor`, `amount`,
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
  if (edits.taxAmount !== undefined) parsed.taxAmount = edits.taxAmount

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

  // The json_payload custom field (if mapped) reflects the whole corrected
  // extractedData, so any field edit is worth a resync, not just the ones
  // that feed the title/correspondent/date.
  if (Object.keys(edits).length > 0) {
    await syncReceiptToPaperless(documentId)
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
