import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'

export const retryQueue = sqliteTable('retry_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('documentId').unique().notNull(),
  attempts: integer('attempts').notNull(),
  lastError: text('lastError').notNull(),
  nextRetryAt: text('nextRetryAt').notNull(), // ISO date string
})

export type RetryQueueEntry = typeof retryQueue.$inferSelect
export type NewRetryQueueEntry = typeof retryQueue.$inferInsert

export const processingLogs = sqliteTable('processing_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('documentId').notNull(),
  workflowId: integer('workflowId'), // Optional: links to a specific workflow
  status: text('status').notNull(), // 'detected', 'processing', 'completed', 'failed', 'retrying'
  message: text('message'),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(1),
  fileName: text('fileName'),
  vendor: text('vendor'),
  amount: integer('amount'), // Stored in cents/base units
  currency: text('currency'),
  // Branch/address, e.g. distinguishing two locations of the same chain.
  // Best-effort AI extraction; also user-editable.
  storeLocation: text('storeLocation'),
  receiptData: text('receiptData'), // Full extracted JSON string (Legacy)
  extractedData: text('extractedData'), // Generic extracted JSON string
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
})

export type ProcessingLogEntry = typeof processingLogs.$inferSelect
export type NewProcessingLogEntry = typeof processingLogs.$inferInsert

export const workflows = sqliteTable('workflows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  triggerTag: text('triggerTag').notNull(),
  zodSource: text('zodSource').notNull(), // User's Zod code verbatim
  jsonSchema: text('jsonSchema').notNull(), // JSON Schema string converted from Zod
  promptInstructions: text('promptInstructions'),
  titleTemplate: text('titleTemplate'),
  // Opt-in: also send Paperless's own OCR'd text for the document to the AI
  // alongside the image, as reference context (not authoritative - OCR can
  // be wrong, especially on faded thermal receipts). See extract.ts.
  includeOcrText: integer('includeOcrText', { mode: 'boolean' }).notNull().default(false),
  outputMapping: text('outputMapping').notNull(), // JSON string of output mapping config
  processedTag: text('processedTag').notNull(),
  failedTag: text('failedTag'),
  skippedTag: text('skippedTag'),
  isBuiltIn: integer('isBuiltIn', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
})

export type Workflow = typeof workflows.$inferSelect
export type NewWorkflow = typeof workflows.$inferInsert

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull(),
  level: text('level').notNull(), // 'debug', 'info', 'warn', 'error'
  source: text('source').notNull(), // 'worker', 'api', 'core'
  message: text('message').notNull(),
  context: text('context'), // JSON string
  documentId: integer('documentId'), // Optional: links log to a specific document
})

export type LogEntryRow = typeof logs.$inferSelect
export type NewLogEntryRow = typeof logs.$inferInsert

// Worker state for pause/resume control (single row table)
export const workerStateSchema = sqliteTable('worker_state', {
  id: integer('id').primaryKey().default(1), // Always id=1, single row
  isPaused: integer('isPaused', { mode: 'boolean' }).notNull().default(false),
  pausedAt: text('pausedAt'), // ISO date string when paused
  pauseReason: text('pauseReason'), // Optional reason for pause
  scanRequested: integer('scanRequested', { mode: 'boolean' }).notNull().default(false), // Flag to trigger immediate scan
  lastScanResult: text('lastScanResult'), // JSON string with scan results (documentsFound, documentsQueued, etc.)
  lastScanCompletedAt: text('lastScanCompletedAt'), // ISO timestamp when last scan completed (for timer reset)
  isRunning: integer('isRunning', { mode: 'boolean' }).notNull().default(false), // Cross-process lock
  updatedAt: text('updatedAt').notNull(),
})

export type WorkerStateRow = typeof workerStateSchema.$inferSelect
export type NewWorkerStateRow = typeof workerStateSchema.$inferInsert

// Skipped documents tracking
export const skippedDocumentsSchema = sqliteTable('skipped_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('documentId').unique().notNull(),
  reason: text('reason').notNull(), // e.g., 'no_receipt_data', 'unsupported_format'
  fileName: text('fileName'),
  skippedAt: text('skippedAt').notNull(), // ISO date string
})

export type SkippedDocumentEntry = typeof skippedDocumentsSchema.$inferSelect
export type NewSkippedDocumentEntry = typeof skippedDocumentsSchema.$inferInsert

