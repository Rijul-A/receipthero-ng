import { desc, eq, inArray, like, sql } from 'drizzle-orm'
import type { Config } from '@sm-rn/shared/schemas'
import { db, schema } from '../db'
import { chatJson } from './ai-json'
import { createLogger } from './logger'
import { recalculateReceiptTotal } from './receipts'

const logger = createLogger('core')

interface LineItemInput {
  name?: unknown
  quantity?: unknown
  unitPrice?: unknown
  totalPrice?: unknown
}

interface ParsedLineItem {
  name: string
  quantity: number
  unitPrice: number | null
  totalPrice: number | null
}

interface ItemAnnotation {
  canonicalName: string
  totalSize: number | null
  sizeUnit: 'ml' | 'g' | 'count' | null
}

// SQLite has no dedicated NULL-coalescing column expression in drizzle-orm,
// so this raw fragment stands in for "canonicalName, falling back to itemName"
// wherever we group/match/search by product identity.
const canonicalOrItemName = sql<string>`coalesce(${schema.receiptItems.canonicalName}, ${schema.receiptItems.itemName})`

/**
 * Asks the AI provider to, for each new line item:
 * 1. Assign a canonical product name (reusing an existing one where the same
 *    product appears worded differently across receipts/stores/languages),
 *    grouping *by product*, not by pack size/configuration — "Diet Coke
 *    330ml x6" and "Diet Coke 150ml x15" are the same product.
 * 2. Extract the line's total size (volume/weight, normalized to ml/g,
 *    covering the full quantity purchased — same scope as totalPrice), so
 *    differently-packaged versions of the same product can still be ranked
 *    correctly by true unit price (price per 100ml/100g) instead of by raw
 *    pack price, which would unfairly favor smaller packs.
 *
 * One batched call per receipt rather than per item to keep this cheap, and
 * per-call rather than per-search so browsing /prices never triggers an AI
 * request.
 *
 * Best-effort: on any failure, falls back to raw names with no size info, so
 * a flaky/local AI provider never blocks receipt processing.
 */
async function annotateLineItems(
  items: ParsedLineItem[],
  config: Config,
): Promise<Record<string, ItemAnnotation>> {
  const identity: Record<string, ItemAnnotation> = Object.fromEntries(
    items.map((i) => [i.name, { canonicalName: i.name, totalSize: null, sizeUnit: null }]),
  )

  try {
    const existing = await db
      .selectDistinct({ name: canonicalOrItemName })
      .from(schema.receiptItems)
      .orderBy(desc(schema.receiptItems.createdAt))
      .limit(300)
      .all()
    const existingNames = existing.map((r) => r.name)

    const result = await chatJson<{
      items: {
        raw: string
        canonical: string
        totalSize: number | null
        sizeUnit: 'ml' | 'g' | 'count' | null
      }[]
    }>({
      config,
      schemaName: 'item_annotation',
      systemPrompt: [
        'You analyze grocery/retail receipt line items for cross-vendor price comparison.',
        'Each input item has a "name" and the "quantity" of that item purchased on this',
        'line (e.g. quantity 2 means two of that pack were bought, and its totalPrice',
        'already covers both). For each item, determine two things:',
        '',
        '1. canonical: the underlying PRODUCT identity, ignoring store-specific phrasing,',
        '   brand word ordering, language differences, and pack size/configuration.',
        '   "Diet Coke 330ml x6" and "Diet Coke 150ml x15" are the SAME product',
        '   ("Diet Coke") even though their pack sizes differ - pack size is handled',
        '   separately via totalSize/sizeUnit, not by keeping products apart.',
        '   Reuse an existing canonical name from the provided list when it refers to',
        '   the same product. Do not merge genuinely different products (e.g. "Diet',
        '   Coke" and "Coke Zero" stay separate) just because they are similar.',
        '',
        '2. totalSize/sizeUnit: the TOTAL volume or weight across the full quantity',
        '   purchased on this line (same scope as its price), normalized to',
        '   milliliters ("ml") or grams ("g"). E.g. name "Diet Coke 6x330ml" with',
        '   quantity 1 is totalSize 1980 ("ml"); quantity 2 of that same pack is',
        '   totalSize 3960 ("ml") - always multiply the per-pack size by quantity.',
        '   "2kg" is totalSize 2000 ("g"); "1L" is totalSize 1000 ("ml"). If the item',
        '   has no meaningful volume/weight (a single unsized item, a service, a gift',
        '   card), use totalSize as the item count and sizeUnit "count", or both null',
        '   if not even a count is meaningful.',
      ].join('\n'),
      userPrompt: JSON.stringify({
        existingCanonicalNames: existingNames,
        items: items.map((i) => ({ name: i.name, quantity: i.quantity })),
      }),
      responseSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                raw: { type: 'string' },
                canonical: { type: 'string' },
                totalSize: { type: ['number', 'null'] },
                sizeUnit: { type: ['string', 'null'], enum: ['ml', 'g', 'count', null] },
              },
              required: ['raw', 'canonical', 'totalSize', 'sizeUnit'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    })

    // The model is told to reuse an existing canonical name when it
    // recognizes the same product, but nothing forces it to reproduce that
    // name byte-for-byte — it might return "diet coke" against an existing
    // "Diet Coke". Since SQLite string comparison is case-sensitive, that
    // would silently fragment one product into two groups over time. Snap
    // to the existing name's exact casing whenever there's a case-insensitive
    // match, rather than trusting the model's output literally.
    const existingByLowerCase = new Map(existingNames.map((n) => [n.toLowerCase(), n]))

    const map = { ...identity }
    for (const item of result.items) {
      if (
        typeof item.raw === 'string' &&
        typeof item.canonical === 'string' &&
        item.canonical.trim()
      ) {
        const canonical = item.canonical.trim()
        const resolved = existingByLowerCase.get(canonical.toLowerCase()) ?? canonical
        // Also snap subsequent items in this same batch to the first casing
        // seen for a given product, in case the model varies casing within
        // one response too.
        existingByLowerCase.set(canonical.toLowerCase(), resolved)
        map[item.raw] = {
          canonicalName: resolved,
          totalSize: typeof item.totalSize === 'number' ? item.totalSize : null,
          sizeUnit: item.sizeUnit ?? null,
        }
      }
    }
    return map
  } catch (error) {
    logger.warn('Item annotation failed, using raw names', {
      error: error instanceof Error ? error.message : String(error),
    })
    return identity
  }
}

