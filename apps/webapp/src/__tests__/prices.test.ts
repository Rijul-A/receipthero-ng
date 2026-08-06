import { describe, expect, it } from 'vitest'
import {
  comparablePriceOf,
  computeCheapestRowIds,
  computeVendorWinCounts,
  sortHistoryRows,
} from '../routes/prices'

interface Row {
  id: number
  itemName: string
  canonicalName: string | null
  vendor: string | null
  purchaseDate: string | null
  currency: string | null
  unitPrice: number | null
  totalPrice: number | null
  quantity: number
  totalSize: number | null
  sizeUnit: string | null
}

function row(overrides: Partial<Row> & { id: number }): Row {
  return {
    itemName: 'Item',
    canonicalName: null,
    vendor: null,
    purchaseDate: null,
    currency: 'AED',
    unitPrice: null,
    totalPrice: null,
    quantity: 1,
    totalSize: null,
    sizeUnit: null,
    ...overrides,
  }
}

describe('comparablePriceOf', () => {
  it('computes price per 100ml when size is known', () => {
    // 6x330ml = 1980ml pack for 1200 cents
    const result = comparablePriceOf(
      row({ id: 1, totalPrice: 1200, totalSize: 1980, sizeUnit: 'ml' }),
    )
    expect(result).not.toBeNull()
    expect(result!.value).toBeCloseTo((1200 / 1980) * 100)
    expect(result!.label).toBe('per 100ml')
  })

  it('falls back to per-pack price when size is unknown', () => {
    const result = comparablePriceOf(
      row({ id: 1, totalPrice: 500, quantity: 2 }),
    )
    expect(result).toEqual({ value: 250, label: 'per pack' })
  })

  it('excludes negative (discount/refund) prices entirely', () => {
    expect(
      comparablePriceOf(
        row({ id: 1, totalPrice: -200, totalSize: 1000, sizeUnit: 'ml' }),
      ),
    ).toBeNull()
    expect(
      comparablePriceOf(row({ id: 1, totalPrice: -200, quantity: 1 })),
    ).toBeNull()
    expect(comparablePriceOf(row({ id: 1, unitPrice: -50 }))).toBeNull()
  })

  it('treats zero size as unknown (avoids divide-by-zero) and falls back to per-pack', () => {
    expect(
      comparablePriceOf(
        row({ id: 1, totalPrice: 100, totalSize: 0, sizeUnit: 'ml' }),
      ),
    ).toEqual({ value: 100, label: 'per pack' })
  })
})

