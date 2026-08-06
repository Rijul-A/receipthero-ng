const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

export interface LineChartPoint {
  x: number // e.g. a timestamp - points are positioned by actual value, not index, so unaligned series still line up correctly
  y: number
}

export interface LineChartSeries {
  label: string
  points: Array<LineChartPoint>
}

const VIEW_WIDTH = 600
const VIEW_HEIGHT = 200
const PADDING = 8

/**
 * Multi-series line chart via a plain SVG polyline per series, positioned by
 * actual x/y value (not categorical index) so series with different point
 * counts/dates - e.g. purchases at different stores on different days -
 * still align correctly against a shared axis instead of just being
 * side-by-side.
 */
export function LineChart({
  series,
  formatX,
  formatY,
}: {
  series: Array<LineChartSeries>
  formatX?: (x: number) => string
  formatY?: (y: number) => string
}) {
  const allPoints = series.flatMap((s) => s.points)
  if (allPoints.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing to show yet.</p>
  }

  const xs = allPoints.map((p) => p.x)
  const ys = allPoints.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(0, ...ys)
  const maxY = Math.max(...ys)

  const scaleX = (x: number) =>
    maxX === minX
      ? VIEW_WIDTH / 2
      : PADDING + ((x - minX) / (maxX - minX)) * (VIEW_WIDTH - PADDING * 2)
  const scaleY = (y: number) =>
    maxY === minY
      ? VIEW_HEIGHT / 2
      : VIEW_HEIGHT -
        PADDING -
        ((y - minY) / (maxY - minY)) * (VIEW_HEIGHT - PADDING * 2)

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        {series.map((s, index) => {
          const sorted = [...s.points].sort((a, b) => a.x - b.x)
          const path = sorted
            .map((p) => `${scaleX(p.x)},${scaleY(p.y)}`)
            .join(' ')
          const color = CHART_COLORS[index % CHART_COLORS.length]
          return (
            <g key={s.label}>
              <polyline
                points={path}
                fill="none"
                stroke={color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              {sorted.map((p, i) => (
                <circle
                  key={i}
                  cx={scaleX(p.x)}
                  cy={scaleY(p.y)}
                  r={2.5}
                  fill={color}
                />
              ))}
            </g>
          )
        })}
      </svg>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatX ? formatX(minX) : minX}</span>
        <span>{formatX ? formatX(maxX) : maxX}</span>
      </div>

      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {series.map((s, index) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="size-2.5 shrink-0"
                style={{
                  backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
              {s.label}
            </div>
          ))}
        </div>
      )}

      {formatY && (
        <p className="text-[10px] text-muted-foreground">
          Range: {formatY(minY)} - {formatY(maxY)}
        </p>
      )}
    </div>
  )
}
