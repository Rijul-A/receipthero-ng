import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Download,
  LineChart as LineChartIcon,
  Pencil,
  Search,
  Table2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LineChartSeries } from '@/components/charts/line-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RenameProductDialog } from '@/components/prices/rename-product-dialog'
import { LineChart } from '@/components/charts/line-chart'
import {
  useExportItemsCsv,
  useItemNameSearch,
  useItemPriceHistory,
} from '@/lib/queries'

export const Route = createFileRoute('/prices')({
  component: PricesPage,
})

export function formatPrice(
  cents: number | null,
  currency: string | null,
): string {
  if (cents === null) return '—'
  return `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim()
}

export function formatSize(row: {
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
 *
 * Requires a positive price: a discount/refund line (negative totalPrice)
 * that the AI happens to canonicalize under the same product would otherwise
 * always "win" the cheapest comparison by virtue of being negative, even
 * though it isn't a real purchase price to compare against.
 */
export function comparablePriceOf(row: {
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
    row.totalPrice > 0 &&
    row.sizeUnit
  ) {
    const per100 = (row.totalPrice / row.totalSize) * 100
    const label =
      row.sizeUnit === 'count' ? 'per 100' : `per 100${row.sizeUnit}`
    return { value: per100, label }
  }
  if (row.unitPrice !== null && row.unitPrice > 0) {
    return { value: row.unitPrice, label: 'per pack' }
  }
  if (row.totalPrice !== null && row.totalPrice > 0 && row.quantity > 0) {
    return { value: row.totalPrice / row.quantity, label: 'per pack' }
  }
  return null
}

// The selected names might genuinely be different products (e.g. you added
// both "Diet Coke" and "Sprite" just to browse them together, not because
// they're the same thing), and even within one product, rows can be
// mutually incomparable: a per-100ml price isn't comparable to a per-pack
// fallback price (no size info), and different currencies can't be compared
// as raw numbers without conversion. So "cheapest" is computed per
// (product, comparison label, currency) group, not as one global minimum —
// avoids silently declaring a winner across numbers that aren't actually
// on the same scale, or across different products entirely.
export function computeCheapestRowIds(
  history: Array<{
    id: number
    itemName: string
    canonicalName: string | null
    currency: string | null
    unitPrice: number | null
    totalPrice: number | null
    quantity: number
    totalSize: number | null
    sizeUnit: string | null
  }>,
): Set<number> {
  const groups = new Map<string, Array<{ id: number; value: number }>>()
  for (const row of history) {
    const comparable = comparablePriceOf(row)
    if (comparable === null) continue
    const product = row.canonicalName ?? row.itemName
    const key = `${product}|${comparable.label}|${row.currency ?? ''}`
    const group = groups.get(key) ?? []
    group.push({ id: row.id, value: comparable.value })
    groups.set(key, group)
  }

  const winners = new Set<number>()
  for (const group of groups.values()) {
    // Only worth highlighting a "winner" when there's more than one row to
    // compare it against within its group.
    if (group.length < 2) continue
    const best = group.reduce((a, b) => (b.value < a.value ? b : a))
    winners.add(best.id)
  }
  return winners
}

/**
 * Distinguishes locations of the same vendor (e.g. two Carrefour branches
 * that price differently) rather than collapsing them into one "Carrefour"
 * identity - the whole point of recording storeLocation in the first place.
 */
export function formatStoreLabel(row: {
  vendor: string | null
  storeLocation: string | null
}): string {
  const vendor = row.vendor ?? 'Unknown'
  return row.storeLocation ? `${vendor} — ${row.storeLocation}` : vendor
}

export interface StoreWinCount {
  store: string
  wins: number
}

/**
 * Tallies, per store (vendor + location, so two branches of the same chain
 * count separately), how many of the currently-compared products that store
 * came out cheapest on (per `computeCheapestRowIds`'s per-product/
 * per-currency/per-comparison-scale grouping). This only reflects the items
 * currently selected for comparison, not a full-history analysis - it
 * answers "of what I've compared here, who's winning" rather than "who's
 * cheapest overall".
 */
export function computeStoreWinCounts(
  history: Array<{
    id: number
    vendor: string | null
    storeLocation: string | null
  }>,
  cheapestRowIds: Set<number>,
): Array<StoreWinCount> {
  const counts = new Map<string, number>()
  for (const row of history) {
    if (!cheapestRowIds.has(row.id)) continue
    const store = formatStoreLabel(row)
    counts.set(store, (counts.get(store) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([store, wins]) => ({ store, wins }))
    .sort((a, b) => b.wins - a.wins)
}

/**
 * Orders history rows for display: grouped by product (so the same item's
 * purchases sit together regardless of what order the API returned them
 * in), then chronologically within each product so trends read left-to-right.
 */
export function sortHistoryRows<
  T extends {
    itemName: string
    canonicalName: string | null
    purchaseDate: string | null
  },
>(history: Array<T>): Array<T> {
  return [...history].sort((a, b) => {
    const productA = a.canonicalName ?? a.itemName
    const productB = b.canonicalName ?? b.itemName
    if (productA !== productB) return productA.localeCompare(productB)
    return (a.purchaseDate ?? '').localeCompare(b.purchaseDate ?? '')
  })
}

export interface PriceTrend {
  product: string
  currency: string
  /** The comparison basis these points share, e.g. "per 100ml" or "per pack". */
  label: string
  series: Array<LineChartSeries>
}

/**
 * One chart per (product, currency, comparison basis) - each with one line
 * series per store, so trends across differently-priced locations stay
 * visually distinct rather than being averaged together. Rows with no date
 * or no comparable price are dropped (can't be plotted).
 *
 * The comparison basis is part of the key for the same reason
 * computeCheapestRowIds groups by it: a per-100ml figure and a per-pack
 * fallback aren't on the same scale, so plotting them on one shared y-axis
 * would read as a huge price swing when it's really just a change of unit.
 */
export function buildPriceTrends(
  history: Array<{
    id: number
    itemName: string
    canonicalName: string | null
    vendor: string | null
    storeLocation: string | null
    currency: string | null
    unitPrice: number | null
    totalPrice: number | null
    quantity: number
    totalSize: number | null
    sizeUnit: string | null
    purchaseDate: string | null
  }>,
): Array<PriceTrend> {
  const groups = new Map<
    string,
    {
      product: string
      currency: string
      label: string
      byStore: Map<string, Array<{ x: number; y: number }>>
    }
  >()

  for (const row of history) {
    if (!row.purchaseDate) continue
    const comparable = comparablePriceOf(row)
    if (comparable === null) continue

    const product = row.canonicalName ?? row.itemName
    const currency = row.currency ?? ''
    const key = `${product}|${currency}|${comparable.label}`
    const entry = groups.get(key) ?? {
      product,
      currency,
      label: comparable.label,
      byStore: new Map<string, Array<{ x: number; y: number }>>(),
    }

    const store = formatStoreLabel(row)
    const points = entry.byStore.get(store) ?? []
    points.push({
      x: new Date(row.purchaseDate).getTime(),
      y: comparable.value,
    })
    entry.byStore.set(store, points)

    groups.set(key, entry)
  }

  return Array.from(groups.values()).map(
    ({ product, currency, label, byStore }) => ({
      product,
      currency,
      label,
      series: Array.from(byStore.entries()).map(([storeLabel, points]) => ({
        label: storeLabel,
        points,
      })),
    }),
  )
}

function PricesPage() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Array<string>>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'chart'>('table')

  const { data: matches } = useItemNameSearch(query)
  const { data: history, isLoading } = useItemPriceHistory(selected)
  const exportItemsCsv = useExportItemsCsv()

  const handleExport = () => {
    exportItemsCsv.mutate(undefined, {
      onError: (error) => toast.error(error.message),
    })
  }

  const cheapestRowIds = useMemo(
    () => computeCheapestRowIds(history ?? []),
    [history],
  )

  const sortedHistory = useMemo(() => {
    // Rows with no comparable price (refunds, free items, zero/negative
    // extraction misses) aren't useful for "which store is cheaper" - they
    // belong in the receipt breakdown (where they can actually be reviewed
    // and deleted), not cluttering this comparison table with a dash.
    const comparableRows = (history ?? []).filter(
      (row) => comparablePriceOf(row) !== null,
    )
    return sortHistoryRows(comparableRows)
  }, [history])

  const storeWinCounts = useMemo(
    () => computeStoreWinCounts(history ?? [], cheapestRowIds),
    [history, cheapestRowIds],
  )

  const priceTrends = useMemo(() => buildPriceTrends(history ?? []), [history])

  const addItem = (name: string) => {
    if (!selected.includes(name)) setSelected([...selected, name])
    setQuery('')
  }

  const removeItem = (name: string) => {
    setSelected(selected.filter((n) => n !== name))
  }

  const handleRenamed = (from: string, to: string) => {
    // Swap the selection over to the new name so the comparison view keeps
    // showing what's now under it, instead of an empty/stale "from" group.
    setSelected(selected.map((n) => (n === from ? to : n)))
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
                  <button
                    type="button"
                    onClick={() => setRenaming(name)}
                    aria-label={`Rename ${name}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
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

      {selected.length > 0 && storeWinCounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Cheapest Store
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Of the items you're comparing above, how often each store came out
              cheapest. Different locations of the same vendor are counted
              separately.
            </p>
            <div className="flex flex-wrap gap-2">
              {storeWinCounts.map(({ store, wins }, index) => (
                <Badge
                  key={store}
                  variant="outline"
                  className={
                    index === 0 ? 'text-green-600 border-green-600' : ''
                  }
                >
                  {store}: {wins} {wins === 1 ? 'item' : 'items'}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selected.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Price History
            </CardTitle>
            <div className="flex rounded-none border">
              <button
                type="button"
                className={`px-2.5 py-1 text-xs flex items-center gap-1.5 ${view === 'table' ? 'bg-accent font-medium' : ''}`}
                onClick={() => setView('table')}
              >
                <Table2 className="h-3 w-3" />
                Table
              </button>
              <button
                type="button"
                className={`px-2.5 py-1 text-xs border-l flex items-center gap-1.5 ${view === 'chart' ? 'bg-accent font-medium' : ''}`}
                onClick={() => setView('chart')}
              >
                <LineChartIcon className="h-3 w-3" />
                Chart
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : !history || history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No purchase history found for the selected item(s) yet.
              </p>
            ) : sortedHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All purchases of the selected item(s) are refunds/free/zero-
                priced lines with no comparable price. Review them from the
                receipt they came from.
              </p>
            ) : view === 'chart' ? (
              <div className="space-y-6">
                {priceTrends.map(({ product, currency, label, series }) => (
                  <div
                    key={`${product}|${currency}|${label}`}
                    className="space-y-2"
                  >
                    <h3 className="text-xs font-medium">
                      {product}{' '}
                      <span className="text-muted-foreground font-normal">
                        ({label}, {currency})
                      </span>
                    </h3>
                    <LineChart
                      series={series}
                      formatX={(x) => new Date(x).toLocaleDateString()}
                      formatY={(y) => formatPrice(y, currency)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Store</th>
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Size</th>
                      <th className="py-2 pr-4">Comparable Price</th>
                      <th className="py-2 pr-4">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistory.map((row) => {
                      const isCheapest = cheapestRowIds.has(row.id)
                      const comparable = comparablePriceOf(row)
                      return (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{row.itemName}</td>
                          <td className="py-2 pr-4">{formatStoreLabel(row)}</td>
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

      <RenameProductDialog
        from={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
        onRenamed={handleRenamed}
      />
    </div>
  )
}
