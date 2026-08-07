/**
 * Receipt Detail/Edit Server Functions
 */

import { createServerFn } from '@tanstack/react-start'
import { apiCall } from './api-client'
import type { ReceiptItemEntry } from './items.functions'

export interface ProcessingLogEntry {
  id: number
  documentId: number
  status: string
  fileName: string | null
  vendor: string | null
  amount: number | null
  currency: string | null
  storeLocation: string | null
  receiptData: string | null
  updatedAt: string
}

export interface ReceiptDetail {
  log: ProcessingLogEntry
  items: Array<ReceiptItemEntry>
}

/**
 * A processed receipt's extracted data plus its recorded line items.
 * Proxies to GET /api/receipts/:documentId.
 */
export const getReceiptDetail = createServerFn({ method: 'GET' })
  .inputValidator((input: { documentId: number }) => input)
  .handler(async (ctx) => {
    return apiCall<ReceiptDetail>(`/api/receipts/${ctx.data.documentId}`)
  })

export interface ReceiptEdit {
  vendor?: string
  amount?: number
  currency?: string
  date?: string
  time?: string
  category?: string
  storeLocation?: string
}

/**
 * Corrects receipt-level extracted fields.
 * Proxies to PATCH /api/receipts/:documentId.
 */
export const updateReceipt = createServerFn({ method: 'POST' })
  .inputValidator((input: { documentId: number; edits: ReceiptEdit }) => input)
  .handler(async (ctx) => {
    const { log } = await apiCall<{ log: ProcessingLogEntry }>(
      `/api/receipts/${ctx.data.documentId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx.data.edits),
      },
    )
    return log
  })

/**
 * Deletes a receipt entirely (ReceiptHero's tracking of it, not the
 * underlying Paperless document).
 * Proxies to DELETE /api/receipts/:documentId.
 */
export const deleteReceipt = createServerFn({ method: 'POST' })
  .inputValidator((input: { documentId: number }) => input)
  .handler(async (ctx) => {
    return apiCall<{ success: boolean }>(
      `/api/receipts/${ctx.data.documentId}`,
      {
        method: 'DELETE',
      },
    )
  })

export interface VendorRenamePreviewRow {
  documentId: number
  fileName: string | null
  vendor: string | null
  storeLocation: string | null
  amount: number | null
  currency: string | null
}

/**
 * Receipts that would be affected by renaming vendor `from`.
 * Proxies to GET /api/receipts/vendor-rename-preview?from=...
 */
export const previewVendorRename = createServerFn({ method: 'GET' })
  .inputValidator((input: { from: string }) => input)
  .handler(async (ctx) => {
    const { rows } = await apiCall<{ rows: Array<VendorRenamePreviewRow> }>(
      `/api/receipts/vendor-rename-preview?from=${encodeURIComponent(ctx.data.from)}`,
    )
    return rows
  })

/**
 * Renames vendor `from` to `to` across every receipt with that vendor.
 * Proxies to POST /api/receipts/vendor-rename.
 */
export const renameVendor = createServerFn({ method: 'POST' })
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async (ctx) => {
    return apiCall<{ count: number }>('/api/receipts/vendor-rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx.data),
    })
  })