// Webhook queue for storing document IDs received from Paperless-ngx webhooks
export const webhookQueue = sqliteTable('webhook_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('documentId').notNull(),
  source: text('source').notNull().default('paperless'), // Future: support multiple webhook sources
  payload: text('payload'), // Raw JSON payload for debugging
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  receivedAt: text('receivedAt').notNull(), // ISO date string
  processedAt: text('processedAt'), // ISO date string, null until processed
})

export type WebhookQueueEntry = typeof webhookQueue.$inferSelect
export type NewWebhookQueueEntry = typeof webhookQueue.$inferInsert

// Individual line items extracted from receipts, for cross-vendor price comparison
export const receiptItems = sqliteTable('receipt_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Null for a manually-recorded "price sighting" - a price seen but not
  // purchased, so there's no underlying Paperless document at all. Every
  // other lookup/query in this table is already keyed by product identity
  // or an explicit documentId list, not an assumption that documentId is
  // always present - see createPriceSighting/syncReceiptToPaperless for the
  // functions that specifically guard against this.
  documentId: integer('documentId'),
  vendor: text('vendor'),
  itemName: text('itemName').notNull(),
  // AI-assigned canonical product name, so "Almarai Milk 1L" and "Al Marai
  // Fresh Milk 1L" from different stores group together. Falls back to
  // itemName if canonicalization fails or hasn't run (best-effort).
  canonicalName: text('canonicalName'),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: integer('unitPrice'), // Stored in cents/base units
  totalPrice: integer('totalPrice'), // Stored in cents/base units
  // AI-extracted total size of the whole line item (e.g. 1980 for a "6x330ml"
  // pack), used to compute a true per-100ml/per-100g price across differently
  // sized/packaged versions of the same product. Null if not determinable.
  totalSize: real('totalSize'),
  // Normalized unit for totalSize: 'ml', 'g', or 'count' (for uncountable/
  // unit-less items like "1 loaf"). Volume/weight are normalized to ml/g by
  // the AI at extraction time so 'l'/'kg' never need separate handling here.
  sizeUnit: text('sizeUnit'),
  currency: text('currency'),
  purchaseDate: text('purchaseDate'), // ISO date string (YYYY-MM-DD), from the receipt itself
  // Wall-clock time as printed/entered (HH:MM), display/edit only - never
  // compared or bucketed by (see analytics.ts's date-range filtering, which
  // stays purchaseDate-only on purpose). Deliberately a separate column
  // instead of folding into purchaseDate, so every existing bare-date
  // comparison/sort/display of purchaseDate keeps working untouched.
  purchaseTime: text('purchaseTime'),
  // True for a manually-recorded price sighting (documentId is null);
  // false/0 for a normally-scanned receipt item. Redundant with
  // `documentId IS NULL` but named explicitly so intent reads clearly at
  // every call site without re-deriving it from a null check.
  isSighting: integer('isSighting', { mode: 'boolean' }).notNull().default(false),
  // Denormalized copy of the receipt's store branch/address, so price
  // comparison can distinguish two locations of the same vendor without a
  // join back to processingLogs.
  storeLocation: text('storeLocation'),
  // Display order within the receipt, editable independent of insertion
  // order - lets a user re-sequence items to match the physical receipt
  // (e.g. after adding one the scanner skipped, which would otherwise only
  // ever append at the end).
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: text('createdAt').notNull(),
})

export type ReceiptItemEntry = typeof receiptItems.$inferSelect
export type NewReceiptItemEntry = typeof receiptItems.$inferInsert

// User corrections to AI-assigned canonical product names, keyed by the raw
// (as-OCR'd) item name so future receipts with the exact same raw text skip
// the AI's (non-deterministic) guess entirely and use the correction
// directly, instead of merely nudging it via the existing-names candidate
// list passed to the model.
export const itemNameOverrides = sqliteTable('item_name_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Stored lowercase+trimmed; lookups normalize the same way.
  rawItemNameLower: text('rawItemNameLower').unique().notNull(),
  canonicalName: text('canonicalName').notNull(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
})

export type ItemNameOverrideEntry = typeof itemNameOverrides.$inferSelect
export type NewItemNameOverrideEntry = typeof itemNameOverrides.$inferInsert