describe('computeCheapestRowIds', () => {
  it('ranks differently-packaged versions of the same product by unit price, not pack price', () => {
    // 6x330ml=1980ml for 1200 -> 60.6/100ml
    const sixPack = row({
      id: 1,
      canonicalName: 'Diet Coke',
      totalPrice: 1200,
      totalSize: 1980,
      sizeUnit: 'ml',
    })
    // 15x150ml=2250ml for 1000 -> 44.4/100ml (actually cheaper per volume
    // despite a lower absolute price too, but the point is it's compared
    // correctly rather than by raw pack price)
    const fifteenPack = row({
      id: 2,
      canonicalName: 'Diet Coke',
      totalPrice: 2000,
      totalSize: 2250,
      sizeUnit: 'ml',
    })

    const winners = computeCheapestRowIds([sixPack, fifteenPack])
    expect(winners).toEqual(new Set([1]))
  })

  it('does not crown a winner across different products', () => {
    const coke = row({
      id: 1,
      canonicalName: 'Diet Coke',
      totalPrice: 100,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const sprite = row({
      id: 2,
      canonicalName: 'Sprite',
      totalPrice: 50,
      totalSize: 1000,
      sizeUnit: 'ml',
    })

    expect(computeCheapestRowIds([coke, sprite])).toEqual(new Set())
  })

  it('does not mix currencies in the ranking', () => {
    const aed = row({
      id: 1,
      canonicalName: 'Diet Coke',
      currency: 'AED',
      totalPrice: 500,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const usd = row({
      id: 2,
      canonicalName: 'Diet Coke',
      currency: 'USD',
      totalPrice: 100,
      totalSize: 1000,
      sizeUnit: 'ml',
    })

    expect(computeCheapestRowIds([aed, usd])).toEqual(new Set())
  })

  it('does not mix a sized comparison with a per-pack fallback', () => {
    const sized = row({
      id: 1,
      canonicalName: 'Diet Coke',
      totalPrice: 1000,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const unsized = row({
      id: 2,
      canonicalName: 'Diet Coke',
      totalPrice: 5,
      quantity: 1,
    })

    expect(computeCheapestRowIds([sized, unsized])).toEqual(new Set())
  })

  it('does not highlight a single-row group', () => {
    const only = row({
      id: 1,
      canonicalName: 'Diet Coke',
      totalPrice: 500,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    expect(computeCheapestRowIds([only])).toEqual(new Set())
  })
})

describe('computeVendorWinCounts', () => {
  it('tallies wins per vendor and sorts most-wins first', () => {
    const cokeCarrefour = row({
      id: 1,
      canonicalName: 'Diet Coke',
      vendor: 'Carrefour',
      totalPrice: 100,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const cokeLulu = row({
      id: 2,
      canonicalName: 'Diet Coke',
      vendor: 'Lulu',
      totalPrice: 200,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const milkCarrefour = row({
      id: 3,
      canonicalName: 'Milk',
      vendor: 'Carrefour',
      totalPrice: 300,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const milkLulu = row({
      id: 4,
      canonicalName: 'Milk',
      vendor: 'Lulu',
      totalPrice: 250,
      totalSize: 1000,
      sizeUnit: 'ml',
    })

    const history = [cokeCarrefour, cokeLulu, milkCarrefour, milkLulu]
    const winners = computeCheapestRowIds(history)
    const winCounts = computeVendorWinCounts(history, winners)

    expect(winCounts).toEqual([
      { vendor: 'Carrefour', wins: 1 },
      { vendor: 'Lulu', wins: 1 },
    ])
  })

  it('excludes rows that are not the cheapest in their group', () => {
    const cheap = row({ id: 1, vendor: 'Carrefour', canonicalName: 'Milk' })
    const winners = new Set([1])
    const history = [
      cheap,
      row({ id: 2, vendor: 'Lulu', canonicalName: 'Milk' }),
    ]
    expect(computeVendorWinCounts(history, winners)).toEqual([
      { vendor: 'Carrefour', wins: 1 },
    ])
  })

  it('falls back to "Unknown" for rows with no vendor', () => {
    const history = [row({ id: 1, vendor: null })]
    expect(computeVendorWinCounts(history, new Set([1]))).toEqual([
      { vendor: 'Unknown', wins: 1 },
    ])
  })
})

describe('sortHistoryRows', () => {
  it('groups rows by product (canonical name over item name) and orders chronologically within each group', () => {
    const history = [
      row({ id: 1, canonicalName: 'Milk', purchaseDate: '2026-02-01' }),
      row({ id: 2, canonicalName: 'Diet Coke', purchaseDate: '2026-03-01' }),
      row({ id: 3, canonicalName: 'Milk', purchaseDate: '2026-01-01' }),
      row({ id: 4, canonicalName: 'Diet Coke', purchaseDate: '2026-01-15' }),
    ]

    expect(sortHistoryRows(history).map((r) => r.id)).toEqual([4, 2, 3, 1])
  })

  it('does not mutate the input array', () => {
    const history = [
      row({ id: 1, canonicalName: 'B' }),
      row({ id: 2, canonicalName: 'A' }),
    ]
    const original = [...history]
    sortHistoryRows(history)
    expect(history).toEqual(original)
  })
})
