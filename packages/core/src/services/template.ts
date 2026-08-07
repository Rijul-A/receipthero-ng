/**
 * Simple template interpolator, e.g. "{vendor} - {amount}" -> "Carrefour - 98.21".
 * Leaves `{key}` untouched verbatim if `data` has no matching field.
 */
export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/{(\w+)}/g, (match, key) => {
    return String(data[key] ?? match)
  })
}
