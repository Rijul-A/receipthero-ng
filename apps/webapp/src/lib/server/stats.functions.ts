/**
 * Stats Server Functions
 *
 * Server functions for statistics-related API calls.
 */

import { createServerFn } from '@tanstack/react-start'

const API_URL = process.env.API_URL || 'http://localhost:3001'

async function apiCall<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }
  return response.json() as T
}

export interface CurrencyTotal {
  currency: string
  total: number
  count: number
}

export interface CurrencyTotalsResponse {
  success: boolean
  totals: Array<CurrencyTotal>
  totalReceipts: number
  targetCurrencies: Array<string>
  message?: string
  error?: string
}

/**
 * Get currency totals - proxies to GET /api/stats/currency-totals
 */
export const getCurrencyTotals = createServerFn({ method: 'GET' }).handler(
  async () => {
    return apiCall<CurrencyTotalsResponse>('/api/stats/currency-totals')
  },
)

/**
 * CSV export of all processed receipts.
 * Proxies to GET /api/stats/export/receipts
 */
export const exportReceiptsCsv = createServerFn({ method: 'GET' }).handler(
  async () => {
    const response = await fetch(`${API_URL}/api/stats/export/receipts`)
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    return response.text()
  },
)

export interface SpendingReportRow {
  period: string
  currency: string
  category: string
  total: number
  count: number
}

export interface SpendingReportResponse {
  groupBy: 'week' | 'month'
  rows: Array<SpendingReportRow>
}

/**
 * Spend aggregated by week or month, by currency and category.
 * Proxies to GET /api/stats/spending?groupBy=...
 */
export const getSpendingReport = createServerFn({ method: 'GET' })
  .inputValidator((input: { groupBy: 'week' | 'month' }) => input)
  .handler(async (ctx) => {
    return apiCall<SpendingReportResponse>(
      `/api/stats/spending?groupBy=${ctx.data.groupBy}`,
    )
  })

/**
 * CSV export of the spending report.
 * Proxies to GET /api/stats/spending/export?groupBy=...
 */
export const exportSpendingReportCsv = createServerFn({ method: 'GET' })
  .inputValidator((input: { groupBy: 'week' | 'month' }) => input)
  .handler(async (ctx) => {
    const response = await fetch(
      `${API_URL}/api/stats/spending/export?groupBy=${ctx.data.groupBy}`,
    )
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    return response.text()
  })

export interface VendorSpend {
  vendor: string
  currency: string
  total: number
  count: number
}

/**
 * Total spend per vendor, by currency.
 * Proxies to GET /api/stats/vendor-totals
 */
export const getVendorSpendReport = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { rows } = await apiCall<{ rows: Array<VendorSpend> }>(
      '/api/stats/vendor-totals',
    )
    return rows
  },
)