function normalizeRawItemName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Looks up user-confirmed canonical names for a set of raw (as-OCR'd) item
 * names, keyed case-insensitively. Rows with no override fall back to
 * whatever the AI decides, same as before.
 */
async function getNameOverrides(rawNames: string[]): Promise<Map<string, string>> {
  const lowerNames = [...new Set(rawNames.map(normalizeRawItemName))]
  if (lowerNames.length === 0) return new Map()

  const rows = await db
    .select()
    .from(schema.itemNameOverrides)
    .where(inArray(schema.itemNameOverrides.rawItemNameLower, lowerNames))
    .all()

  return new Map(rows.map((r) => [r.rawItemNameLower, r.canonicalName]))
}

/**
 * Records a user's correction of a raw item name's canonical grouping, so
 * future receipts with the exact same raw (as-OCR'd) text skip the AI's
 * guess entirely and use this instead — unlike the existing-names candidate
 * list passed to the model, which only nudges it and isn't guaranteed to be
 * reproduced consistently across calls.
 */
export async function upsertItemNameOverride(
  rawItemName: string,
  canonicalName: string,
): Promise<void> {
  const rawItemNameLower = normalizeRawItemName(rawItemName)
  const trimmedCanonical = canonicalName.trim()
  if (!rawItemNameLower || !trimmedCanonical) return

  const now = new Date().toISOString()
  const existing = await db
    .select()
    .from(schema.itemNameOverrides)
    .where(eq(schema.itemNameOverrides.rawItemNameLower, rawItemNameLower))
    .get()

  if (existing) {
    await db
      .update(schema.itemNameOverrides)
      .set({ canonicalName: trimmedCanonical, updatedAt: now })
      .where(eq(schema.itemNameOverrides.id, existing.id))
      .run()
  } else {
    await db
      .insert(schema.itemNameOverrides)
      .values({ rawItemNameLower, canonicalName: trimmedCanonical, createdAt: now, updatedAt: now })
      .run()
  }
}

/**
 * Records the line items from a processed receipt for cross-vendor price
 * comparison. Tolerant of malformed/missing fields since `line_items` shape
 * varies by workflow (custom workflows define their own JSON Schema).
 *
 * Idempotent per documentId: clears any rows already recorded for this
 * document before inserting, so reprocessing (manual retry, batch reprocess)
 * replaces the old line items instead of duplicating them alongside a
 * second copy.
 */
export async function recordReceiptItems(params: {
  documentId: number
  vendor?: string
  currency?: string
  purchaseDate?: string
  storeLocation?: string
  lineItems: unknown
  config: Config
}): Promise<void> {
  const { documentId, vendor, currency, purchaseDate, storeLocation, lineItems, config } = params

  const now = new Date().toISOString()
  const parsed: ParsedLineItem[] = []

  if (Array.isArray(lineItems)) {
    for (const raw of lineItems as LineItemInput[]) {
      const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
      if (!name) continue

      const totalPrice =
        typeof raw.totalPrice === 'number' ? Math.round(raw.totalPrice * 100) : null
      const unitPrice = typeof raw.unitPrice === 'number' ? Math.round(raw.unitPrice * 100) : null
      const quantity =
        typeof raw.quantity === 'number' && raw.quantity > 0 ? Math.round(raw.quantity) : 1

      parsed.push({ name, quantity, unitPrice, totalPrice })
    }
  }

  // The AI call happens before touching the DB at all — bun:sqlite
  // transactions run their callback synchronously to completion, so an
  // async network call can't live inside one anyway, and there's no
  // atomicity requirement between "ask the AI" and "write the DB".
  //
  // This is a SECOND full AI round-trip after the main extraction call -
  // using the same configured (often large/vision) model for what's really
  // a text-only canonicalization task. Logged explicitly since otherwise
  // it's silent and looks like the workflow is stuck on a plain DB write.
  const docLogger = logger.withDocument(documentId)
  if (parsed.length > 0) {
    docLogger.info(`Canonicalizing ${parsed.length} line item(s) for price comparison...`)
  }
  const [annotations, nameOverrides] = await Promise.all([
    parsed.length > 0
      ? annotateLineItems(parsed, config)
      : Promise.resolve<Record<string, ItemAnnotation>>({}),
    getNameOverrides(parsed.map((p) => p.name)),
  ])
  if (parsed.length > 0) {
    docLogger.info(`✓ Canonicalization complete`)
  }

  const rows: schema.NewReceiptItemEntry[] = parsed.map((item) => {
    const annotation = annotations[item.name]
    const override = nameOverrides.get(normalizeRawItemName(item.name))
    return {
      documentId,
      vendor,
      itemName: item.name,
      canonicalName: override ?? annotation?.canonicalName ?? item.name,
      totalSize: annotation?.totalSize ?? null,
      sizeUnit: annotation?.sizeUnit ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      currency,
      purchaseDate,
      storeLocation,
      createdAt: now,
    }
  })

  // Clear any previously-recorded items for this document and insert the
  // fresh set atomically, so a reprocess either fully replaces the old data
  // or (on failure) leaves it untouched — never a window where the document
  // has no line items at all.
  db.transaction((tx) => {
    tx.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, documentId)).run()
    if (rows.length > 0) {
      tx.insert(schema.receiptItems).values(rows).run()
    }
  })

  // `line_items` is optional in the extraction schema, so a bad/degraded
  // AI response (e.g. the model collapsing a dense multi-item receipt down
  // to just its first row) recording zero items is a *valid* result as far
  // as the Zod schema is concerned - it would otherwise pass through
  // completely silently, indistinguishable from "this receipt genuinely
  // has no line items."
  if (rows.length === 0) {
    logger.warn(`Recorded zero line items for document ${documentId}`, {
      documentId,
      hadLineItemsField: Array.isArray(lineItems),
    })
  }
}

