import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import type {
  ItemFrequency,
  SpendingReportRow,
  VendorSpend,
} from '@/lib/server'
import type { BarChartDatum } from '@/components/charts/bar-chart'
import type { DonutChartDatum } from '@/components/charts/donut-chart'
import type { LineChartSeries } from '@/components/charts/line-chart'
import type { DateRangeValue } from '@/components/date-range-picker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart } from '@/components/charts/bar-chart'
import { DonutChart } from '@/components/charts/donut-chart'
import { LineChart } from '@/components/charts/line-chart'
import { RenameVendorDialog } from '@/components/analytics/rename-vendor-dialog'
import {
  DateRangePicker,
  EMPTY_DATE_RANGE,
  toDateRangeParams,
} from '@/components/date-range-picker'
import {
  useItemFrequencyReport,
  useSpendingReport,
  useVendorSpendReport,
} from '@/lib/queries'

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
})

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`
}

/**
 * A spending-report period -> a real timestamp, so the line chart can
 * position points by actual time rather than array index. Handles both
 * shapes the report can produce: "YYYY-MM" (month) and "YYYY-MM-DD" (week
 * start), so switching groupBy can't silently collapse every week in a
 * month onto the same x-position.
 */
function periodToTimestamp(period: string): number {
  const [year, month, day] = period.split('-').map(Number)
  return Date.UTC(year, month - 1, day || 1)
}

/**
 * One line-chart series per currency (never summed together - same
 * reasoning as everywhere else spend gets aggregated), each point being
 * that period's total across all categories.
 */
export function buildSpendOverTimeSeries(
  rows: Array<SpendingReportRow>,
): Array<{ currency: string; series: LineChartSeries }> {
  const byCurrency = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const periods = byCurrency.get(row.currency) ?? new Map<string, number>()
    periods.set(row.period, (periods.get(row.period) ?? 0) + row.total)
    byCurrency.set(row.currency, periods)
  }

  return Array.from(byCurrency.entries()).map(([currency, periods]) => ({
    currency,
    series: {
      label: currency,
      points: Array.from(periods.entries()).map(([period, total]) => ({
        x: periodToTimestamp(period),
        y: total,
      })),
    },
  }))
}

/** One donut per currency, summing every period's rows into an all-time category breakdown. */
export function buildCategoryBreakdown(
  rows: Array<SpendingReportRow>,
): Array<{ currency: string; data: Array<DonutChartDatum> }> {
  const byCurrency = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const categories = byCurrency.get(row.currency) ?? new Map<string, number>()
    categories.set(
      row.category,
      (categories.get(row.category) ?? 0) + row.total,
    )
    byCurrency.set(row.currency, categories)
  }

  return Array.from(byCurrency.entries()).map(([currency, categories]) => ({
    currency,
    data: Array.from(categories.entries())
      .map(([label, value]) => ({
        label,
        value,
        formattedValue: formatMoney(value, currency),
      }))
      .sort((a, b) => b.value - a.value),
  }))
}

/**
 * Distinguishes locations of the same vendor (e.g. two Carrefour branches)
 * rather than collapsing them into one bar - same reasoning as
 * formatStoreLabel on the Prices page.
 */
function formatStoreLabel(row: {
  vendor: string
  storeLocation: string | null
}): string {
  return row.storeLocation ? `${row.vendor} — ${row.storeLocation}` : row.vendor
}

/** One bar chart per currency, per-store totals sorted descending. */
export function buildVendorBarData(
  rows: Array<VendorSpend>,
): Array<{ currency: string; data: Array<BarChartDatum> }> {
  const byCurrency = new Map<string, Array<VendorSpend>>()
  for (const row of rows) {
    const list = byCurrency.get(row.currency) ?? []
    list.push(row)
    byCurrency.set(row.currency, list)
  }

  return Array.from(byCurrency.entries()).map(([currency, vendorRows]) => ({
    currency,
    data: vendorRows
      .slice()
      .sort((a, b) => b.total - a.total)
      .map((row) => ({
        label: formatStoreLabel(row),
        value: row.total,
        formattedValue: formatMoney(row.total, currency),
      })),
  }))
}

/**
 * Distinct vendor names (not vendor+location - the rename tool corrects the
 * vendor name itself, applying across every branch/location it appears
 * under), sorted alphabetically for a stable list.
 */
export function distinctVendorNames(rows: Array<VendorSpend>): Array<string> {
  return Array.from(new Set(rows.map((row) => row.vendor))).sort((a, b) =>
    a.localeCompare(b),
  )
}

/** "bought 5 times, roughly every 12 days" - derived from first/last purchase and count, not stored. */
export function formatPurchaseFrequency(item: ItemFrequency): string {
  if (item.purchaseCount <= 1) return `${item.purchaseCount} purchase`
  if (
    !item.firstPurchase ||
    !item.lastPurchase ||
    item.firstPurchase === item.lastPurchase
  ) {
    return `${item.purchaseCount} purchases`
  }
  const days =
    (new Date(item.lastPurchase).getTime() -
      new Date(item.firstPurchase).getTime()) /
    (1000 * 60 * 60 * 24)
  const avgDays = Math.round(days / (item.purchaseCount - 1))
  return `${item.purchaseCount} purchases, ~every ${avgDays} day${avgDays === 1 ? '' : 's'}`
}

function AnalyticsPage() {
  const [groupBy, setGroupBy] = useState<'week' | 'month'>('month')
  const [renamingVendor, setRenamingVendor] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)
  const dateRangeParams = toDateRangeParams(dateRange)
  const { data: spendingRows, isLoading: spendingLoading } = useSpendingReport(
    groupBy,
    dateRangeParams,
  )
  const { data: vendorRows, isLoading: vendorLoading } =
    useVendorSpendReport(dateRangeParams)
  const { data: itemRows, isLoading: itemsLoading } = useItemFrequencyReport(
    15,
    dateRangeParams,
  )

  const spendOverTime = useMemo(
    () => buildSpendOverTimeSeries(spendingRows ?? []),
    [spendingRows],
  )
  const categoryBreakdown = useMemo(
    () => buildCategoryBreakdown(spendingRows ?? []),
    [spendingRows],
  )
  const vendorBars = useMemo(
    () => buildVendorBarData(vendorRows ?? []),
    [vendorRows],
  )
  const vendorNames = useMemo(
    () => distinctVendorNames(vendorRows ?? []),
    [vendorRows],
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Spending patterns across everything you've processed.
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Spend Over Time
          </CardTitle>
          <div className="flex rounded-none border">
            <button
              type="button"
              className={`px-3 py-1 text-xs ${groupBy === 'week' ? 'bg-accent font-medium' : ''}`}
              onClick={() => setGroupBy('week')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`px-3 py-1 text-xs border-l ${groupBy === 'month' ? 'bg-accent font-medium' : ''}`}
              onClick={() => setGroupBy('month')}
            >
              Monthly
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {spendingLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : spendOverTime.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No processed receipts with a usable date yet.
            </p>
          ) : (
            spendOverTime.map(({ currency, series }) => (
              <div key={currency} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {currency}
                </h3>
                <LineChart
                  series={[series]}
                  formatX={(x) =>
                    new Date(x).toLocaleDateString(
                      undefined,
                      groupBy === 'week'
                        ? { day: 'numeric', month: 'short', year: 'numeric' }
                        : { month: 'short', year: 'numeric' },
                    )
                  }
                  formatY={(y) => formatMoney(y, currency)}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Spend by Category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {spendingLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : categoryBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing to show yet.
              </p>
            ) : (
              categoryBreakdown.map(({ currency, data }) => (
                <div key={currency} className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {currency}
                  </h3>
                  <DonutChart data={data} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Spend by Store
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {vendorLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : vendorBars.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing to show yet.
              </p>
            ) : (
              vendorBars.map(({ currency, data }) => (
                <div key={currency} className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {currency}
                  </h3>
                  <BarChart data={data} />
                </div>
              ))
            )}
            {vendorNames.length > 0 && (
              <div className="space-y-1.5 border-t pt-3">
                <p className="text-[10px] text-muted-foreground">
                  Vendor extracted wrong? Rename it everywhere it appears:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {vendorNames.map((vendor) => (
                    <Badge
                      key={vendor}
                      variant="outline"
                      className="gap-1 cursor-pointer"
                      onClick={() => setRenamingVendor(vendor)}
                    >
                      {vendor}
                      <Pencil className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Top Items - Spend &amp; Frequency
          </CardTitle>
        </CardHeader>
        <CardContent>
          {itemsLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : !itemRows || itemRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No recorded line items yet - process a few more receipts.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Total Spent</th>
                    <th className="py-2 pr-4">Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map((item) => (
                    <tr
                      key={`${item.name}-${item.currency}`}
                      className="border-b last:border-0"
                    >
                      <td className="py-2 pr-4">{item.name}</td>
                      <td className="py-2 pr-4">
                        {formatMoney(item.totalSpent, item.currency)}
                      </td>
                      <td className="py-2 pr-4">
                        {formatPurchaseFrequency(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <RenameVendorDialog
        from={renamingVendor}
        onOpenChange={(open) => {
          if (!open) setRenamingVendor(null)
        }}
        onRenamed={() => setRenamingVendor(null)}
      />
    </div>
  )
}
