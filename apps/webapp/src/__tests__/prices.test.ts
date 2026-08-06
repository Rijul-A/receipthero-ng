import { describe, expect, it } from 'vitest'
import { comparablePriceOf, computeCheapestRowIds } from '../routes/prices'

interface Row {
  id: number
  itemName: string
  canonicalName: string | null
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
