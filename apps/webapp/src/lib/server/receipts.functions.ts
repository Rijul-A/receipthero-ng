/**
 * Receipt Detail/Edit Server Functions
 */

import { createServerFn } from '@tanstack/react-start'
import type { ReceiptItemEntry } from './items.functions'

const API_URL = process.env.API_URL || 'http://localhost:3001'

async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init)
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }
  return response.json() as T
}

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
