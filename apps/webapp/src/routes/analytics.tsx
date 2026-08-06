import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type {
  ItemFrequency,
  SpendingReportRow,
  VendorSpend,
} from '@/lib/server'
import type { BarChartDatum } from '@/components/charts/bar-chart'
import type { DonutChartDatum } from '@/components/charts/donut-chart'
import type { LineChartSeries } from '@/components/charts/line-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from '@/components/charts/bar-chart'
import { DonutChart } from '@/components/charts/donut-chart'
import { LineChart } from '@/components/charts/line-chart'
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

/** "YYYY-MM" -> a real timestamp, so the line chart can position points by actual time rather than array index. */
function monthToTimestamp(period: string): number {
  const [year, month] = period.split('-').map(Number)
  return Date.UTC(year, month - 1, 1)
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
        x: monthToTimestamp(period),
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

/** One bar chart per currency, vendor totals sorted descending. */
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
        label: row.vendor,
        value: row.total,
        formattedValue: formatMoney(row.total, currency),
      })),
  }))
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
  const [groupBy] = useState<'week' | 'month'>('month')
  const { data: spendingRows, isLoading: spendingLoading } =
    useSpendingReport(groupBy)
  const { data: vendorRows, isLoading: vendorLoading } = useVendorSpendReport()
  const { data: itemRows, isLoading: itemsLoading } = useItemFrequencyReport(15)

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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">
          Spending patterns across everything you've processed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Spend Over Time (Monthly)
          </CardTitle>
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
                    new Date(x).toLocaleDateString(undefined, {
                      month: 'short',
                      year: 'numeric',
                    })
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
    </div>
  )
}
