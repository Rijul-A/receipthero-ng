import { describe, it, expect } from 'bun:test'
import { buildDocumentContent } from '../services/document-content'

describe('buildDocumentContent', () => {
  it('preserves genuinely untouched Paperless OCR text beneath the formatted receipt on first processing', () => {
    const result = buildDocumentContent('### FORMATTED', 'raw paperless ocr text')

    expect(result).toBe('### FORMATTED\n\n---\n\n### Raw OCR Text\n\nraw paperless ocr text')
  })

  it('replaces the prior formatted block on reprocess instead of nesting it as "raw OCR"', () => {
    const afterFirstRun = buildDocumentContent('### FORMATTED v1', 'raw paperless ocr text')

    const afterReprocess = buildDocumentContent('### FORMATTED v2', afterFirstRun)

    expect(afterReprocess).toBe(
      '### FORMATTED v2\n\n---\n\n### Raw OCR Text\n\nraw paperless ocr text',
    )
    // The stale v1 formatted block must not survive inside the new content.
    expect(afterReprocess).not.toContain('FORMATTED v1')
  })

  it('self-heals a document that already accumulated several nested layers before this fix', () => {
    const corrupted =
      '### FORMATTED v3\n\n---\n\n### Raw OCR Text\n\n### FORMATTED v2\n\n---\n\n### Raw OCR Text\n\n### FORMATTED v1\n\n---\n\n### Raw OCR Text\n\nraw paperless ocr text'

    const result = buildDocumentContent('### FORMATTED v4', corrupted)

    expect(result).toBe('### FORMATTED v4\n\n---\n\n### Raw OCR Text\n\nraw paperless ocr text')
  })

  it('returns just the formatted content when there is no existing content at all', () => {
    expect(buildDocumentContent('### FORMATTED', '')).toBe('### FORMATTED')
  })
})
