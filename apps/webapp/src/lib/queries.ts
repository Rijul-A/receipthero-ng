import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  batchReprocessDocuments,
  checkSession as checkSessionFn,
  clearQueue as clearQueueFn,
  clearSkippedDocuments,
  createReceiptItem as createReceiptItemFn,
  deleteReceipt as deleteReceiptFn,
  deleteReceiptItem as deleteReceiptItemFn,
  exportItemsCsv as exportItemsCsvFn,
  exportReceiptsCsv as exportReceiptsCsvFn,
  exportSpendingReportCsv as exportSpendingReportCsvFn,
  getAppLogs,
  getAvailableCurrencies as getAvailableCurrenciesFn,
  getConfig as getConfigFn,
  getCurrencyTotals as getCurrencyTotalsFn,
  getDocumentImage,
  getDocumentLogs,
  getDocumentThumbnail,
  getHealthStatus,
  getItemCounts as getItemCountsFn,
  getItemFrequencyReport as getItemFrequencyReportFn,
  getItemPriceHistory as getItemPriceHistoryFn,
  getItemReviewStatus as getItemReviewStatusFn,
  getProcessingLogs,
  getQueueStatus as getQueueStatusFn,
  getReceiptDetail as getReceiptDetailFn,
  getSocketToken as getSocketTokenFn,
  getSpendingReport as getSpendingReportFn,
  getVendorSpendReport as getVendorSpendReportFn,
  getWebhookStatus as getWebhookStatusFn,
  login as loginFn,
  logout as logoutFn,
  pauseWorker as pauseWorkerFn,
  previewRename as previewRenameFn,
  previewVendorRename as previewVendorRenameFn,
  renameCanonicalGroup as renameCanonicalGroupFn,
  renameVendor as renameVendorFn,
  resumeWorker as resumeWorkerFn,
  retryAllQueue as retryAllQueueFn,
  retryDocument,
  saveConfig as saveConfigFn,
  searchItemNames as searchItemNamesFn,
  testAiConnection,
  testPaperlessConnection,
  triggerScanAndWait,
  updateReceipt as updateReceiptFn,
  updateReceiptItem as updateReceiptItemFn,
} from './server'
import { downloadTextFile } from './utils'
import type {
  CurrencyTotalsResponse,
  DateRange,
  DocumentImageResponse,
  HealthStatus,
  ItemEdit,
  ItemFrequency,
  ItemReviewStatus,
  NewItem,
  QueueActionResponse,
  QueueStatus,
  ReceiptDetail,
  ReceiptEdit,
  ReceiptItemEntry,
  SaveConfigResponse,
  SpendingReportRow,
  TestConnectionResponse,
  TriggerScanResponse,
  VendorRenamePreviewRow,
  VendorSpend,
  WebhookStatusResponse,
  WorkerStatus,
} from './server'
import type { Config } from '@sm-rn/shared/schemas'
import type { ProcessingLog } from '@sm-rn/shared/types'

// Re-export types for convenience
export type {
  HealthStatus,
  SaveConfigResponse,
  TestConnectionResponse,
  WorkerStatus,
  QueueStatus,
  QueueActionResponse,
  TriggerScanResponse,
  ProcessingLog,
  CurrencyTotalsResponse,
  DocumentImageResponse,
  WebhookStatusResponse,
  ItemReviewStatus,
}
export type { Config }

// ─────────────────────────────────────────────────────────────────────────────
// Query Keys (kept for cache invalidation)
// ─────────────────────────────────────────────────────────────────────────────

export const healthKeys = {
  all: ['health'] as const,
  status: () => [...healthKeys.all, 'status'] as const,
}

export const configKeys = {
  all: ['config'] as const,
  current: () => [...configKeys.all, 'current'] as const,
  currencies: () => [...configKeys.all, 'currencies'] as const,
}

export const statsKeys = {
  all: ['stats'] as const,
  currencyTotals: () => [...statsKeys.all, 'currency-totals'] as const,
  spending: (groupBy: 'week' | 'month', dateRange?: DateRange) =>
    [...statsKeys.all, 'spending', groupBy, dateRange ?? null] as const,
  vendorTotals: (dateRange?: DateRange) =>
    [...statsKeys.all, 'vendor-totals', dateRange ?? null] as const,
}

export const workerKeys = {
  all: ['worker'] as const,
  status: () => [...workerKeys.all, 'status'] as const,
}

export const queueKeys = {
  all: ['queue'] as const,
  status: () => [...queueKeys.all, 'status'] as const,
}

