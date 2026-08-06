// Leading characters that spreadsheet apps (Excel, Sheets) interpret as the
// start of a formula. Field values here ultimately come from OCR'd receipt
// text - untrusted input - so a field starting with one of these would run
// as a formula for anyone who opens the exported CSV.
const FORMULA_TRIGGER_CHARS = /^[=+\-@]/

/** Escapes a single CSV field: quotes commas/quotes/newlines, neutralizes formula injection. */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  let str = String(value)
  if (FORMULA_TRIGGER_CHARS.test(str)) {
    str = `'${str}`
  }
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
