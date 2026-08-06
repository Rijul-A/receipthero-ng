import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { getWeekBoundaries } from './ecb'

export interface SpendingReportRow {
  period: string // week start (YYYY-MM-DD, Monday) or month (YYYY-MM)
  currency: string
  category: string
  total: number // major units (e.g. dollars, not cents)
  count: number
}

/**
 * Aggregates spend across all successfully processed receipts, bucketed by
 * week or month and broken down by currency and category. Grouped by
 * currency (not just period) since summing mixed currencies as raw numbers
 * would be meaningless without conversion - same class of bug fixed in the
 * price-comparison feature.
 *
 * Uses the receipt's own extracted `date`, not the processing timestamp,
 * since processing can lag behind the actual purchase by however long it
 * takes Paperless/the worker to pick the document up. `dateRange` filters
 * on that same field for the same reason - a receipt processed today for a
 * purchase last month should count toward last month's range, not today's.
 * Both bounds are inclusive, plain "YYYY-MM-DD" strings compare
 * lexicographically the same as chronologically.
 */
export async function getSpendingReport(
  groupBy: 'week' | 'month',
  dateRange?: { start?: string; end?: string },
): Promise<SpendingReportRow[]> {
  const completedLogs = await db.query.processingLogs.findMany({
    where: eq(schema.processingLogs.status, 'completed'),
  })

  const buckets = new Map<string, SpendingReportRow>()

  for (const log of completedLogs) {
    const raw = log.receiptData || log.extractedData
    if (!raw) continue

    let parsed: { date?: unknown; category?: unknown; amount?: unknown; currency?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const date = typeof parsed.date === 'string' ? parsed.date : null
    const amount = typeof parsed.amount === 'number' ? parsed.amount : null
    if (!date || amount === null || Number.isNaN(new Date(date).getTime())) continue
    if (dateRange?.start && date < dateRange.start) continue
    if (dateRange?.end && date > dateRange.end) continue

    const currency = typeof parsed.currency === 'string' ? parsed.currency.toUpperCase() : 'UNKNOWN'
    // Category is free-form AI output with no fixed vocabulary, so
    // "Groceries"/"groceries"/"Grocery" from different receipts would
    // otherwise fragment into separate rows instead of merging - same class
    // of bug as un-canonicalized item names in the price-comparison feature.
    const rawCategory =
      typeof parsed.category === 'string' ? parsed.category.trim().toLowerCase() : ''
    const category = rawCategory || 'uncategorized'
    const period = groupBy === 'week' ? getWeekBoundaries(date).weekStart : date.slice(0, 7)

    const key = `${period}|${currency}|${category}`
    const existing = buckets.get(key)
    if (existing) {
      existing.total += amount
      existing.count += 1
    } else {
      buckets.set(key, { period, currency, category, total: amount, count: 1 })
    }
  }

  return Array.from(buckets.values())
    .map((row) => ({ ...row, total: Math.round(row.total * 100) / 100 }))
    .sort((a, b) => b.period.localeCompare(a.period))
}