/**
 * Number of recorded line items per document, for surfacing which
 * processed receipts came back with zero items (see the warning above) -
 * used by the batch-reprocess page to flag receipts worth a manual retry.
 */
export async function getItemCountsByDocument(
  documentIds: Array<number>,
): Promise<Record<number, number>> {
  if (documentIds.length === 0) return {}

  const rows = await db
    .select({
      documentId: schema.receiptItems.documentId,
      count: sql<number>`count(*)`,
    })
    .from(schema.receiptItems)
    .where(inArray(schema.receiptItems.documentId, documentIds))
    .groupBy(schema.receiptItems.documentId)
    .all()

  const counts: Record<number, number> = {}
  for (const row of rows) {
    counts[row.documentId] = Number(row.count)
  }
  return counts
}

/** Autocomplete: distinct canonical product names seen so far, matching a search term. */
export async function searchItemNames(query: string, limit = 20): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: canonicalOrItemName })
    .from(schema.receiptItems)
    .where(like(sql`lower(${canonicalOrItemName})`, `%${query.toLowerCase()}%`))
    .limit(limit)
    .all()

  return rows.map((r) => r.name)
}

/** Price history for one or more (user-selected) canonical product names, newest first. */
export async function getItemPriceHistory(itemNames: string[]): Promise<schema.ReceiptItemEntry[]> {
  if (itemNames.length === 0) return []

  return await db
    .select()
    .from(schema.receiptItems)
    .where(inArray(canonicalOrItemName, itemNames))
    .orderBy(desc(schema.receiptItems.purchaseDate))
    .all()
}

