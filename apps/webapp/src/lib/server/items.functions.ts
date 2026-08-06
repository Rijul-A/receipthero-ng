/**
 * Item Price Comparison Server Functions
 *
 * Server functions for cross-vendor item price comparison.
 */

import { createServerFn } from '@tanstack/react-start'
import type { DateRange } from './stats.functions'

const API_URL = process.env.API_URL || 'http://localhost:3001'

async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init)
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
  canonicalName: string | null
  quantity: number
  unitPrice: number | null
  totalPrice: number | null
  // Total size of this line item (e.g. 1980 for a "6x330ml" pack), normalized
  // to ml or g, for comparing differently-packaged versions of a product by
  // true unit price. Null if the AI couldn't determine it.
  totalSize: number | null
  sizeUnit: 'ml' | 'g' | 'count' | null
  currency: string | null
  purchaseDate: string | null
  // Branch/address distinguishing this store location from other locations
  // of the same vendor. Null if not extracted/set.
  storeLocation: string | null
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

export interface ItemEdit {
  itemName?: string
  canonicalName?: string
  unitPrice?: number
  totalPrice?: number | null
  quantity?: number
  totalSize?: number | null
  sizeUnit?: 'ml' | 'g' | 'count' | null
  storeLocation?: string
}

/**
 * Corrects a single receipt-item row.
 * Proxies to PATCH /api/items/:id.
 */
export const updateReceiptItem = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: number; edits: ItemEdit }) => input)
  .handler(async (ctx) => {
    const { item } = await apiCall<{ item: ReceiptItemEntry }>(
      `/api/items/${ctx.data.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx.data.edits),
      },
    )
    return item
  })

export interface ItemFrequency {
  name: string
  currency: string
  totalSpent: number
  purchaseCount: number
  firstPurchase: string | null
  lastPurchase: string | null
}

/**
 * Per-product total spend and purchase frequency.
 * Proxies to GET /api/items/frequency?limit=...
 */
export const getItemFrequencyReport = createServerFn({ method: 'GET' })
  .inputValidator((input: { limit?: number } & DateRange) => input)
  .handler(async (ctx) => {
    const params = new URLSearchParams()
    if (ctx.data.limit) params.set('limit', String(ctx.data.limit))
    if (ctx.data.startDate) params.set('startDate', ctx.data.startDate)
    if (ctx.data.endDate) params.set('endDate', ctx.data.endDate)
    const { rows } = await apiCall<{ rows: Array<ItemFrequency> }>(
      `/api/items/frequency?${params.toString()}`,
    )
    return rows
  })

/**
 * Removes a single line item.
 * Proxies to DELETE /api/items/:id.
 */
export const deleteReceiptItem = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: number }) => input)
  .handler(async (ctx) => {
    return apiCall<{ success: boolean }>(`/api/items/${ctx.data.id}`, {
      method: 'DELETE',
    })
  })

/**
 * Rows that would be affected by renaming canonical product `from`.
 * Proxies to GET /api/items/rename-preview?from=...
 */
export const previewRename = createServerFn({ method: 'GET' })
  .inputValidator((input: { from: string }) => input)
  .handler(async (ctx) => {
    const { rows } = await apiCall<{ rows: Array<ReceiptItemEntry> }>(
      `/api/items/rename-preview?from=${encodeURIComponent(ctx.data.from)}`,
    )
    return rows
  })

/**
 * Renames every row grouped under canonical name `from` to `to`.
 * Proxies to POST /api/items/rename.
 */
export const renameCanonicalGroup = createServerFn({ method: 'POST' })
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async (ctx) => {
    return apiCall<{ count: number }>('/api/items/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx.data),
    })
  })
