import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  loadConfig,
  db,
  processingLogs,
  getSpendingReport,
  getVendorSpendReport,
} from '@sm-rn/core'
import { eq } from 'drizzle-orm'
import { toCsv } from '../lib/csv'

const stats = new Hono()

interface CurrencyTotal {
  currency: string
  total: number
  count: number
}

interface CurrencyTotalsResponse {
  success: boolean
  totals: CurrencyTotal[]
  totalReceipts: number
  targetCurrencies: string[]
}

/**
 * GET /api/stats/currency-totals
 *
 * Returns aggregated totals in all configured target currencies.
 * Reads from processingLogs and sums up converted amounts.
 */
stats.get('/currency-totals', async (c) => {
  try {
    const config = loadConfig()
    const targetCurrencies = config.processing.currencyConversion?.targetCurrencies || []
    const isEnabled = config.processing.currencyConversion?.enabled ?? false

    if (!isEnabled) {
      return c.json({
        success: true,
        totals: [],
        totalReceipts: 0,
        targetCurrencies: [],
        message: 'Currency conversion is disabled',
      })
    }

    // Fetch all completed processing logs
    const completedLogs = await db.query.processingLogs.findMany({
      where: eq(processingLogs.status, 'completed'),
    })

    // Aggregate totals by currency
    const currencyTotals = new Map<string, { total: number; count: number }>()

    // Initialize all target currencies with 0
    for (const currency of targetCurrencies) {
      currencyTotals.set(currency.toUpperCase(), { total: 0, count: 0 })
    }

    for (const log of completedLogs) {
      if (!log.receiptData) continue

      try {
        const receipt = JSON.parse(log.receiptData)
        const conversions = receipt.conversions as Record<string, number> | undefined

        if (conversions) {
          for (const [currency, amount] of Object.entries(conversions)) {
            const upper = currency.toUpperCase()
            const existing = currencyTotals.get(upper) || { total: 0, count: 0 }
            currencyTotals.set(upper, {
              total: existing.total + amount,
              count: existing.count + 1,
            })
          }
        } else if (receipt.amount && receipt.currency) {
          // Fallback: use original amount/currency if no conversions
          const upper = receipt.currency.toUpperCase()
          const existing = currencyTotals.get(upper) || { total: 0, count: 0 }
          currencyTotals.set(upper, {
            total: existing.total + receipt.amount,
            count: existing.count + 1,
          })
        }
      } catch {
        // Skip malformed JSON
        continue
      }
    }

    // Convert to array and sort by currency code
    const totals: CurrencyTotal[] = Array.from(currencyTotals.entries())
      .map(([currency, data]) => ({
        currency,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency))

    return c.json({
      success: true,
      totals,
      totalReceipts: completedLogs.length,
      targetCurrencies: targetCurrencies.map((c) => c.toUpperCase()),
    } as CurrencyTotalsResponse)
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
})

/**
 * GET /api/stats/export/receipts
 *
 * CSV export of all successfully processed receipts.
 */
stats.get('/export/receipts', async (c) => {
  const completedLogs = await db.query.processingLogs.findMany({
    where: eq(processingLogs.status, 'completed'),
  })

  const rows = completedLogs.map((log) => {
    let date = ''
    let category = ''
    const raw = log.receiptData || log.extractedData
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        date = typeof parsed.date === 'string' ? parsed.date : ''
        category = typeof parsed.category === 'string' ? parsed.category : ''
      } catch {
        // Leave date/category blank for malformed JSON
      }
    }

    return {
      documentId: log.documentId,
      fileName: log.fileName ?? '',
      vendor: log.vendor ?? '',
      date,
      category,
      amount: log.amount !== null ? (log.amount / 100).toFixed(2) : '',
      currency: log.currency ?? '',
      processedAt: log.createdAt,
    }
  })

  const csv = toCsv(rows, [
    'documentId',
    'fileName',
    'vendor',
    'date',
    'category',
    'amount',
    'currency',
    'processedAt',
  ])

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="receipts.csv"')
  return c.body(csv)
})

/**
 * GET /api/stats/spending?groupBy=week|month
 *
 * Spend aggregated by week or month, broken down by currency and category.
 */
stats.get(
  '/spending',
  zValidator('query', z.object({ groupBy: z.enum(['week', 'month']).default('month') })),
  async (c) => {
    const { groupBy } = c.req.valid('query')
    const rows = await getSpendingReport(groupBy)
    return c.json({ groupBy, rows })
  },
)

/**
 * GET /api/stats/spending/export?groupBy=week|month
 *
 * CSV export of the spending report.
 */
stats.get(
  '/spending/export',
  zValidator('query', z.object({ groupBy: z.enum(['week', 'month']).default('month') })),
  async (c) => {
    const { groupBy } = c.req.valid('query')
    const rows = await getSpendingReport(groupBy)

    const csv = toCsv(
      rows.map((r) => ({ ...r, total: r.total.toFixed(2) })),
      ['period', 'currency', 'category', 'total', 'count'],
    )

    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="spending-${groupBy}.csv"`)
    return c.body(csv)
  },
)

/**
 * GET /api/stats/vendor-totals
 *
 * Total spend per vendor, broken down by currency.
 */
stats.get('/vendor-totals', async (c) => {
  const rows = await getVendorSpendReport()
  return c.json({ rows })
})

export default stats
