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
