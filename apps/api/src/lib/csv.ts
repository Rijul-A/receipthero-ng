/** Escapes a single CSV field, quoting it if it contains a comma, quote, or newline. */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Builds a CSV string (with header row) from an array of objects. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: (keyof T & string)[],
): string {
  const header = columns.join(',')
  const lines = rows.map((row) => columns.map((col) => escapeCsvField(row[col])).join(','))
  return [header, ...lines].join('\r\n')
}
