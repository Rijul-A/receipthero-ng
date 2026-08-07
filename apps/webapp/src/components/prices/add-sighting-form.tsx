import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreatePriceSighting } from '@/lib/queries'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Records a price seen but not purchased - e.g. spotting a pack of drinks
 * at a store without buying it. Every field is entered directly (there's no
 * receipt/document to inherit vendor/currency/date from, unlike adding a
 * missed line item to an existing receipt).
 */
export function AddSightingForm({
  onAdded,
}: {
  onAdded: (itemName: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [itemName, setItemName] = useState('')
  const [vendor, setVendor] = useState('')
  const [storeLocation, setStoreLocation] = useState('')
  const [currency, setCurrency] = useState('')
  const [totalPrice, setTotalPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [totalSize, setTotalSize] = useState('')
  const [sizeUnit, setSizeUnit] = useState<'ml' | 'g' | 'count' | ''>('')
  const [purchaseDate, setPurchaseDate] = useState(today)
  const [purchaseTime, setPurchaseTime] = useState('')

  const createSighting = useCreatePriceSighting()

  const reset = () => {
    setItemName('')
    setVendor('')
    setStoreLocation('')
    setCurrency('')
    setTotalPrice('')
    setQuantity('1')
    setTotalSize('')
    setSizeUnit('')
    setPurchaseDate(today())
    setPurchaseTime('')
  }

  const handleSubmit = () => {
    if (!itemName.trim()) {
      toast.error('Item name cannot be empty')
      return
    }
    if (!vendor.trim()) {
      toast.error('Store name cannot be empty')
      return
    }
    if (!currency.trim()) {
      toast.error('Currency cannot be empty')
      return
    }
    if (!purchaseDate.trim()) {
      toast.error('Date cannot be empty')
      return
    }

    const parsedQuantity = Number(quantity)
    if (
      quantity.trim() !== '' &&
      (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)
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

    createSighting.mutate(
      {
        itemName: itemName.trim(),
        vendor: vendor.trim(),
        storeLocation: storeLocation.trim() || undefined,
        currency: currency.trim().toUpperCase(),
        totalPrice: parsedTotalPrice,
        quantity: parsedQuantity,
        ...sizeFields,
        purchaseDate,
        purchaseTime: purchaseTime.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success('Price recorded')
          onAdded(itemName.trim())
          reset()
          setOpen(false)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Record a price you saw
      </Button>
    )
  }

  return (
    <div className="space-y-3 border border-dashed p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          For a price you saw but didn't buy - e.g. spotted a pack of drinks at
          a store you were browsing.
        </p>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="sighting-item">Item</Label>
          <Input
            id="sighting-item"
            placeholder="e.g. Diet Coke 6x330ml"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-vendor">Store name</Label>
          <Input
            id="sighting-vendor"
            placeholder="e.g. Carrefour"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-location">Store location (optional)</Label>
          <Input
            id="sighting-location"
            placeholder="e.g. DIFC"
            value={storeLocation}
            onChange={(e) => setStoreLocation(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-currency">Currency</Label>
          <Input
            id="sighting-currency"
            placeholder="e.g. AED"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-price">Price</Label>
          <Input
            id="sighting-price"
            type="number"
            step="0.01"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-qty">Qty</Label>
          <Input
            id="sighting-qty"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-size">Total size (optional)</Label>
          <Input
            id="sighting-size"
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 1980"
            value={totalSize}
            onChange={(e) => setTotalSize(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-unit">Unit</Label>
          <select
            id="sighting-unit"
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
        <div className="space-y-1">
          <Label htmlFor="sighting-date">Date</Label>
          <Input
            id="sighting-date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sighting-time">Time (optional)</Label>
          <Input
            id="sighting-time"
            type="time"
            value={purchaseTime}
            onChange={(e) => setPurchaseTime(e.target.value)}
          />
        </div>
      </div>

      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={createSighting.isPending}
      >
        {createSighting.isPending ? 'Saving...' : 'Save'}
      </Button>
    </div>
  )
}
