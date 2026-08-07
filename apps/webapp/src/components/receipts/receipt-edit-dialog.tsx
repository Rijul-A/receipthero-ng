import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DragEndEvent } from '@dnd-kit/core'
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
import { Badge } from '@/components/ui/badge'
import { useClickToConfirm } from '@/hooks/use-click-to-confirm'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  useBatchReprocess,
  useCreateReceiptItem,
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

function formatTotalSize(
  totalSize: number | null,
  sizeUnit: string | null,
): string {
  if (totalSize === null || !sizeUnit) return '—'
  return sizeUnit === 'count' ? `${totalSize}` : `${totalSize}${sizeUnit}`
}

interface EditableItem {
  id: number
  original: ReceiptItemEntry
  name: string
  quantity: string
  totalPrice: string
  totalSize: string
  sizeUnit: 'ml' | 'g' | 'count' | ''
}

function toEditableItem(item: ReceiptItemEntry): EditableItem {
  return {
    id: item.id,
    original: item,
    name: item.canonicalName ?? item.itemName,
    quantity: String(item.quantity),
    totalPrice: formatMajorUnits(item.totalPrice),
    totalSize: item.totalSize !== null ? String(item.totalSize) : '',
    sizeUnit: item.sizeUnit ?? '',
  }
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
  const updateItem = useUpdateReceiptItem()
  const deleteItem = useDeleteReceiptItem()
  const deleteReceipt = useDeleteReceipt()
  const reprocess = useBatchReprocess()
  // Must be called unconditionally, before the loading early-return below -
  // hooks can't be called after a conditional return without changing the
  // number of hooks run between renders (React error #310).
  const deleteReceiptConfirm = useClickToConfirm(() => {
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
  })

  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [vendor, setVendor] = useState('')
  const [storeLocation, setStoreLocation] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [currency, setCurrency] = useState('')
  const [category, setCategory] = useState('')
  const [initializedFor, setInitializedFor] = useState<number | null>(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [editableItems, setEditableItems] = useState<Array<EditableItem>>([])
  const [deletedItemIds, setDeletedItemIds] = useState<Array<number>>([])
  const [isSaving, setIsSaving] = useState(false)

  // Must also be called unconditionally, before the loading early-return
  // below - same Rules-of-Hooks reasoning as deleteReceiptConfirm above.
  const dragSensors = useSensors(
    useSensor(PointerSensor, {
      // Requires a small drag before activating, so a plain click/tap on
      // the handle (or an accidental touch-scroll) doesn't get mistaken
      // for the start of a drag.
      activationConstraint: { distance: 4 },
    }),
  )

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
    setShowAddItem(false)
    setEditableItems(detail.items.map(toEditableItem))
    setDeletedItemIds([])
  }, [detail, documentId, initializedFor])

  if (isLoading || !detail) {
    return <p className="text-xs text-muted-foreground">Loading...</p>
  }

  const handleReprocess = () => {
    reprocess.mutate([documentId], {
      onSuccess: () => toast.success('Reprocessing started'),
      onError: (error) => toast.error(error.message),
    })
  }

  const handleEnterEdit = () => {
    // Re-sync from the latest server data rather than whatever the last
    // edit session left behind, so editing always starts from current truth.
    setEditableItems(detail.items.map(toEditableItem))
    setDeletedItemIds([])
    setMode('edit')
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setEditableItems((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id)
      const newIndex = prev.findIndex((item) => item.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const handleItemFieldChange = (id: number, patch: Partial<EditableItem>) => {
    setEditableItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  // Local-only until Save is clicked - the item just disappears from this
  // list and its id is queued for deletion, matching how field edits and
  // reordering already stay unsaved until the receipt-level Save.
  const handleDeleteItem = (item: EditableItem) => {
    setEditableItems((prev) => prev.filter((i) => i.id !== item.id))
    setDeletedItemIds((prev) => [...prev, item.id])
  }

  const handleItemAdded = (item: ReceiptItemEntry) => {
    setEditableItems((prev) => [...prev, toEditableItem(item)])
    setShowAddItem(false)
  }

  // Everything (receipt fields, item field edits, and reordering) commits
  // together as one Save, rather than each item racing its own independent
  // save - validates every item up front and aborts the whole save with a
  // specific error rather than applying some edits and silently skipping
  // others.
  const handleSaveAll = async () => {
    if (!vendor.trim()) {
      toast.error('Store name cannot be empty')
      return
    }
    if (!date.trim()) {
      toast.error('Date cannot be empty')
      return
    }
    if (!currency.trim()) {
      toast.error('Currency cannot be empty')
      return
    }

    type ItemUpdate = {
      id: number
      edits: {
        canonicalName?: string
        quantity: number
        totalPrice: number | null
        totalSize: number | null
        sizeUnit: 'ml' | 'g' | 'count' | null
        sortOrder: number
      }
    }
    const itemUpdates: Array<ItemUpdate> = []

    for (const [index, item] of editableItems.entries()) {
      if (!item.name.trim()) {
        toast.error(`Item name cannot be empty (row ${index + 1})`)
        return
      }

      const parsedQuantity = Number(item.quantity)
      if (
        item.quantity.trim() === '' ||
        !Number.isFinite(parsedQuantity) ||
        parsedQuantity <= 0
      ) {
        toast.error(`"${item.name}": quantity must be a positive number`)
        return
      }

      const nextTotalPrice =
        item.totalPrice.trim() === '' ? null : Number(item.totalPrice)
      if (nextTotalPrice !== null && !Number.isFinite(nextTotalPrice)) {
        toast.error(
          `"${item.name}": price must be a number, or left blank if unknown`,
        )
        return
      }

      let sizeEdits: {
        totalSize: number | null
        sizeUnit: 'ml' | 'g' | 'count' | null
      }
      if (item.totalSize.trim() === '') {
        sizeEdits = { totalSize: null, sizeUnit: null }
      } else {
        const parsedTotalSize = Number(item.totalSize)
        if (!Number.isFinite(parsedTotalSize) || parsedTotalSize <= 0) {
          toast.error(
            `"${item.name}": total size must be a positive number, or left blank`,
          )
          return
        }
        sizeEdits = {
          totalSize: parsedTotalSize,
          sizeUnit: item.sizeUnit || null,
        }
      }

      const originalName = item.original.canonicalName ?? item.original.itemName
      const nameChanged = item.name.trim() !== originalName
      const quantityChanged = parsedQuantity !== item.original.quantity
      const priceChanged =
        nextTotalPrice !==
        (item.original.totalPrice === null
          ? null
          : item.original.totalPrice / 100)
      const sizeChanged =
        sizeEdits.totalSize !== item.original.totalSize ||
        sizeEdits.sizeUnit !== item.original.sizeUnit
      const orderChanged = index !== item.original.sortOrder

      if (
        nameChanged ||
        quantityChanged ||
        priceChanged ||
        sizeChanged ||
        orderChanged
      ) {
        itemUpdates.push({
          id: item.id,
          edits: {
            ...(nameChanged ? { canonicalName: item.name.trim() } : {}),
            quantity: parsedQuantity,
            totalPrice: nextTotalPrice,
            ...sizeEdits,
            sortOrder: index,
          },
        })
      }
    }

    setIsSaving(true)
    try {
      await updateReceipt.mutateAsync({
        documentId,
        edits: { vendor, storeLocation, date, time, currency, category },
      })
      await Promise.all([
        ...itemUpdates.map((update) => updateItem.mutateAsync(update)),
        ...deletedItemIds.map((id) => deleteItem.mutateAsync({ id })),
      ])
      setDeletedItemIds([])
      toast.success('Receipt updated')
      setMode('view')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save changes',
      )
    } finally {
      setIsSaving(false)
    }
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
              variant={
                deleteReceiptConfirm.confirming ? 'destructive' : 'ghost'
              }
              className={
                deleteReceiptConfirm.confirming ? '' : 'text-destructive'
              }
              onClick={deleteReceiptConfirm.handleClick}
              disabled={deleteReceipt.isPending}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {deleteReceiptConfirm.confirming
                ? 'Click again to delete'
                : 'Delete receipt'}
            </Button>
          )}
          {mode === 'view' && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReprocess}
              disabled={reprocess.isPending}
              title="Reprocess this receipt from scratch"
            >
              {reprocess.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Reprocess
            </Button>
          )}
          {mode === 'view' ? (
            <Button size="sm" variant="outline" onClick={handleEnterEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Discard unsaved edits, including any pending deletions -
                  // nothing has touched the server yet.
                  setEditableItems(detail.items.map(toEditableItem))
                  setDeletedItemIds([])
                  setMode('view')
                }}
                disabled={isSaving}
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveAll} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save
              </Button>
            </>
          )}
        </div>
      </DialogHeader>

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

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-xs">
          <span className="text-muted-foreground">
            Total (from items below):{' '}
          </span>
          <span className="font-medium">
            {formatMajorUnits(
              detail.items.reduce(
                (sum, item) => sum + (item.totalPrice ?? 0),
                0,
              ),
            )}{' '}
            {detail.log.currency ?? ''}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Items ({detail.items.length})
        </Label>
        {mode === 'view' ? (
          detail.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No line items recorded for this receipt.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Total size</th>
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
                      {formatTotalSize(item.totalSize, item.sizeUnit)}
                    </td>
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
          )
        ) : (
          <div className="space-y-2">
            {editableItems.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No line items recorded for this receipt yet. Add one below, or
                delete the receipt if it's no longer relevant.
              </p>
            )}
            {editableItems.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                <strong>Total size</strong> is the volume/weight for{' '}
                <em>everything on that line</em> combined - already multiplied
                by pack size and Qty, not the size of one item. E.g. a 6-pack of
                330ml cans bought once (Qty 1) is total size 1980ml, not 330ml.
                Drag <GripVertical className="inline h-3 w-3" /> to reorder.
              </p>
            )}
            <DndContext sensors={dragSensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={editableItems.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {editableItems.map((item) => (
                  <ItemEditRow
                    key={item.id}
                    item={item}
                    onChange={(patch) => handleItemFieldChange(item.id, patch)}
                    onDelete={() => handleDeleteItem(item)}
                    isDeleting={deleteItem.isPending}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {showAddItem ? (
              <NewItemRow
                documentId={documentId}
                onAdded={handleItemAdded}
                onCancel={() => setShowAddItem(false)}
              />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddItem(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add item
              </Button>
            )}
            {editableItems.length === 0 && (
              <Button
                size="sm"
                variant={
                  deleteReceiptConfirm.confirming ? 'destructive' : 'outline'
                }
                className={
                  deleteReceiptConfirm.confirming ? '' : 'text-destructive'
                }
                onClick={deleteReceiptConfirm.handleClick}
                disabled={deleteReceipt.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {deleteReceiptConfirm.confirming
                  ? 'Click again to delete'
                  : 'Delete receipt'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemEditRow({
  item,
  onChange,
  onDelete,
  isDeleting,
}: {
  item: EditableItem
  onChange: (patch: Partial<EditableItem>) => void
  onDelete: () => void
  isDeleting: boolean
}) {
  // Debounced so clearing "10" down to "" or a transient "0" while retyping
  // (e.g. correcting to "12") doesn't flash the warning mid-edit - only a
  // value the user has actually paused on gets flagged.
  const debouncedTotalPrice = useDebouncedValue(item.totalPrice, 400)
  const parsedDebouncedTotalPrice = Number(debouncedTotalPrice)
  // An empty field (Number('') === 0) isn't the same as an actual zero
  // price - don't flag it before the user has entered anything.
  const showReviewWarning =
    debouncedTotalPrice.trim() !== '' &&
    Number.isFinite(parsedDebouncedTotalPrice) &&
    parsedDebouncedTotalPrice <= 0

  const deleteConfirm = useClickToConfirm(onDelete)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`space-y-1 border-b pb-2 last:border-0 bg-background ${isDragging ? 'opacity-50 z-10 relative' : ''}`}
    >
      <div className="grid grid-cols-[auto_minmax(0,2fr)_3rem_3.5rem_3.5rem_4rem_auto] gap-1.5 items-end">
        <button
          type="button"
          className="flex items-center justify-center h-8 w-5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          aria-label={`Drag to reorder ${item.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Name</Label>
          <Input
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="text-xs"
          />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Qty</Label>
          <Input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            className="text-xs px-1.5"
          />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Price</Label>
          <Input
            type="number"
            step="0.01"
            value={item.totalPrice}
            onChange={(e) => onChange({ totalPrice: e.target.value })}
            className="text-xs px-1.5"
          />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Size</Label>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="1980"
            value={item.totalSize}
            onChange={(e) => onChange({ totalSize: e.target.value })}
            className="text-xs px-1.5"
          />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-muted-foreground">Unit</Label>
          <select
            value={item.sizeUnit}
            onChange={(e) =>
              onChange({
                sizeUnit: e.target.value as 'ml' | 'g' | 'count' | '',
              })
            }
            className="h-8 w-full rounded-none border border-input bg-transparent px-1 text-xs"
          >
            <option value="">—</option>
            <option value="ml">ml</option>
            <option value="g">g</option>
            <option value="count">count</option>
          </select>
        </div>
        <Button
          size={deleteConfirm.confirming ? 'sm' : 'icon-sm'}
          variant={deleteConfirm.confirming ? 'destructive' : 'ghost'}
          onClick={deleteConfirm.handleClick}
          disabled={isDeleting}
          aria-label={
            deleteConfirm.confirming
              ? `Click again to delete ${item.name}`
              : `Delete ${item.name}`
          }
        >
          <Trash2
            className={
              deleteConfirm.confirming
                ? 'h-3.5 w-3.5 mr-1'
                : 'h-3.5 w-3.5 text-destructive'
            }
          />
          {deleteConfirm.confirming && 'Confirm?'}
        </Button>
      </div>

      {showReviewWarning && (
        <p className="text-[10px] text-amber-600 pl-8">
          Zero or negative price - a refund/free item you likely want to delete,
          or a discount to net into the main item and delete this line.
        </p>
      )}
    </div>
  )
}

function NewItemRow({
  documentId,
  onAdded,
  onCancel,
}: {
  documentId: number
  onAdded: (item: ReceiptItemEntry) => void
  onCancel: () => void
}) {
  const createItem = useCreateReceiptItem()

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [totalPrice, setTotalPrice] = useState('')
  const [totalSize, setTotalSize] = useState('')
  const [sizeUnit, setSizeUnit] = useState<'ml' | 'g' | 'count' | ''>('')

  const handleAdd = () => {
    if (!name.trim()) {
      toast.error('Name cannot be empty')
      return
    }

    const parsedQuantity = Number(quantity)
    if (
      quantity.trim() === '' ||
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      toast.error('Quantity must be a positive number')
      return
    }

    const parsedTotalPrice =
      totalPrice.trim() === '' ? null : Number(totalPrice)
    if (parsedTotalPrice !== null && !Number.isFinite(parsedTotalPrice)) {
      toast.error('Price must be a number, or left blank if unknown')
      return
    }

    let sizeFields: {
      totalSize: number | null
      sizeUnit: 'ml' | 'g' | 'count' | null
    }
    if (totalSize.trim() === '') {
      sizeFields = { totalSize: null, sizeUnit: null }
    } else {
      const parsedTotalSize = Number(totalSize)
      if (!Number.isFinite(parsedTotalSize) || parsedTotalSize <= 0) {
        toast.error('Total size must be a positive number, or left blank')
        return
      }
      sizeFields = { totalSize: parsedTotalSize, sizeUnit: sizeUnit || null }
    }

    createItem.mutate(
      {
        documentId,
        itemName: name.trim(),
        quantity: parsedQuantity,
        totalPrice: parsedTotalPrice,
        ...sizeFields,
      },
      {
        onSuccess: (item) => {
          toast.success('Item added')
          onAdded(item)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <div className="space-y-1 border border-dashed p-2">
      <div className="grid grid-cols-[1fr_5rem_6rem_auto_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Almond Milk 1L"
            className="text-xs"
            autoFocus
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
        <Button size="sm" onClick={handleAdd} disabled={createItem.isPending}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="grid grid-cols-[6rem_6rem_1fr] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            Total size
          </Label>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 1980"
            value={totalSize}
            onChange={(e) => setTotalSize(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Unit</Label>
          <select
            value={sizeUnit}
            onChange={(e) =>
              setSizeUnit(e.target.value as 'ml' | 'g' | 'count' | '')
            }
            className="h-8 w-full rounded-none border border-input bg-transparent px-2.5 text-xs"
          >
            <option value="">—</option>
            <option value="ml">ml</option>
            <option value="g">g</option>
            <option value="count">count</option>
          </select>
        </div>
      </div>
    </div>
  )
}