export const webhookKeys = {
  all: ['webhooks'] as const,
  status: () => [...webhookKeys.all, 'status'] as const,
}

export const itemKeys = {
  all: ['items'] as const,
  search: (query: string) => [...itemKeys.all, 'search', query] as const,
  history: (itemNames: Array<string>) =>
    [...itemKeys.all, 'history', itemNames] as const,
  renamePreview: (from: string) =>
    [...itemKeys.all, 'rename-preview', from] as const,
  frequency: (limit: number, dateRange?: DateRange) =>
    [...itemKeys.all, 'frequency', limit, dateRange ?? null] as const,
}

export const receiptKeys = {
  all: ['receipts'] as const,
  detail: (documentId: number) =>
    [...receiptKeys.all, 'detail', documentId] as const,
  vendorRenamePreview: (from: string) =>
    [...receiptKeys.all, 'vendor-rename-preview', from] as const,
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls health endpoint every 30 seconds.
 * Pauses polling when the tab is hidden to save resources.
 */
export function useHealth() {
  return useQuery({
    queryKey: healthKeys.status(),
    queryFn: () => getHealthStatus(),
    refetchInterval: 30_000, // 30 seconds
    // Pause polling when tab is hidden
    refetchIntervalInBackground: false,
    // Also consider stale immediately for fresh data on focus
    staleTime: 0,
  })
}

/**
 * Fetches recent processing logs.
 */
export function useProcessingLogs() {
  return useQuery({
    queryKey: ['processing-logs'],
    queryFn: () => getProcessingLogs(),
    refetchInterval: 5_000, // Poll every 5 seconds for real-time feel
  })
}

/**
 * Fetches historical app logs.
 */
export function useAppLogs(source?: string) {
  return useQuery({
    queryKey: ['app-logs', source],
    queryFn: () => getAppLogs({ data: { source } }),
  })
}

/**
 * Fetches logs for a specific document.
 */
export function useDocumentLogs(documentId: number | null) {
  return useQuery({
    queryKey: ['document-logs', documentId],
    queryFn: () => getDocumentLogs({ data: { documentId: documentId! } }),
    enabled: !!documentId, // Only fetch when documentId is provided
    // Previously fetched once on open and never again, so the log dialog
    // for a still-processing document just froze at whatever was there
    // when you opened it - matches useProcessingLogs' own polling cadence.
    refetchInterval: 5_000,
  })
}

/**
 * Fetches document thumbnail via server function proxy.
 * This allows fetching from internal Docker network when only webapp is exposed.
 */
export function useDocumentThumbnail(documentId: number | null) {
  return useQuery({
    queryKey: ['document-thumbnail', documentId],
    queryFn: () => getDocumentThumbnail({ data: { documentId: documentId! } }),
    enabled: !!documentId,
    staleTime: 1000 * 60 * 60, // Cache thumbnail for 1 hour
  })
}

/**
 * Fetches document image via server function proxy.
 * This allows fetching from internal Docker network when only webapp is exposed.
 */
export function useDocumentImage(documentId: number | null) {
  return useQuery({
    queryKey: ['document-image', documentId],
    queryFn: () => getDocumentImage({ data: { documentId: documentId! } }),
    enabled: !!documentId,
    staleTime: 1000 * 60 * 60, // Cache image for 1 hour
  })
}

/**
 * Triggers a manual retry for a document.
 */
export function useRetryProcessing() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      strategy,
    }: {
      id: number
      strategy: 'full' | 'partial'
    }) => retryDocument({ data: { id, strategy } }),
    // The actual reprocess job runs in the background server-side and
    // takes a moment to start (queue, doc fetch, first progress report),
    // so an immediate post-click invalidateQueries just refetches the
    // still-unchanged prior state - e.g. "Processed successfully" staying
    // on screen briefly even though a fresh reprocess was just triggered.
    // Optimistically flip the local card the instant the click happens
    // instead of waiting on the round trip.
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['processing-logs'] })
      const previous = queryClient.getQueryData<Array<ProcessingLog>>([
        'processing-logs',
      ])
      queryClient.setQueryData<Array<ProcessingLog>>(
        ['processing-logs'],
        (logs) =>
          logs?.map((log) =>
            log.documentId === id
              ? {
                  ...log,
                  status: 'processing',
                  progress: 5,
                  message: 'Reprocessing...',
                }
              : log,
          ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(['processing-logs'], context.previous)
    },
    // Deliberately no onSuccess invalidateQueries - it would fire before the
    // background job has actually started and refetch the same stale data,
    // reverting the optimistic update. The WS live-update path and this
    // query's own polling interval keep it consistent from here.
  })
}

