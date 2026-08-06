import { eq } from 'drizzle-orm'
import { db, schema } from '../db'

export interface VendorSpend {
  vendor: string
  storeLocation: string | null
  currency: string
  total: number // major units
  count: number
}

/**
 * Total spend per vendor+location, broken down by currency (never summed
 * across currencies as raw numbers - same reasoning as spending-report.ts
 * and currency-totals). "Which store do I actually spend the most at", as
 * opposed to the per-item price comparison on the Prices page.
 *
 * Grouped by location as well as vendor - same reasoning as
 * formatStoreLabel/computeStoreWinCounts on the Prices page: two branches
 * of the same chain can price differently, and treating them as one vendor
 * here while the Prices page tells them apart would be an inconsistent
 * (and confusing) story about "the same store".
 *
 * `dateRange` filters on the receipt's own extracted date (not the
 * processing timestamp), same reasoning and inclusive-bounds convention as
 * getSpendingReport. A receipt with no usable date is excluded once a
 * range is given, since there's no way to confirm it falls inside it.
 */
export async function getVendorSpendReport(dateRange?: {
  start?: string
  end?: string
}): Promise<VendorSpend[]> {
  const completedLogs = await db.query.processingLogs.findMany({
    where: eq(schema.processingLogs.status, 'completed'),
  })

  const buckets = new Map<string, VendorSpend>()
  // Unlike item names (which go through a whole canonicalization system)
  // and category (already normalized in getSpendingReport), vendor/location
  // have no dedup mechanism - the AI can extract "Carrefour"/"CARREFOUR"/
  // "carrefour" across different receipts from the same store. Group
  // case-insensitively and display whichever casing was seen first, so one
  // store's spend doesn't silently fragment across multiple bars.
  const displayVendorByLower = new Map<string, string>()
  const displayLocationByLower = new Map<string, string>()

  for (const log of completedLogs) {
    const raw = log.receiptData || log.extractedData
    if (!raw) continue

    let parsed: {
      vendor?: unknown
      amount?: unknown
      currency?: unknown
      storeLocation?: unknown
      date?: unknown
    }
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const amount = typeof parsed.amount === 'number' ? parsed.amount : null
    if (amount === null) continue

    if (dateRange?.start || dateRange?.end) {
      const date = typeof parsed.date === 'string' ? parsed.date : null
      if (!date) continue
      if (dateRange.start && date < dateRange.start) continue
      if (dateRange.end && date > dateRange.end) continue
    }

    const rawVendor =
      typeof parsed.vendor === 'string' && parsed.vendor.trim()
        ? parsed.vendor.trim()
        : (log.vendor ?? 'Unknown')
    const vendorLower = rawVendor.toLowerCase()
    const vendor = displayVendorByLower.get(vendorLower) ?? rawVendor
    displayVendorByLower.set(vendorLower, vendor)

    const rawLocation =
      typeof parsed.storeLocation === 'string' && parsed.storeLocation.trim()
        ? parsed.storeLocation.trim()
        : (log.storeLocation ?? null)
    const locationLower = rawLocation?.toLowerCase() ?? null
    const storeLocation = locationLower
      ? (displayLocationByLower.get(locationLower) ?? rawLocation)
      : null
    if (locationLower && storeLocation) displayLocationByLower.set(locationLower, storeLocation)

    const currency = (
      typeof parsed.currency === 'string' ? parsed.currency : (log.currency ?? 'UNKNOWN')
    ).toUpperCase()

    const key = `${vendorLower}|${locationLower ?? ''}|${currency}`
    const existing = buckets.get(key)
    if (existing) {
      existing.total += amount
      existing.count += 1
    } else {
      buckets.set(key, { vendor, storeLocation, currency, total: amount, count: 1 })
    }
  }

  return Array.from(buckets.values())
    .map((row) => ({ ...row, total: Math.round(row.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
}

export interface ItemFrequency {
  name: string
  currency: string
  totalSpent: number // major units; refunds/discounts (negative lines) net out of this
  purchaseCount: number // rows with a positive price - actual purchases, not refund/discount lines
  firstPurchase: string | null
  lastPurchase: string | null
}

/**
 * Per-product spend and purchase frequency, across all recorded line items -
 * "how much have I spent on X, and how often do I buy it". Grouped by
 * currency for the same reason as everywhere else spend gets aggregated.
 *
 * purchaseCount only counts rows with a positive price (real purchases);
 * totalSpent sums every row including negative/zero ones, so a refund
 * correctly nets out of the total without being counted as a "purchase".
 *
 * `dateRange` filters on purchaseDate (inclusive bounds, same convention as
 * getSpendingReport). A row with no purchaseDate is excluded once a range
 * is given, since there's no way to confirm it falls inside it.
 */
export async function getItemFrequencyReport(
  limit = 50,
  dateRange?: { start?: string; end?: string },
): Promise<ItemFrequency[]> {
  const allRows = await db.query.receiptItems.findMany()
  const start = dateRange?.start
  const end = dateRange?.end
  const rows =
    start || end
      ? allRows.filter((row) => {
          if (!row.purchaseDate) return false
          if (start && row.purchaseDate < start) return false
          if (end && row.purchaseDate > end) return false
          return true
        })
      : allRows

  interface Bucket extends ItemFrequency {
    totalCents: number
  }
  const buckets = new Map<string, Bucket>()

  for (const row of rows) {
    const name = row.canonicalName ?? row.itemName
    const currency = (row.currency ?? 'UNKNOWN').toUpperCase()
    const key = `${name}|${currency}`
    const cents = row.totalPrice ?? 0

    const existing = buckets.get(key)
    if (existing) {
      existing.totalCents += cents
      if (row.totalPrice !== null && row.totalPrice > 0) existing.purchaseCount += 1
      if (
        row.purchaseDate &&
        (!existing.firstPurchase || row.purchaseDate < existing.firstPurchase)
      ) {
        existing.firstPurchase = row.purchaseDate
      }
      if (
        row.purchaseDate &&
        (!existing.lastPurchase || row.purchaseDate > existing.lastPurchase)
      ) {
        existing.lastPurchase = row.purchaseDate
      }
    } else {
      buckets.set(key, {
        name,
        currency,
        totalCents: cents,
        totalSpent: 0,
        purchaseCount: row.totalPrice !== null && row.totalPrice > 0 ? 1 : 0,
        firstPurchase: row.purchaseDate,
        lastPurchase: row.purchaseDate,
      })
    }
  }

  return Array.from(buckets.values())
    .map(({ totalCents, ...row }) => ({ ...row, totalSpent: Math.round(totalCents) / 100 }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit)
}
