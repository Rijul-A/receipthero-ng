import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Pencil, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ReceiptEditDialog } from '@/components/receipts/receipt-edit-dialog'
import { useBatchReprocess, useProcessingLogs } from '@/lib/queries'

export const Route = createFileRoute('/receipts')({
  component: ReceiptsPage,
})

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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Batch Reprocess</h1>
          <p className="text-muted-foreground">
            Re-run already-processed receipts — useful after changing a
            workflow's extraction schema, or to backfill data (like
            price-comparison line items) that older receipts predate.
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
            Processed Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : processedReceipts.length === 0 ? (
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
                    <th className="py-2 pr-4">Processed</th>
                    <th className="py-2 pr-4 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {processedReceipts.map((receipt) => (
                    <tr key={receipt.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
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
                        <Badge variant="outline">{receipt.updatedAt}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setEditingDocumentId(receipt.documentId)
                          }
                          aria-label={`Edit ${receipt.fileName ?? receipt.documentId}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
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
