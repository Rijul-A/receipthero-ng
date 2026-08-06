import { desc, eq, inArray, like, sql } from 'drizzle-orm'
import type { Config } from '@sm-rn/shared/schemas'
import { db, schema } from '../db'
import { chatJson } from './ai-json'
import { createLogger } from './logger'

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
  lineItems: unknown
  config: Config
}): Promise<void> {
  const { documentId, vendor, currency, purchaseDate, lineItems, config } = params

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
  const annotations = parsed.length > 0 ? await annotateLineItems(parsed, config) : {}

  const rows: schema.NewReceiptItemEntry[] = parsed.map((item) => {
    const annotation = annotations[item.name]
    return {
      documentId,
      vendor,
      itemName: item.name,
      canonicalName: annotation?.canonicalName ?? item.name,
      totalSize: annotation?.totalSize ?? null,
      sizeUnit: annotation?.sizeUnit ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      currency,
      purchaseDate,
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
