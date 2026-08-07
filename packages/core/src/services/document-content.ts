// Our own delimiter between the freshly formatted receipt content and the
// original raw OCR/content preserved beneath it - also doubles as a marker
// so a reprocess can tell "this document's content is already our own
// prior formatted output" from "this is still Paperless's untouched
// original content".
const CONTENT_MARKER = '\n\n---\n\n### Raw OCR Text\n\n'

/**
 * Builds the new document content: the freshly formatted receipt, with the
 * *original* content preserved beneath it - never re-wrapping our own
 * prior output as if it were the original, which would otherwise nest
 * deeper and deeper on every reprocess (formatted1 -> formatted2 + "raw"
 * wrapping formatted1 -> ...). lastIndexOf finds the innermost marker, so
 * this self-heals a document that already accumulated several layers
 * before this fix shipped.
 */
export function buildDocumentContent(formattedContent: string, existingContent: string): string {
  const markerIndex = existingContent.lastIndexOf(CONTENT_MARKER)
  const original =
    markerIndex === -1
      ? existingContent
      : existingContent.slice(markerIndex + CONTENT_MARKER.length)

  return original ? `${formattedContent}${CONTENT_MARKER}${original}` : formattedContent
}
