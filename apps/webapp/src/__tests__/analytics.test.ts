import { describe, expect, it } from 'vitest'
import {
  buildCategoryBreakdown,
  buildSpendOverTimeSeries,
  buildVendorBarData,
  formatPurchaseFrequency,
} from '../routes/analytics'

describe('buildSpendOverTimeSeries', () => {
  it('sums totals per period within a currency, one series per currency', () => {
    const rows = [
      {
        period: '2026-01',
        currency: 'AED',
        category: 'groceries',
        total: 100,
        count: 1,
      },
      {
        period: '2026-01',
        currency: 'AED',
        category: 'dining',
        total: 50,
        count: 1,
      },
      {
        period: '2026-02',
        currency: 'AED',
        category: 'groceries',
        total: 200,
        count: 1,
      },
      {
        period: '2026-01',
        currency: 'USD',
        category: 'groceries',
        total: 20,
        count: 1,
      },
    ]

    const result = buildSpendOverTimeSeries(rows)
    expect(result.map((r) => r.currency).sort()).toEqual(['AED', 'USD'])

    const aed = result.find((r) => r.currency === 'AED')!
    const jan = aed.series.points.find((p) => p.x === Date.UTC(2026, 0, 1))
    expect(jan?.y).toBe(150)
  })
})

describe('buildCategoryBreakdown', () => {
  it('sums totals per category across all periods within a currency', () => {
    const rows = [
      {
        period: '2026-01',
        currency: 'AED',
        category: 'groceries',
        total: 100,
        count: 1,
      },
      {
        period: '2026-02',
        currency: 'AED',
        category: 'groceries',
        total: 50,
        count: 1,
      },
      {
        period: '2026-01',
        currency: 'AED',
        category: 'dining',
        total: 30,
        count: 1,
      },
    ]

    const result = buildCategoryBreakdown(rows)
    expect(result).toHaveLength(1)
    const groceries = result[0].data.find((d) => d.label === 'groceries')
    expect(groceries?.value).toBe(150)
  })

  it('sorts categories by value descending', () => {
    const rows = [
      {
        period: '2026-01',
        currency: 'AED',
        category: 'small',
        total: 10,
        count: 1,
      },
      {
        period: '2026-01',
        currency: 'AED',
        category: 'big',
        total: 500,
        count: 1,
      },
    ]
    const result = buildCategoryBreakdown(rows)
    expect(result[0].data.map((d) => d.label)).toEqual(['big', 'small'])
  })
})

describe('buildVendorBarData', () => {
  it('sorts vendors by total descending within a currency', () => {
    const rows = [
      { vendor: 'Small Store', currency: 'AED', total: 10, count: 1 },
      { vendor: 'Big Store', currency: 'AED', total: 500, count: 3 },
    ]
    const result = buildVendorBarData(rows)
    expect(result[0].data.map((d) => d.label)).toEqual([
      'Big Store',
      'Small Store',
    ])
  })

  it('keeps currencies separate', () => {
    const rows = [
      { vendor: 'Store', currency: 'AED', total: 100, count: 1 },
      { vendor: 'Store', currency: 'USD', total: 50, count: 1 },
    ]
    const result = buildVendorBarData(rows)
    expect(result.map((r) => r.currency).sort()).toEqual(['AED', 'USD'])
  })
})

describe('formatPurchaseFrequency', () => {
  it('shows a singular purchase count for a one-off item', () => {
    expect(
      formatPurchaseFrequency({
        name: 'Item',
        currency: 'AED',
        totalSpent: 10,
        purchaseCount: 1,
        firstPurchase: '2026-01-01',
        lastPurchase: '2026-01-01',
      }),
    ).toBe('1 purchase')
  })

  it('computes an average days-between figure for repeat purchases', () => {
    expect(
      formatPurchaseFrequency({
        name: 'Item',
        currency: 'AED',
        totalSpent: 30,
        purchaseCount: 3,
        firstPurchase: '2026-01-01',
        lastPurchase: '2026-01-21',
      }),
    ).toBe('3 purchases, ~every 10 days')
  })

  it('falls back to a plain count when dates are missing', () => {
    expect(
      formatPurchaseFrequency({
        name: 'Item',
        currency: 'AED',
        totalSpent: 20,
        purchaseCount: 2,
        firstPurchase: null,
        lastPurchase: null,
      }),
    ).toBe('2 purchases')
  })
})
