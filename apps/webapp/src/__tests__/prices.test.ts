import { describe, expect, it } from 'vitest'
import {
  buildPriceTrends,
  comparablePriceOf,
  computeCheapestRowIds,
  computeStoreWinCounts,
  formatStoreLabel,
  sortHistoryRows,
} from '../routes/prices'

interface Row {
  id: number
  itemName: string
  canonicalName: string | null
  vendor: string | null
  storeLocation: string | null
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
    storeLocation: null,
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

describe('formatStoreLabel', () => {
  it('appends the location when present', () => {
    expect(
      formatStoreLabel({
        vendor: 'Carrefour',
        storeLocation: 'Deira City Centre',
      }),
    ).toBe('Carrefour — Deira City Centre')
  })

  it('falls back to just the vendor when there is no location', () => {
    expect(formatStoreLabel({ vendor: 'Carrefour', storeLocation: null })).toBe(
      'Carrefour',
    )
  })

  it('falls back to "Unknown" when there is no vendor either', () => {
    expect(formatStoreLabel({ vendor: null, storeLocation: null })).toBe(
      'Unknown',
    )
  })
})

describe('computeStoreWinCounts', () => {
  it('tallies wins per store and sorts most-wins first', () => {
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
    const winCounts = computeStoreWinCounts(history, winners)

    expect(winCounts).toEqual([
      { store: 'Carrefour', wins: 1 },
      { store: 'Lulu', wins: 1 },
    ])
  })

  it('counts two locations of the same vendor separately', () => {
    const cokeDeira = row({
      id: 1,
      canonicalName: 'Diet Coke',
      vendor: 'Carrefour',
      storeLocation: 'Deira City Centre',
      totalPrice: 100,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const cokeMOE = row({
      id: 2,
      canonicalName: 'Diet Coke',
      vendor: 'Carrefour',
      storeLocation: 'Mall of the Emirates',
      totalPrice: 200,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const milkDeira = row({
      id: 3,
      canonicalName: 'Milk',
      vendor: 'Carrefour',
      storeLocation: 'Deira City Centre',
      totalPrice: 50,
      totalSize: 1000,
      sizeUnit: 'ml',
    })
    const milkMOE = row({
      id: 4,
      canonicalName: 'Milk',
      vendor: 'Carrefour',
      storeLocation: 'Mall of the Emirates',
      totalPrice: 60,
      totalSize: 1000,
      sizeUnit: 'ml',
    })

    const history = [cokeDeira, cokeMOE, milkDeira, milkMOE]
    const winners = computeCheapestRowIds(history)
    const winCounts = computeStoreWinCounts(history, winners)

    expect(winCounts).toEqual([
      { store: 'Carrefour — Deira City Centre', wins: 2 },
    ])
  })

  it('excludes rows that are not the cheapest in their group', () => {
    const cheap = row({ id: 1, vendor: 'Carrefour', canonicalName: 'Milk' })
    const winners = new Set([1])
    const history = [
      cheap,
      row({ id: 2, vendor: 'Lulu', canonicalName: 'Milk' }),
    ]
    expect(computeStoreWinCounts(history, winners)).toEqual([
      { store: 'Carrefour', wins: 1 },
    ])
  })

  it('falls back to "Unknown" for rows with no vendor', () => {
    const history = [row({ id: 1, vendor: null })]
    expect(computeStoreWinCounts(history, new Set([1]))).toEqual([
      { store: 'Unknown', wins: 1 },
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

describe('buildPriceTrends', () => {
  it('produces one series per store within a product/currency chart', () => {
    const history = [
      row({
        id: 1,
        canonicalName: 'Diet Coke',
        vendor: 'Carrefour',
        totalPrice: 100,
        totalSize: 1000,
        sizeUnit: 'ml',
        purchaseDate: '2026-01-01',
      }),
      row({
        id: 2,
        canonicalName: 'Diet Coke',
        vendor: 'Lulu',
        totalPrice: 200,
        totalSize: 1000,
        sizeUnit: 'ml',
        purchaseDate: '2026-01-05',
      }),
    ]

    const trends = buildPriceTrends(history)
    expect(trends).toHaveLength(1)
    expect(trends[0].product).toBe('Diet Coke')
    expect(trends[0].series.map((s) => s.label).sort()).toEqual([
      'Carrefour',
      'Lulu',
    ])
    expect(
      trends[0].series.find((s) => s.label === 'Carrefour')?.points,
    ).toEqual([{ x: new Date('2026-01-01').getTime(), y: 10 }])
  })

  it('skips rows with no purchase date or no comparable price', () => {
    const history = [
      row({
        id: 1,
        canonicalName: 'Diet Coke',
        totalPrice: 100,
        purchaseDate: null,
      }),
      row({
        id: 2,
        canonicalName: 'Diet Coke',
        totalPrice: -50,
        purchaseDate: '2026-01-01',
      }),
    ]
    expect(buildPriceTrends(history)).toEqual([])
  })

  it('keeps different currencies as separate charts', () => {
    const history = [
      row({
        id: 1,
        canonicalName: 'Diet Coke',
        currency: 'AED',
        totalPrice: 100,
        purchaseDate: '2026-01-01',
      }),
      row({
        id: 2,
        canonicalName: 'Diet Coke',
        currency: 'USD',
        totalPrice: 100,
        purchaseDate: '2026-01-01',
      }),
    ]
    const trends = buildPriceTrends(history)
    expect(trends.map((t) => t.currency).sort()).toEqual(['AED', 'USD'])
  })

  it('does not plot a sized comparison and a per-pack fallback on the same chart', () => {
    // Same product, same currency, but one row has size info (per 100ml)
    // and one doesn't (per pack). Their values are on completely different
    // scales - sharing a y-axis would read as a huge price swing.
    const sized = row({
      id: 1,
      canonicalName: 'Diet Coke',
      totalPrice: 1200,
      totalSize: 1980,
      sizeUnit: 'ml',
      purchaseDate: '2026-01-01',
    })
    const unsized = row({
      id: 2,
      canonicalName: 'Diet Coke',
      totalPrice: 1200,
      quantity: 1,
      purchaseDate: '2026-02-01',
    })

    const trends = buildPriceTrends([sized, unsized])
    expect(trends).toHaveLength(2)
    expect(trends.map((t) => t.label).sort()).toEqual(['per 100ml', 'per pack'])
    // Each chart holds only its own basis's points.
    for (const trend of trends) {
      expect(trend.series.flatMap((s) => s.points)).toHaveLength(1)
    }
  })
})
