/**
 * Item Price Comparison Server Functions
 *
 * Server functions for cross-vendor item price comparison.
 */

import { createServerFn } from '@tanstack/react-start'

const API_URL = process.env.API_URL || 'http://localhost:3001'

async function apiCall<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }
  return response.json() as T
}

export interface ReceiptItemEntry {
  id: number
  documentId: number
  vendor: string | null
  itemName: string
  quantity: number
  unitPrice: number | null
  totalPrice: number | null
  currency: string | null
  purchaseDate: string | null
  createdAt: string
}

/**
 * Search item names seen across processed receipts (autocomplete).
 * Proxies to GET /api/items/search?q=...
 */
export const searchItemNames = createServerFn({ method: 'GET' })
  .inputValidator((input: { query: string }) => input)
  .handler(async (ctx) => {
    const { names } = await apiCall<{ names: Array<string> }>(
      `/api/items/search?q=${encodeURIComponent(ctx.data.query)}`,
    )
    return names
  })

/**
 * Price history for one or more user-selected item names.
 * Proxies to GET /api/items/history?names=...
 */
export const getItemPriceHistory = createServerFn({ method: 'GET' })
  .inputValidator((input: { itemNames: Array<string> }) => input)
  .handler(async (ctx) => {
    const { history } = await apiCall<{ history: Array<ReceiptItemEntry> }>(
      `/api/items/history?names=${encodeURIComponent(ctx.data.itemNames.join(','))}`,
    )
    return history
  })

/**
 * CSV export of every recorded line item.
 * Proxies to GET /api/items/export.
 */
export const exportItemsCsv = createServerFn({ method: 'GET' }).handler(
  async () => {
    const response = await fetch(`${API_URL}/api/items/export`)
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    return response.text()
  },
)
