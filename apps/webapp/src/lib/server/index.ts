// Re-export all server functions for convenient importing
export { getHealthStatus, type HealthStatus } from './health.functions'
export {
  getConfig,
  saveConfig,
  getAvailableCurrencies,
  type SaveConfigResponse,
  type CurrenciesResponse,
  type CurrencyInfo,
} from './config.functions'
export {
  getWorkerStatus,
  pauseWorker,
  resumeWorker,
  triggerScanAndWait,
  type WorkerStatus,
  type ScanResult,
  type TriggerScanResponse,
} from './worker.functions'
export {
  getQueueStatus,
  retryAllQueue,
  clearQueue,
  getSkippedDocuments,
  clearSkippedDocuments,
  type QueueStatus,
  type QueueItem,
  type QueueActionResponse,
} from './queue.functions'
export {
  getProcessingLogs,
  getDocumentLogs,
  retryDocument,
  batchReprocessDocuments,
  getAppLogs,
  type ProcessingLog,
  type RetryDocumentResponse,
} from './processing.functions'
export {
  testPaperlessConnection,
  testAiConnection,
  type TestConnectionResponse,
} from './test.functions'
export {
  getCurrencyTotals,
  exportReceiptsCsv,
  getSpendingReport,
  exportSpendingReportCsv,
  getVendorSpendReport,
  type CurrencyTotal,
  type CurrencyTotalsResponse,
  type SpendingReportRow,
  type SpendingReportResponse,
  type VendorSpend,
  type DateRange,
} from './stats.functions'
export {
  getDocumentThumbnail,
  getDocumentImage,
  type DocumentImageResponse,
} from './documents.functions'
export {
  getWebhookStatus,
  type WebhookStatusResponse,
  type WebhookQueueStats,
} from './webhooks.functions'
export {
  searchItemNames,
  getItemPriceHistory,
  exportItemsCsv,
  updateReceiptItem,
  deleteReceiptItem,
  previewRename,
  renameCanonicalGroup,
  getItemFrequencyReport,
  type ReceiptItemEntry,
  type ItemEdit,
  type ItemFrequency,
} from './items.functions'
export {
  getReceiptDetail,
  updateReceipt,
  deleteReceipt,
  previewVendorRename,
  renameVendor,
  type ReceiptDetail,
  type ProcessingLogEntry,
  type ReceiptEdit,
  type VendorRenamePreviewRow,
} from './receipts.functions'
