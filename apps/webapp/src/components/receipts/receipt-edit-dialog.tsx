import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ReceiptItemEntry } from '@/lib/server'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  useReceiptDetail,
  useUpdateReceipt,
  useUpdateReceiptItem,
} from '@/lib/queries'

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
        {documentId !== null && <ReceiptEditForm documentId={documentId} />}
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

function ReceiptEditForm({ documentId }: { documentId: number }) {
  const { data: detail, isLoading } = useReceiptDetail(documentId)
  const updateReceipt = useUpdateReceipt()

  const [vendor, setVendor] = useState('')
  const [storeLocation, setStoreLocation] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [currency, setCurrency] = useState('')
  const [category, setCategory] = useState('')
  const [initializedFor, setInitializedFor] = useState<number | null>(null)

  useEffect(() => {
    if (!detail || initializedFor === documentId) return
    const parsed = parseReceiptData(detail.log.receiptData)
    setVendor(detail.log.vendor ?? '')
    setStoreLocation(detail.log.storeLocation ?? '')
    setDate(typeof parsed.date === 'string' ? parsed.date : '')
    setTime(typeof parsed.time === 'string' ? parsed.time : '')
    setCurrency(detail.log.currency ?? '')
    setCategory(typeof parsed.category === 'string' ? parsed.category : '')
    setInitializedFor(documentId)
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

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>
          {detail.log.fileName ?? `Document ${documentId}`}
        </DialogTitle>
      </DialogHeader>

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

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-xs">
          <span className="text-muted-foreground">
            Total (from items below):{' '}
          </span>
          <span className="font-medium">
            {formatMajorUnits(detail.log.amount)} {detail.log.currency ?? ''}
          </span>
        </div>
        <Button
          size="sm"
          onClick={handleSaveReceipt}
          disabled={updateReceipt.isPending}
        >
          Save
        </Button>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Items ({detail.items.length})
        </Label>
        {detail.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No line items recorded for this receipt.
          </p>
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

  const [name, setName] = useState(item.canonicalName ?? item.itemName)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [totalPrice, setTotalPrice] = useState(
    formatMajorUnits(item.totalPrice),
  )

  const handleSave = () => {
    const parsedQuantity = Number(quantity)
    const parsedTotalPrice = Number(totalPrice)

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

  return (
    <div className="grid grid-cols-[1fr_5rem_6rem_auto] gap-2 items-end border-b pb-2 last:border-0">
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
    </div>
  )
}
