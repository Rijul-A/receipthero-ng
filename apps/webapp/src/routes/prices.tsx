import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Download, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  useExportItemsCsv,
  useItemNameSearch,
  useItemPriceHistory,
} from '@/lib/queries'

export const Route = createFileRoute('/prices')({
  component: PricesPage,
})

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents === null) return '—'
  return `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim()
}

function formatSize(row: {
  totalSize: number | null
  sizeUnit: string | null
}): string {
  if (row.totalSize === null || !row.sizeUnit) return '—'
  if (row.sizeUnit === 'count') return `${row.totalSize}`
  return `${row.totalSize}${row.sizeUnit}`
}

/**
 * True comparable price, preferring price-per-100ml/100g (using the AI-
 * extracted total pack size) over the raw pack/quantity price, since two
 * differently-packaged versions of the same product (e.g. "330ml x6" vs
 * "150ml x15") aren't comparable by pack price alone.
 */
function comparablePriceOf(row: {
  unitPrice: number | null
  totalPrice: number | null
  quantity: number
  totalSize: number | null
  sizeUnit: string | null
}): { value: number; label: string } | null {
  if (
    row.totalSize !== null &&
    row.totalSize > 0 &&
    row.totalPrice !== null &&
    row.sizeUnit
  ) {
    const per100 = (row.totalPrice / row.totalSize) * 100
    const label =
      row.sizeUnit === 'count' ? 'per 100' : `per 100${row.sizeUnit}`
    return { value: per100, label }
  }
  if (row.unitPrice !== null) return { value: row.unitPrice, label: 'per pack' }
  if (row.totalPrice !== null && row.quantity > 0) {
    return { value: row.totalPrice / row.quantity, label: 'per pack' }
  }
  return null
}

function PricesPage() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Array<string>>([])

  const { data: matches } = useItemNameSearch(query)
  const { data: history, isLoading } = useItemPriceHistory(selected)
  const exportItemsCsv = useExportItemsCsv()

  const handleExport = () => {
    exportItemsCsv.mutate(undefined, {
      onError: (error) => toast.error(error.message),
    })
  }

  // You've explicitly grouped these names together (e.g. "Almarai Milk 1L" and
  // "Al Marai Fresh Milk 1L" from different stores, or "330ml x6" and "150ml
  // x15" packs of the same product), so the cheapest option is the single
  // minimum across the whole selection — compared by true unit price
  // (per 100ml/100g) where size is known, so differently-packaged versions
  // are ranked fairly rather than by raw pack price.
  const cheapestRowId = useMemo(() => {
    let bestId: number | null = null
    let bestPrice = Infinity
    for (const row of history ?? []) {
      const comparable = comparablePriceOf(row)
      if (comparable !== null && comparable.value < bestPrice) {
        bestPrice = comparable.value
        bestId = row.id
      }
    }
    return bestId
  }, [history])

  const addItem = (name: string) => {
    if (!selected.includes(name)) setSelected([...selected, name])
    setQuery('')
  }

  const removeItem = (name: string) => {
    setSelected(selected.filter((n) => n !== name))
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Price Comparison
          </h1>
          <p className="text-muted-foreground">
            Compare what you've paid for the same item across different stores
            over time.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exportItemsCsv.isPending}
        >
          <Download className="h-4 w-4 mr-2" />
          Export All CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Items to Compare
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search item names from your receipts (e.g. milk)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
            {query && matches && matches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-none border bg-popover shadow-md max-h-56 overflow-auto">
                {matches
                  .filter((name) => !selected.includes(name))
                  .map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-accent"
                      onClick={() => addItem(name)}
                    >
                      {name}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((name) => (
                <Badge key={name} variant="outline" className="gap-1">
                  {name}
                  <button type="button" onClick={() => removeItem(name)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {selected.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Search above and add one or more item names to see their price
              history across stores. Item names come from your already-processed
              receipts, so as you process more receipts, more items will show up
              here.
            </p>
          )}
        </CardContent>
      </Card>

      {selected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Price History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : !history || history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No purchase history found for the selected item(s) yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Vendor</th>
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Size</th>
                      <th className="py-2 pr-4">Comparable Price</th>
                      <th className="py-2 pr-4">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => {
                      const isCheapest = row.id === cheapestRowId
                      const comparable = comparablePriceOf(row)
                      return (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{row.itemName}</td>
                          <td className="py-2 pr-4">{row.vendor ?? '—'}</td>
                          <td className="py-2 pr-4">
                            {row.purchaseDate ?? '—'}
                          </td>
                          <td className="py-2 pr-4">{formatSize(row)}</td>
                          <td className="py-2 pr-4">
                            <span
                              className={
                                isCheapest ? 'text-green-600 font-medium' : ''
                              }
                            >
                              {comparable
                                ? `${formatPrice(comparable.value, row.currency)} (${comparable.label})`
                                : '—'}
                            </span>
                            {isCheapest && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-green-600"
                              >
                                Cheapest
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            {formatPrice(row.totalPrice, row.currency)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
