import { describe, it, expect } from 'bun:test'
import { normalizeDateForPaperless } from '../services/date-format'

describe('normalizeDateForPaperless', () => {
  it('passes through an already-correct YYYY-MM-DD date', () => {
    expect(normalizeDateForPaperless('2017-07-28')).toBe('2017-07-28')
  })

  it('strips the time/timezone portion off an ISO datetime', () => {
    expect(normalizeDateForPaperless('2017-07-28T00:00:00')).toBe('2017-07-28')
    expect(normalizeDateForPaperless('2017-07-28T14:30:00.000Z')).toBe('2017-07-28')
  })

  it('zero-pads a non-padded YYYY-M-D date', () => {
    expect(normalizeDateForPaperless('2017-7-28')).toBe('2017-07-28')
    expect(normalizeDateForPaperless('2017-7-8')).toBe('2017-07-08')
  })

  it('returns undefined for null, undefined, or an empty/blank string', () => {
    expect(normalizeDateForPaperless(null)).toBeUndefined()
    expect(normalizeDateForPaperless(undefined)).toBeUndefined()
    expect(normalizeDateForPaperless('')).toBeUndefined()
    expect(normalizeDateForPaperless('   ')).toBeUndefined()
  })

  it('refuses to guess at an ambiguous DD-MM-YYYY/MM-DD-YYYY date rather than reordering it wrong', () => {
    expect(normalizeDateForPaperless('28-07-2017')).toBeUndefined()
    expect(normalizeDateForPaperless('07/28/2017')).toBeUndefined()
  })

  it('returns undefined for garbage input', () => {
    expect(normalizeDateForPaperless('not a date')).toBeUndefined()
    expect(normalizeDateForPaperless('July 28, 2017')).toBeUndefined()
  })
})
