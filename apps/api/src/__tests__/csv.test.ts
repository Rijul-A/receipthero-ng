import { describe, it, expect } from 'bun:test'
import { toCsv } from '../lib/csv'

describe('toCsv', () => {
  it('produces a header row and one line per record', () => {
    const csv = toCsv([{ a: '1', b: '2' }], ['a', 'b'])
    expect(csv).toBe('a,b\r\n1,2')
  })

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ name: 'Diet Coke, 330ml', note: 'says "cold"' }], ['name', 'note'])
    expect(csv).toContain('"Diet Coke, 330ml"')
    expect(csv).toContain('"says ""cold"""')
  })

  it('neutralizes formula-injection trigger characters', () => {
    for (const trigger of ['=', '+', '-', '@']) {
      const csv = toCsv([{ name: `${trigger}cmd|'/c calc'!A1` }], ['name'])
      const cell = csv.split('\r\n')[1]
      // The dangerous leading character must not be the first character of
      // the actual field value once opened in a spreadsheet - it should be
      // prefixed so it's read as plain text, not a formula.
      expect(cell.startsWith(trigger)).toBe(false)
      expect(cell).toContain(`'${trigger}`)
    }
  })

  it('leaves normal negative numbers looking like text but safe (still not a formula)', () => {
    const csv = toCsv([{ amount: '-12.50' }], ['amount'])
    const cell = csv.split('\r\n')[1]
    expect(cell.startsWith('-')).toBe(false)
  })
})