/**
 * Triggers a batch reprocess for multiple already-processed documents.
 */
export function useBatchReprocess() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (documentIds: Array<number>) =>
      batchReprocessDocuments({ data: { documentIds } }),
    // See useRetryProcessing's onMutate for why this is optimistic rather
    // than waiting for the background job to actually report progress.
    onMutate: async (documentIds) => {
      await queryClient.cancelQueries({ queryKey: ['processing-logs'] })
      const previous = queryClient.getQueryData<Array<ProcessingLog>>([
        'processing-logs',
      ])
      queryClient.setQueryData<Array<ProcessingLog>>(
        ['processing-logs'],
        (logs) =>
          logs?.map((log) =>
            documentIds.includes(log.documentId)
              ? {
                  ...log,
                  status: 'processing',
                  progress: 5,
                  message: 'Reprocessing...',
                }
              : log,
          ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(['processing-logs'], context.previous)
    },
    // Deliberately no onSuccess invalidateQueries - see useRetryProcessing.
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Queries & Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches current configuration (with masked API keys).
 */
export function useConfig() {
  return useQuery({
    queryKey: configKeys.current(),
    queryFn: () => getConfigFn(),
  })
}

/**
 * Fetches available ECB currencies (cached on server for 24h).
 */
export function useAvailableCurrencies() {
  return useQuery({
    queryKey: configKeys.currencies(),
    queryFn: async () => {
      const response = await getAvailableCurrenciesFn()
      return response.currencies
    },
    staleTime: 1000 * 60 * 60, // Cache for 1 hour on client
  })
}

/**
 * Fetches currency totals from processed receipts.
 */
export function useCurrencyTotals() {
  return useQuery({
    queryKey: statsKeys.currencyTotals(),
    queryFn: () => getCurrencyTotalsFn(),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  })
}

/**
 * Downloads a CSV export of all processed receipts.
 */
export function useExportReceiptsCsv() {
  return useMutation({
    mutationFn: async () => {
      const csv = await exportReceiptsCsvFn()
      downloadTextFile('receipts.csv', csv)
    },
  })
}

/**
 * Fetches spend aggregated by week or month, by currency and category.
 * `dateRange` (both bounds optional, inclusive) filters to receipts whose
 * own extracted date falls within it.
 */
export function useSpendingReport(
  groupBy: 'week' | 'month',
  dateRange?: DateRange,
) {
  return useQuery<Array<SpendingReportRow>>({
    queryKey: statsKeys.spending(groupBy, dateRange),
    queryFn: async () =>
      (await getSpendingReportFn({ data: { groupBy, ...dateRange } })).rows,
    staleTime: 1000 * 60 * 5,
  })
}

/**
 * Total spend per vendor, by currency - "where does my money actually go",
 * as opposed to the per-item price comparison on the Prices page.
 */
export function useVendorSpendReport(dateRange?: DateRange) {
  return useQuery<Array<VendorSpend>>({
    queryKey: statsKeys.vendorTotals(dateRange),
    queryFn: () => getVendorSpendReportFn({ data: dateRange ?? {} }),
    staleTime: 1000 * 60 * 5,
  })
}

/**
 * Per-product total spend and purchase frequency, across all recorded line
 * items.
 */
export function useItemFrequencyReport(limit = 50, dateRange?: DateRange) {
  return useQuery<Array<ItemFrequency>>({
    queryKey: itemKeys.frequency(limit, dateRange),
    queryFn: () => getItemFrequencyReportFn({ data: { limit, ...dateRange } }),
    staleTime: 1000 * 60 * 5,
  })
}

/**
 * Number of recorded line items per document, keyed by documentId - flags
 * processed receipts that came back with zero items (line_items is
 * optional in the extraction schema, so this can happen silently).
 */
export function useItemCounts(documentIds: Array<number>) {
  return useQuery({
    queryKey: [...itemKeys.all, 'counts', documentIds] as const,
    queryFn: () => getItemCountsFn({ data: { documentIds } }),
    enabled: documentIds.length > 0,
  })
}

/**
 * Per-document item sum + review-item flag - combined with each receipt's
 * own extracted total (already on hand from the processing-logs list) to
 * show a "Review required" indicator without opening each receipt.
 */
export function useItemReviewStatus(documentIds: Array<number>) {
  return useQuery({
    queryKey: [...itemKeys.all, 'review-status', documentIds] as const,
    queryFn: () => getItemReviewStatusFn({ data: { documentIds } }),
    enabled: documentIds.length > 0,
  })
}

/**
 * Downloads a CSV export of the spending report.
 */
export function useExportSpendingReportCsv() {
  return useMutation({
    mutationFn: async ({
      groupBy,
      dateRange,
    }: {
      groupBy: 'week' | 'month'
      dateRange?: DateRange
    }) => {
      const csv = await exportSpendingReportCsvFn({
        data: { groupBy, ...dateRange },
      })
      downloadTextFile(`spending-${groupBy}.csv`, csv)
    },
  })
}

/**
 * Saves configuration to the server.
 * Invalidates config cache on success.
 */
export function useSaveConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (config: Partial<Config>) => saveConfigFn({ data: config }),
    onSuccess: () => {
      // Remove (not just invalidate) the config cache so the settings page
      // always fetches fresh data on next mount instead of briefly showing
      // the stale pre-save values via the useEffect sync.
      queryClient.removeQueries({ queryKey: configKeys.all })
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
    },
  })
}

