const CHART_COLORS = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
]

export interface BarChartDatum {
  label: string
  value: number
  formattedValue?: string
}

/**
 * Horizontal bar list - each bar's width is proportional to its value
 * relative to the largest value in the set. Simple, readable at any length,
 * and doesn't need SVG/canvas.
 */
export function BarChart({ data }: { data: Array<BarChartDatum> }) {
  // A bar's width is a proportion of the max, so a negative or zero value
  // (e.g. a vendor/category that's net-negative for the period - refunds
  // with no offsetting purchase) can't be represented as a bar at all; the
  // old width formula clamped negatives up to a visible 2%, which read as
  // "you spent a little here" when the truth was a net refund.
  const positive = data.filter((d) => d.value > 0)
  const max = Math.max(...positive.map((d) => d.value), 0)

  if (positive.length === 0 || max <= 0) {
    return <p className="text-xs text-muted-foreground">Nothing to show yet.</p>
  }

  return (
    <div className="space-y-2">
      {positive.map((d, index) => (
        <div key={d.label} className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="truncate pr-2">{d.label}</span>
            <span className="text-muted-foreground shrink-0">
              {d.formattedValue ?? d.value}
            </span>
          </div>
          <div className="h-2 w-full bg-muted">
            <div
              className={CHART_COLORS[index % CHART_COLORS.length]}
              style={{
                width: `${Math.max((d.value / max) * 100, 2)}%`,
                height: '100%',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
