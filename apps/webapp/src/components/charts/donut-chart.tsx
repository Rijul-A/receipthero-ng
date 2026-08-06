const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

export interface DonutChartDatum {
  label: string
  value: number
  formattedValue?: string
}

/**
 * A donut chart built from a single conic-gradient background - no SVG arc
 * math needed. Slices beyond the palette size cycle the colors, which is
 * fine since this is meant for a handful of categories, not dozens.
 */
export function DonutChart({ data }: { data: Array<DonutChartDatum> }) {
  // A slice's arc is a proportion of the total, so a negative value (e.g. a
  // category that's net-negative for the period - refunds with no
  // offsetting purchase) can't be represented as a slice: it would make the
  // running angle go backwards, producing an invalid conic-gradient stop
  // and throwing off every slice after it too.
  const positive = data.filter((d) => d.value > 0)
  const total = positive.reduce((sum, d) => sum + d.value, 0)

  if (positive.length === 0 || total <= 0) {
    return <p className="text-xs text-muted-foreground">Nothing to show yet.</p>
  }

  let cumulative = 0
  const stops = positive.map((d, index) => {
    const start = (cumulative / total) * 360
    cumulative += d.value
    const end = (cumulative / total) * 360
    const color = CHART_COLORS[index % CHART_COLORS.length]
    return `${color} ${start}deg ${end}deg`
  })

  return (
    <div className="flex items-center gap-6">
      <div
        className="size-32 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
      />
      <ul className="space-y-1.5 text-xs">
        {positive.map((d, index) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0"
              style={{
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
            <span className="truncate">{d.label}</span>
            <span className="text-muted-foreground shrink-0">
              {d.formattedValue ?? d.value} (
              {((d.value / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