export interface ReceiptItemEdit {
  itemName?: string
  canonicalName?: string
  unitPrice?: number // major units (e.g. dollars); converted to cents for storage
  // null means "price unknown" - the state items land in when the AI
  // couldn't read a price off the receipt at all. Distinct from 0.
  totalPrice?: number | null // major units
  quantity?: number
  // Total volume/weight covered by this line's full quantity (already
  // multiplied out - not a per-unit size). See recordReceiptItems/
  // annotateLineItems for the same convention at extraction time.
  totalSize?: number | null
  sizeUnit?: 'ml' | 'g' | 'count' | null
  storeLocation?: string
}

/**
 * Applies a manual correction to a single receipt-item row (per-row, not
 * per-product) — for the case where the AI got this one occurrence wrong
 * but got the same product right elsewhere.
 *
 * If `canonicalName` is being corrected, also records a raw-name override
 * (keyed on the row's raw item name, post-edit if `itemName` is also being
 * corrected in the same call) so future receipts with that exact raw text
 * use the correction directly instead of going through the AI again.
 */
export async function updateReceiptItem(
  id: number,
  edits: ReceiptItemEdit,
): Promise<schema.ReceiptItemEntry | null> {
  const existing = await db
    .select()
    .from(schema.receiptItems)
    .where(eq(schema.receiptItems.id, id))
    .get()
  if (!existing) return null

  const nextItemName =
    typeof edits.itemName === 'string' && edits.itemName.trim()
      ? edits.itemName.trim()
      : existing.itemName

  const updates: Partial<schema.NewReceiptItemEntry> = {}
  if (edits.itemName !== undefined) updates.itemName = nextItemName
  if (edits.canonicalName !== undefined) updates.canonicalName = edits.canonicalName.trim()
  if (edits.totalPrice !== undefined) {
    updates.totalPrice = edits.totalPrice === null ? null : Math.round(edits.totalPrice * 100)
  }
  if (edits.quantity !== undefined && edits.quantity > 0) {
    updates.quantity = Math.round(edits.quantity)
  }
  if (edits.storeLocation !== undefined) updates.storeLocation = edits.storeLocation
  if (edits.totalSize !== undefined) updates.totalSize = edits.totalSize
  if (edits.sizeUnit !== undefined) updates.sizeUnit = edits.sizeUnit

  // unitPrice is comparablePriceOf's preferred per-pack fallback (ahead of
  // computing totalPrice/quantity on the fly), so leaving it untouched after
  // a totalPrice/quantity correction would silently keep price comparison on
  // the old, now-wrong per-pack price. Recompute it from the corrected
  // values unless the caller is explicitly setting it to something else.
  if (edits.unitPrice !== undefined) {
    updates.unitPrice = Math.round(edits.unitPrice * 100)
  } else if (edits.totalPrice !== undefined || edits.quantity !== undefined) {
    // `??` would be wrong here: totalPrice can be explicitly set to null
    // (price unknown), which must not fall back to the existing value.
    const nextTotalPrice =
      updates.totalPrice !== undefined ? updates.totalPrice : existing.totalPrice
    const nextQuantity = updates.quantity ?? existing.quantity
    updates.unitPrice =
      nextTotalPrice !== null && nextQuantity > 0 ? Math.round(nextTotalPrice / nextQuantity) : null
  }

  if (Object.keys(updates).length > 0) {
    await db.update(schema.receiptItems).set(updates).where(eq(schema.receiptItems.id, id)).run()
  }

  if (edits.canonicalName !== undefined && edits.canonicalName.trim()) {
    await upsertItemNameOverride(nextItemName, edits.canonicalName)
  }

  // The receipt's total is derived from its items, never directly editable,
  // so any change to a line's total price has to flow back up.
  if (edits.totalPrice !== undefined) {
    await recalculateReceiptTotal(existing.documentId)
  }

  return (
    (await db.select().from(schema.receiptItems).where(eq(schema.receiptItems.id, id)).get()) ??
    null
  )
}

export interface NewReceiptItemInput {
  documentId: number
  itemName: string
  quantity?: number
  totalPrice?: number | null // major units; null means "price unknown"
  totalSize?: number | null
  sizeUnit?: 'ml' | 'g' | 'count' | null
}

