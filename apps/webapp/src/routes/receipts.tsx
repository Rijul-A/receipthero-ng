import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ReceiptEditDialog } from '@/components/receipts/receipt-edit-dialog'
import {
  useBatchReprocess,
  useItemCounts,
  useItemReviewStatus,
  useProcessingLogs,
} from '@/lib/queries'

export const Route = createFileRoute('/receipts')({
  component: ReceiptsPage,
})

// A cent or two of drift is normal rounding noise (e.g. tax splitting
// unevenly across items) - only flag a real mismatch.
const MISMATCH_TOLERANCE_CENTS = 2

function ReceiptsPage() {
  const { data: logs, isLoading } = useProcessingLogs()
  const batchReprocess = useBatchReprocess()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(
    null,
  )

  const processedReceipts = useMemo(
    () => (logs ?? []).filter((log) => log.status === 'completed'),
    [logs],
  )
  // Shown alongside processed receipts so it's obvious a document is
  // mid-flight, and so it can be excluded from selection - reprocessing
  // something already being processed doesn't make sense.
  const activeReceipts = useMemo(
    () =>
      (logs ?? []).filter(
        (log) => log.status === 'processing' || log.status === 'retrying',
      ),
    [logs],
  )
  const { data: itemCounts } = useItemCounts(
    processedReceipts.map((r) => r.documentId),
  )
  const { data: reviewStatus } = useItemReviewStatus(
    processedReceipts.map((r) => r.documentId),
  )

  const allSelected =
    processedReceipts.length > 0 && selected.size === processedReceipts.length

  const toggleAll = () => {
    setSelected(
      allSelected
        ? new Set()
        : new Set(processedReceipts.map((r) => r.documentId)),
    )
  }

  const toggleOne = (documentId: number) => {
    const next = new Set(selected)
    if (next.has(documentId)) next.delete(documentId)
    else next.add(documentId)
    setSelected(next)
  }

  const handleReprocess = () => {
    batchReprocess.mutate(Array.from(selected), {
      onSuccess: (result) => {
        toast.success(result.message)
        setSelected(new Set())
      },
      onError: (error) => toast.error(error.message),
    })
  }

  const needsReview = (documentId: number, amount: number | undefined) => {
    const status = reviewStatus?.[documentId]
    if (!status) return false
    const mismatch =
      Math.abs(status.itemsTotal - (amount ?? 0)) > MISMATCH_TOLERANCE_CENTS
    return status.hasReviewItem || mismatch
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Batch Reprocess</h1>
          <p className="text-muted-foreground">
            Re-run already-processed receipts — useful after changing a
            workflow's extraction schema, or to backfill data (like
            price-comparison line items) that older receipts predate. Documents
            currently being processed are also listed below for visibility, but
            can't be selected.
          </p>
        </div>
        <Button
          onClick={handleReprocess}
          disabled={selected.size === 0 || batchReprocess.isPending}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Reprocess Selected ({selected.size})
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : processedReceipts.length === 0 && activeReceipts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No processed receipts yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="py-2 pr-4">File</th>
                    <th className="py-2 pr-4">Vendor</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Items</th>
                    <th className="py-2 pr-4">Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReceipts.map((receipt) => (
                    <tr key={receipt.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <input
                          type="checkbox"
                          disabled
                          aria-label="Currently processing"
                        />
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {receipt.fileName ?? `Document ${receipt.documentId}`}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">—</td>
                      <td className="py-2 pr-4 text-muted-foreground">—</td>
                      <td className="py-2 pr-4 text-muted-foreground">—</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {receipt.status === 'retrying'
                            ? 'Retrying'
                            : 'Processing'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {processedReceipts.map((receipt) => (
                    <tr
                      key={receipt.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-accent/50"
                      onClick={() => setEditingDocumentId(receipt.documentId)}
                    >
                      <td
                        className="py-2 pr-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(receipt.documentId)}
                          onChange={() => toggleOne(receipt.documentId)}
                          aria-label={`Select ${receipt.fileName ?? receipt.documentId}`}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        {receipt.fileName ?? `Document ${receipt.documentId}`}
                      </td>
                      <td className="py-2 pr-4">{receipt.vendor ?? '—'}</td>
                      <td className="py-2 pr-4">
                        {receipt.amount !== undefined
                          ? `${(receipt.amount / 100).toFixed(2)} ${receipt.currency ?? ''}`.trim()
                          : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {itemCounts?.[receipt.documentId] ? (
                            itemCounts[receipt.documentId]
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-amber-600 border-amber-600"
                            >
                              0 - needs review
                            </Badge>
                          )}
                          {needsReview(receipt.documentId, receipt.amount) && (
                            <Badge
                              variant="outline"
                              className="text-amber-600 border-amber-600"
                            >
                              Review required
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{receipt.updatedAt}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ReceiptEditDialog
        documentId={editingDocumentId}
        onOpenChange={(open) => {
          if (!open) setEditingDocumentId(null)
        }}
      />
    </div>
  )
}
