/**
 * Normalizes an AI-extracted date string to Paperless-NGX's required
 * YYYY-MM-DD format, or returns undefined if it can't be normalized with
 * confidence. The AI is only ever *asked* (via prompt) to return
 * YYYY-MM-DD - nothing enforces it downstream, and smaller/local models
 * drift from that instruction. Paperless rejects the entire document
 * update (not just the date) if `created` isn't exactly that format, so
 * this exists to catch the common near-misses before they reach Paperless.
 *
 * Deliberately conservative: only handles cases where the intended date is
 * unambiguous (already correct, needs zero-padding, or has a time/zone
 * suffix to strip) - never guesses at reordering day/month for something
 * like "28-07-2017", since a wrong guess is worse than sending nothing.
 */
export function normalizeDateForPaperless(date: string | null | undefined): string | undefined {
  if (!date) return undefined
  const trimmed = date.trim()

  // Already correct.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // ISO datetime (with or without time/timezone) - keep the date portion.
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/)
  if (isoMatch) return isoMatch[1]

  // Non-zero-padded YYYY-M-D - unambiguous, just needs padding.
  const paddedMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (paddedMatch) {
    const [, year, month, day] = paddedMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  return undefined
}
