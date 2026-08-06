import { desc, inArray, like, sql } from 'drizzle-orm'
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

// SQLite has no dedicated NULL-coalescing column expression in drizzle-orm,
// so this raw fragment stands in for "canonicalName, falling back to itemName"
// wherever we group/match/search by product identity.
const canonicalOrItemName = sql<string>`coalesce(${schema.receiptItems.canonicalName}, ${schema.receiptItems.itemName})`

/**
 * Asks the AI provider to assign each new raw item name either an existing
 * canonical product name (if it's the same product worded differently across
 * receipts/stores) or a new concise canonical name. One batched call per
 * receipt rather than per item to keep this cheap, and per-call rather than
 * per-search so browsing /prices never triggers an AI request.
 *
 * Best-effort: on any failure, falls back to using the raw names as-is, so a
 * flaky/local AI provider never blocks receipt processing.
 */
async function canonicalizeItemNames(
  rawNames: string[],
  config: Config,
): Promise<Record<string, string>> {
  const identity = Object.fromEntries(rawNames.map((n) => [n, n]))

  try {
    const existing = await db
      .selectDistinct({ name: canonicalOrItemName })
      .from(schema.receiptItems)
      .orderBy(desc(schema.receiptItems.createdAt))
      .limit(300)
      .all()
    const existingNames = existing.map((r) => r.name)

    const result = await chatJson<{ mappings: { raw: string; canonical: string }[] }>({
      config,
      schemaName: 'item_canonicalization',
      systemPrompt: [
        'You group grocery/retail receipt line items into canonical product names',
        'so the same product bought at different stores (with different wording,',
        'abbreviations, or language) can be tracked as one item for price comparison.',
        '',
        'For each raw item name given, either:',
        '- Reuse an existing canonical name from the provided list, if it clearly refers',
        '  to the same product (ignore store-specific phrasing, pack-size noise, brand',
        '  ordering, or language differences).',
        '- Otherwise, output a new, concise, human-readable canonical name for it',
        '  (e.g. "Almarai Fresh Milk 1L" not "ALM MILK FRSH 1L PROMO").',
        'Do not merge genuinely different products just because they are similar.',
      ].join('\n'),
      userPrompt: JSON.stringify({ existingCanonicalNames: existingNames, rawNames }),
      responseSchema: {
        type: 'object',
        properties: {
          mappings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                raw: { type: 'string' },
                canonical: { type: 'string' },
              },
              required: ['raw', 'canonical'],
              additionalProperties: false,
            },
          },
        },
        required: ['mappings'],
        additionalProperties: false,
      },
    })

    const map = { ...identity }
    for (const { raw, canonical } of result.mappings) {
      if (typeof raw === 'string' && typeof canonical === 'string' && canonical.trim()) {
        map[raw] = canonical.trim()
      }
    }
    return map
  } catch (error) {
    logger.warn('Item name canonicalization failed, using raw names', {
      error: error instanceof Error ? error.message : String(error),
    })
    return identity
  }
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
  config: Config
}): Promise<void> {
  const { documentId, vendor, currency, purchaseDate, lineItems, config } = params

  if (!Array.isArray(lineItems) || lineItems.length === 0) return

  const now = new Date().toISOString()
  const parsed: {
    name: string
    quantity: number
    unitPrice: number | null
    totalPrice: number | null
  }[] = []

  for (const raw of lineItems as LineItemInput[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) continue

    const totalPrice = typeof raw.totalPrice === 'number' ? Math.round(raw.totalPrice * 100) : null
    const unitPrice = typeof raw.unitPrice === 'number' ? Math.round(raw.unitPrice * 100) : null
    const quantity =
      typeof raw.quantity === 'number' && raw.quantity > 0 ? Math.round(raw.quantity) : 1

    parsed.push({ name, quantity, unitPrice, totalPrice })
  }

  if (parsed.length === 0) return

  const canonicalNames = await canonicalizeItemNames(
    parsed.map((p) => p.name),
    config,
  )

  const rows: schema.NewReceiptItemEntry[] = parsed.map((item) => ({
    documentId,
    vendor,
    itemName: item.name,
    canonicalName: canonicalNames[item.name] ?? item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    currency,
    purchaseDate,
    createdAt: now,
  }))

  await db.insert(schema.receiptItems).values(rows).run()
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
