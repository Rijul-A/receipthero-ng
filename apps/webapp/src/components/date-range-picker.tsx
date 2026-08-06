import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export interface DateRangeValue {
  startDate: string // '' means unset
  endDate: string
}

export const EMPTY_DATE_RANGE: DateRangeValue = { startDate: '', endDate: '' }

/** Converts a picker's '' (unset) fields into the undefined the server functions expect. */
export function toDateRangeParams(value: DateRangeValue): {
  startDate?: string
  endDate?: string
} {
  return {
    startDate: value.startDate || undefined,
    endDate: value.endDate || undefined,
  }
}

/**
 * Two optional date bounds (inclusive), both start empty ("all time").
 * Deliberately not scoped to the Prices page - per-item price history is
 * usually wanted across all time to catch long-run trends, unlike spend
 * reporting where a specific period is the common case.
 */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
}) {
  const hasRange = value.startDate || value.endDate

  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={value.startDate}
        onChange={(e) => onChange({ ...value, startDate: e.target.value })}
        className="w-36"
        aria-label="Start date"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="date"
        value={value.endDate}
        onChange={(e) => onChange({ ...value, endDate: e.target.value })}
        className="w-36"
        aria-label="End date"
      />
      {hasRange && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(EMPTY_DATE_RANGE)}
        >
          Clear
        </Button>
      )}
    </div>
  )
}
