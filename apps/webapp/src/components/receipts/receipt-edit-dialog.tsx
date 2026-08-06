import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import type { ReceiptItemEntry } from '@/lib/server'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  useDeleteReceipt,
  useDeleteReceiptItem,
  useReceiptDetail,
  useUpdateReceipt,
  useUpdateReceiptItem,
} from '@/lib/queries'

// A refund, free item, or an AI extraction miss all end up looking like a
// price <= 0 - flagged for the user to review (net a discount into the
// main item's price and delete the discount line, delete a refund/free
// line entirely, etc.) rather than silently trusted or auto-corrected.
function needsReview(totalPrice: number | null): boolean {
  return totalPrice !== null && totalPrice <= 0
}

interface ReceiptEditDialogProps {
  documentId: number | null
  onOpenChange: (open: boolean) => void
}

export function ReceiptEditDialog({
  documentId,
  onOpenChange,
}: ReceiptEditDialogProps) {
  return (
    <Dialog open={documentId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        {documentId !== null && (
          <ReceiptDetail
            documentId={documentId}
            onDeleted={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function parseReceiptData(receiptData: string | null): Record<string, unknown> {
  if (!receiptData) return {}
  try {
    return JSON.parse(receiptData)
  } catch {
    return {}
  }
}

function formatMajorUnits(cents: number | null): string {
  return cents !== null ? (cents / 100).toFixed(2) : ''
}

function ReceiptDetail({
  documentId,
  onDeleted,
}: {
  documentId: number
  onDeleted: () => void
}) {
  const { data: detail, isLoading } = useReceiptDetail(documentId)
  const updateReceipt = useUpdateReceipt()
  const deleteReceipt = useDeleteReceipt()

  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [vendor, setVendor] = useState('')
  const [storeLocation, setStoreLocation] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [currency, setCurrency] = useState('')
  const [category, setCategory] = useState('')
  const [initializedFor, setInitializedFor] = useState<number | null>(null)

  useEffect(() => {
    // Re-syncs whenever this dialog is opened for a (possibly different)
    // document, but not on every background refetch, so in-progress edits
    // in the form aren't clobbered by a save-triggered refetch.
    if (!detail || initializedFor === documentId) return
    const parsed = parseReceiptData(detail.log.receiptData)
    setVendor(detail.log.vendor ?? '')
    setStoreLocation(detail.log.storeLocation ?? '')
    setDate(typeof parsed.date === 'string' ? parsed.date : '')
    setTime(typeof parsed.time === 'string' ? parsed.time : '')
    setCurrency(detail.log.currency ?? '')
    setCategory(typeof parsed.category === 'string' ? parsed.category : '')
    setInitializedFor(documentId)
    setMode('view')
  }, [detail, documentId, initializedFor])

  if (isLoading || !detail) {
    return <p className="text-xs text-muted-foreground">Loading...</p>
  }

  const handleSaveReceipt = () => {
    updateReceipt.mutate(
      {
        documentId,
        edits: { vendor, storeLocation, date, time, currency, category },
      },
      {
        onSuccess: () => toast.success('Receipt updated'),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  const handleDeleteReceipt = () => {
    deleteReceipt.mutate(
      { documentId },
      {
        onSuccess: () => {
          toast.success('Receipt deleted')
          onDeleted()
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  const fields: Array<[label: string, value: string]> = [
    ['Store name', vendor || '—'],
    ['Store location', storeLocation || '—'],
    ['Date', date || '—'],
    ['Time', time || '—'],
    ['Currency', currency || '—'],
    ['Category', category || '—'],
  ]

  return (
    <div className="space-y-6">
      <DialogHeader className="flex-row items-center justify-between pr-8">
        <DialogTitle>
          {detail.log.fileName ?? `Document ${documentId}`}
        </DialogTitle>
        <div className="flex items-center gap-2">
          {mode === 'edit' && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete receipt
            </Button>
          )}
          {mode === 'view' ? (
            <Button size="sm" variant="outline" onClick={() => setMode('edit')}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setMode('view')}>
              Done
            </Button>
          )}
        </div>
      </DialogHeader>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this receipt?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes ReceiptHero's tracking of this receipt and all of its
              recorded line items. The original document in Paperless is not
              affected - if it's reprocessed later, it'll be tracked fresh. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleDeleteReceipt}
              disabled={deleteReceipt.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mode === 'view' ? (
        <div className="grid grid-cols-2 gap-3 text-xs">
          {fields.map(([label, value]) => (
            <div key={label} className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div>{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="vendor">Store name</Label>
            <Input
              id="vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="storeLocation">Store location</Label>
            <Input
              id="storeLocation"
              placeholder="e.g. Mall of the Emirates"
              value={storeLocation}
              onChange={(e) => setStoreLocation(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="time">Time</Label>
            <Input
              id="time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSaveReceipt}
            disabled={updateReceipt.isPending}
          >
            Save
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-xs">
          <span className="text-muted-foreground">
            Total (from items below):{' '}
          </span>
          <span className="font-medium">
            {formatMajorUnits(detail.log.amount)} {detail.log.currency ?? ''}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Items ({detail.items.length})
        </Label>
        {detail.items.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              No line items recorded for this receipt. If it's no longer
              relevant (e.g. you removed everything on it), you can delete the
              receipt entirely.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete receipt
            </Button>
          </div>
        ) : mode === 'view' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4">Price</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {item.canonicalName ?? item.itemName}
                  </td>
                  <td className="py-2 pr-4">{item.quantity}</td>
                  <td className="py-2 pr-4">
                    {formatMajorUnits(item.totalPrice)} {item.currency ?? ''}
                    {needsReview(item.totalPrice) && (
                      <Badge
                        variant="outline"
                        className="ml-2 text-amber-600 border-amber-600"
                      >
                        Needs review
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="space-y-2">
            {detail.items.map((item) => (
              <ItemEditRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemEditRow({ item }: { item: ReceiptItemEntry }) {
  const updateItem = useUpdateReceiptItem()
  const deleteItem = useDeleteReceiptItem()

  const [name, setName] = useState(item.canonicalName ?? item.itemName)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [totalPrice, setTotalPrice] = useState(
    formatMajorUnits(item.totalPrice),
  )

  const parsedTotalPrice = Number(totalPrice)
  // An empty field (Number('') === 0) isn't the same as an actual zero
  // price - don't flag it before the user has entered anything.
  const showReviewWarning =
    totalPrice.trim() !== '' &&
    Number.isFinite(parsedTotalPrice) &&
    parsedTotalPrice <= 0

  const handleSave = () => {
    const parsedQuantity = Number(quantity)

    updateItem.mutate(
      {
        id: item.id,
        edits: {
          canonicalName: name,
          ...(Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? { quantity: parsedQuantity }
            : {}),
          ...(Number.isFinite(parsedTotalPrice)
            ? { totalPrice: parsedTotalPrice }
            : {}),
        },
      },
      {
        onSuccess: () => toast.success('Item updated'),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  const handleDelete = () => {
    deleteItem.mutate(
      { id: item.id },
      {
        onSuccess: () => toast.success('Item deleted'),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <div className="space-y-1 border-b pb-2 last:border-0">
      <div className="grid grid-cols-[1fr_5rem_6rem_auto_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Qty</Label>
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Price</Label>
          <Input
            type="number"
            step="0.01"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
            className="text-xs"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={updateItem.isPending}
        >
          Save
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleteItem.isPending}
          aria-label={`Delete ${name}`}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
      {showReviewWarning && (
        <p className="text-[10px] text-amber-600">
          Zero or negative price - a refund/free item you likely want to delete,
          or a discount to net into the main item and delete this line.
        </p>
      )}
    </div>
  )
}
