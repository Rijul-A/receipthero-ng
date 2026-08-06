import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useItemNameSearch, useItemPriceHistory } from '@/lib/queries'

export const Route = createFileRoute('/prices')({
  component: PricesPage,
})

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents === null) return '—'
  return `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim()
}

/** Effective per-unit price, preferring the stored unitPrice over totalPrice/quantity. */
function unitPriceOf(row: {
  unitPrice: number | null
  totalPrice: number | null
  quantity: number
}) {
  if (row.unitPrice !== null) return row.unitPrice
  if (row.totalPrice !== null && row.quantity > 0)
    return row.totalPrice / row.quantity
  return null
}

function PricesPage() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Array<string>>([])

  const { data: matches } = useItemNameSearch(query)
  const { data: history, isLoading } = useItemPriceHistory(selected)

  // You've explicitly grouped these names together (e.g. "Almarai Milk 1L" and
  // "Al Marai Fresh Milk 1L" from different stores), so the cheapest option is
  // the single minimum across the whole selection, compared per unit — not
  // per exact name, and not by raw total (which quantity would skew).
  const cheapestRowId = useMemo(() => {
    let bestId: number | null = null
    let bestUnitPrice = Infinity
    for (const row of history ?? []) {
      const unitPrice = unitPriceOf(row)
      if (unitPrice !== null && unitPrice < bestUnitPrice) {
        bestUnitPrice = unitPrice
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
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Price Comparison</h1>
        <p className="text-muted-foreground">
          Compare what you've paid for the same item across different stores
          over time.
        </p>
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
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Unit Price</th>
                      <th className="py-2 pr-4">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => {
                      const isCheapest = row.id === cheapestRowId
                      return (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{row.itemName}</td>
                          <td className="py-2 pr-4">{row.vendor ?? '—'}</td>
                          <td className="py-2 pr-4">
                            {row.purchaseDate ?? '—'}
                          </td>
                          <td className="py-2 pr-4">{row.quantity}</td>
                          <td className="py-2 pr-4">
                            <span
                              className={
                                isCheapest ? 'text-green-600 font-medium' : ''
                              }
                            >
                              {formatPrice(unitPriceOf(row), row.currency)}
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