/**
 * Tests Paperless NGX connection with provided host and apiKey.
 */
export function useTestPaperless() {
  return useMutation({
    mutationFn: (data: {
      host: string
      apiKey: string
    }): Promise<TestConnectionResponse> => testPaperlessConnection({ data }),
  })
}

/**
 * Tests AI provider connection with provided config.
 */
export function useTestAi() {
  return useMutation({
    mutationFn: (data: {
      provider: string
      apiKey?: string
      baseURL?: string
      model: string
    }): Promise<TestConnectionResponse> => testAiConnection({ data }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Control Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pauses the worker.
 */
export function usePauseWorker() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (reason?: string) => pauseWorkerFn({ data: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
      queryClient.invalidateQueries({ queryKey: workerKeys.all })
    },
  })
}

/**
 * Resumes the worker.
 */
export function useResumeWorker() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => resumeWorkerFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
      queryClient.invalidateQueries({ queryKey: workerKeys.all })
    },
  })
}

/**
 * Triggers an immediate worker scan and waits for completion.
 */
export function useTriggerScan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => triggerScanAndWait(),
    onSuccess: () => {
      // Invalidate all relevant queries so UI refreshes
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
      queryClient.invalidateQueries({ queryKey: workerKeys.all })
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Control Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches queue status.
 */
export function useQueueStatus() {
  return useQuery({
    queryKey: queueKeys.status(),
    queryFn: () => getQueueStatusFn(),
    refetchInterval: 30_000,
  })
}

/**
 * Retry all items in the queue immediately.
 */
export function useRetryAllQueue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => retryAllQueueFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
      queryClient.invalidateQueries({ queryKey: queueKeys.all })
    },
  })
}

/**
 * Clear all items from the queue.
 */
export function useClearQueue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => clearQueueFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
      queryClient.invalidateQueries({ queryKey: queueKeys.all })
    },
  })
}

/**
 * Clear skipped documents list.
 */
export function useClearSkipped() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => clearSkippedDocuments(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: healthKeys.all })
      queryClient.invalidateQueries({ queryKey: queueKeys.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches webhook status (enabled state, secret presence, queue stats).
 */
export function useWebhookStatus() {
  return useQuery({
    queryKey: webhookKeys.status(),
    queryFn: () => getWebhookStatusFn(),
    refetchInterval: 30_000,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Item Price Comparison Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Autocomplete search over item names seen across processed receipts.
 */
export function useItemNameSearch(query: string) {
  return useQuery({
    queryKey: itemKeys.search(query),
    queryFn: () => searchItemNamesFn({ data: { query } }),
    enabled: query.trim().length > 0,
  })
}

/**
 * Price history (newest first) for one or more user-selected item names.
 */
export function useItemPriceHistory(itemNames: Array<string>) {
  return useQuery<Array<ReceiptItemEntry>>({
    queryKey: itemKeys.history(itemNames),
    queryFn: () => getItemPriceHistoryFn({ data: { itemNames } }),
    enabled: itemNames.length > 0,
  })
}

/**
 * Downloads a CSV export of every recorded line item.
 */
export function useExportItemsCsv() {
  return useMutation({
    mutationFn: async () => {
      const csv = await exportItemsCsvFn()
      downloadTextFile('receipt-items.csv', csv)
    },
  })
}

/**
 * Adds a manually-entered line item to a receipt - for a breakdown line
 * the AI missed entirely.
 */
export function useCreateReceiptItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: NewItem) => createReceiptItemFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemKeys.all })
      queryClient.invalidateQueries({ queryKey: receiptKeys.all })
    },
  })
}