/**
 * Adds a manually-entered line item to a receipt - for a breakdown line
 * the AI missed entirely (as opposed to updateReceiptItem, which corrects
 * a line the AI *did* extract but got wrong). Inherits vendor/currency/
 * purchaseDate/storeLocation from an existing item on the same receipt if
 * there is one, otherwise from the receipt's own log entry, so a manually
 * added item still participates in price comparison like any other.
 */
export async function createReceiptItem(
  input: NewReceiptItemInput,
): Promise<schema.ReceiptItemEntry | null> {
  const itemName = input.itemName.trim()
  if (!itemName) return null

  const sibling = await db
    .select()
    .from(schema.receiptItems)
    .where(eq(schema.receiptItems.documentId, input.documentId))
    .get()

  let vendor: string | null = sibling?.vendor ?? null
  let currency: string | null = sibling?.currency ?? null
  let purchaseDate: string | null = sibling?.purchaseDate ?? null
  let storeLocation: string | null = sibling?.storeLocation ?? null

  if (!sibling) {
    const log = await db
      .select()
      .from(schema.processingLogs)
      .where(eq(schema.processingLogs.documentId, input.documentId))
      .orderBy(desc(schema.processingLogs.id))
      .get()
    if (!log) return null

    vendor = log.vendor
    currency = log.currency
    storeLocation = log.storeLocation
    try {
      const parsed = log.receiptData ? JSON.parse(log.receiptData) : {}
      purchaseDate = typeof parsed.date === 'string' ? parsed.date : null
    } catch {
      purchaseDate = null
    }
  }

  const quantity = input.quantity && input.quantity > 0 ? Math.round(input.quantity) : 1
  const totalPrice =
    input.totalPrice === undefined || input.totalPrice === null
      ? null
      : Math.round(input.totalPrice * 100)
  const unitPrice = totalPrice !== null ? Math.round(totalPrice / quantity) : null

  const now = new Date().toISOString()
  const [row] = await db
    .insert(schema.receiptItems)
    .values({
      documentId: input.documentId,
      vendor,
      itemName,
      canonicalName: itemName,
      quantity,
      unitPrice,
      totalPrice,
      totalSize: input.totalSize ?? null,
      sizeUnit: input.sizeUnit ?? null,
      currency,
      purchaseDate,
      storeLocation,
      createdAt: now,
    })
    .returning()

  if (totalPrice !== null) {
    await recalculateReceiptTotal(input.documentId, { force: true })
  }

  return row
}

/**
 * Removes a single line item - for refund/discount/free lines the user
 * wants off the receipt entirely rather than corrected (e.g. netting a
 * discount into the main item's price and deleting the separate discount
 * line). Recalculates the receipt's total afterward, same as a price edit.
 */
export async function deleteReceiptItem(id: number): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.receiptItems)
    .where(eq(schema.receiptItems.id, id))
    .get()
  if (!existing) return false

  await db.delete(schema.receiptItems).where(eq(schema.receiptItems.id, id)).run()
  await recalculateReceiptTotal(existing.documentId, { force: true })

  return true
}

/**
 * Preview of what a bulk canonical-name rename would affect, before
 * committing to it — so merging two product groups is a deliberate,
 * reviewed action rather than a blind rename.
 */
export async function previewCanonicalRename(from: string): Promise<schema.ReceiptItemEntry[]> {
  return await db
    .select()
    .from(schema.receiptItems)
    .where(eq(canonicalOrItemName, from))
    .orderBy(desc(schema.receiptItems.purchaseDate))
    .all()
}

/**
 * Renames every row currently grouped under canonical name `from` to `to`
 * (merging two product groups, or fixing a systemically-wrong AI guess),
 * and records a raw-name override for every distinct raw item name involved
 * so future receipts with those same raw strings land on `to` directly.
 */
export async function renameCanonicalGroup(from: string, to: string): Promise<{ count: number }> {
  const trimmedTo = to.trim()
  if (!trimmedTo) return { count: 0 }

  const affected = await previewCanonicalRename(from)
  if (affected.length === 0) return { count: 0 }

  await db
    .update(schema.receiptItems)
    .set({ canonicalName: trimmedTo })
    .where(eq(canonicalOrItemName, from))
    .run()

  const distinctRawNames = new Set(affected.map((row) => row.itemName))
  for (const rawName of distinctRawNames) {
    await upsertItemNameOverride(rawName, trimmedTo)
  }

  return { count: affected.length }
}
