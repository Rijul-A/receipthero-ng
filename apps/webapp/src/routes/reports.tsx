import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { DateRangeValue } from '@/components/date-range-picker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DateRangePicker,
  EMPTY_DATE_RANGE,
  toDateRangeParams,
} from '@/components/date-range-picker'
import { useExportSpendingReportCsv, useSpendingReport } from '@/lib/queries'

export const Route = createFileRoute('/reports')({
  component: ReportsPage,
})

function formatTotal(total: number, currency: string): string {
  return `${total.toFixed(2)} ${currency}`
}

function ReportsPage() {
  const [groupBy, setGroupBy] = useState<'week' | 'month'>('month')
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE)
  const { data: rows, isLoading } = useSpendingReport(
    groupBy,
    toDateRangeParams(dateRange),
  )
  const exportCsv = useExportSpendingReportCsv()

  const handleExport = () => {
    exportCsv.mutate(
      { groupBy, dateRange: toDateRangeParams(dateRange) },
      { onError: (error) => toast.error(error.message) },
    )
  }

  // Per-period, per-currency subtotal (summed across categories) — shown as
  // a header row for each period group. Never summed across currencies,
  // same reasoning as the price-comparison feature: raw numbers in
  // different currencies aren't directly comparable without conversion.
  const periodTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of rows ?? []) {
      const key = `${row.period}|${row.currency}`
      totals.set(key, (totals.get(key) ?? 0) + row.total)
    }
    return totals
  }, [rows])

  const periods = useMemo(() => {
    const seen = new Set<string>()
    const ordered: Array<string> = []
    for (const row of rows ?? []) {
      if (!seen.has(row.period)) {
        seen.add(row.period)
        ordered.push(row.period)
      }
    }
    return ordered
  }, [rows])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Spending Reports
          </h1>
          <p className="text-muted-foreground">
            Spend from successfully processed receipts, grouped by week or
            month.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <div className="flex rounded-none border">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs ${groupBy === 'week' ? 'bg-accent font-medium' : ''}`}
              onClick={() => setGroupBy('week')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs border-l ${groupBy === 'month' ? 'bg-accent font-medium' : ''}`}
              onClick={() => setGroupBy('month')}
            >
              Monthly
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exportCsv.isPending}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {groupBy === 'week' ? 'Weekly' : 'Monthly'} Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : !rows || rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No processed receipts with a usable date yet.
            </p>
          ) : (
            <div className="overflow-x-auto space-y-6">
              {periods.map((period) => {
                const periodRows = rows.filter((r) => r.period === period)
                const currencies = Array.from(
                  new Set(periodRows.map((r) => r.currency)),
                )
                return (
                  <div key={period}>
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="text-sm font-semibold">{period}</h3>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {currencies.map((currency) => (
                          <span key={currency}>
                            {formatTotal(
                              periodTotals.get(`${period}|${currency}`) ?? 0,
                              currency,
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-4">Category</th>
                          <th className="py-2 pr-4">Currency</th>
                          <th className="py-2 pr-4">Total</th>
                          <th className="py-2 pr-4">Receipts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodRows
                          .sort((a, b) => b.total - a.total)
                          .map((row) => (
                            <tr
                              key={`${row.period}-${row.currency}-${row.category}`}
                              className="border-b last:border-0"
                            >
                              <td className="py-2 pr-4">{row.category}</td>
                              <td className="py-2 pr-4">{row.currency}</td>
                              <td className="py-2 pr-4">
                                {formatTotal(row.total, row.currency)}
                              </td>
                              <td className="py-2 pr-4">{row.count}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