/**
 * Corrects a single receipt-item row (per-row, not per-product).
 */
export function useUpdateReceiptItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { id: number; edits: ItemEdit }) =>
      updateReceiptItemFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemKeys.all })
      queryClient.invalidateQueries({ queryKey: receiptKeys.all })
    },
  })
}

/**
 * Removes a single line item.
 */
export function useDeleteReceiptItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { id: number }) =>
      deleteReceiptItemFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemKeys.all })
      queryClient.invalidateQueries({ queryKey: receiptKeys.all })
    },
  })
}

/**
 * Rows that would be affected by renaming canonical product `from`.
 */
export function usePreviewRename(from: string | null) {
  return useQuery<Array<ReceiptItemEntry>>({
    queryKey: itemKeys.renamePreview(from ?? ''),
    queryFn: () => previewRenameFn({ data: { from: from ?? '' } }),
    enabled: !!from,
  })
}

/**
 * Renames every row grouped under one canonical product name to another.
 */
export function useRenameCanonicalGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { from: string; to: string }) =>
      renameCanonicalGroupFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemKeys.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt Detail/Edit Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A processed receipt's extracted data plus its recorded line items.
 */
export function useReceiptDetail(documentId: number | null) {
  return useQuery<ReceiptDetail>({
    queryKey: receiptKeys.detail(documentId ?? -1),
    queryFn: () =>
      getReceiptDetailFn({ data: { documentId: documentId as number } }),
    enabled: documentId !== null,
  })
}

/**
 * Corrects receipt-level extracted fields (vendor, total, currency, date,
 * category, store location).
 */
export function useUpdateReceipt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { documentId: number; edits: ReceiptEdit }) =>
      updateReceiptFn({ data: params }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: receiptKeys.detail(variables.documentId),
      })
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] })
      queryClient.invalidateQueries({ queryKey: statsKeys.all })
    },
  })
}

/**
 * Deletes a receipt entirely (ReceiptHero's own tracking of it - the
 * underlying Paperless document is untouched).
 */
export function useDeleteReceipt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { documentId: number }) =>
      deleteReceiptFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptKeys.all })
      queryClient.invalidateQueries({ queryKey: itemKeys.all })
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] })
      queryClient.invalidateQueries({ queryKey: statsKeys.all })
    },
  })
}

/**
 * Receipts that would be affected by renaming vendor `from`.
 */
export function usePreviewVendorRename(from: string | null) {
  return useQuery<Array<VendorRenamePreviewRow>>({
    queryKey: receiptKeys.vendorRenamePreview(from ?? ''),
    queryFn: () => previewVendorRenameFn({ data: { from: from ?? '' } }),
    enabled: !!from,
  })
}

/**
 * Renames vendor `from` to `to` across every receipt with that vendor -
 * e.g. correcting a consistent AI misspelling across every visit to a
 * store at once.
 */
export function useRenameVendor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { from: string; to: string }) =>
      renameVendorFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptKeys.all })
      queryClient.invalidateQueries({ queryKey: itemKeys.all })
      queryClient.invalidateQueries({ queryKey: ['processing-logs'] })
      queryClient.invalidateQueries({ queryKey: statsKeys.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Queries
// ─────────────────────────────────────────────────────────────────────────────

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
}

/**
 * Logs in with Paperless-NGX credentials, setting the session cookie on
 * success.
 */
export function useLogin() {
  return useMutation({
    mutationFn: (params: { username: string; password: string }) =>
      loginFn({ data: params }),
  })
}

/**
 * Ends the session and clears the cookie.
 */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => logoutFn(),
    onSuccess: () => {
      queryClient.clear()
    },
  })
}

/**
 * Whether the current session cookie is still accepted by Paperless.
 */
export function useSession() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: () => checkSessionFn(),
    retry: false,
    staleTime: 0,
  })
}

/**
 * The raw session token, for the one client-side use case that can't ride
 * the httpOnly cookie: authenticating the live-events WebSocket connection.
 */
export function useSocketToken() {
  return useQuery({
    queryKey: [...authKeys.all, 'socket-token'] as const,
    queryFn: () => getSocketTokenFn(),
    staleTime: Infinity,
  })
}
