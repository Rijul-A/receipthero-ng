import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { getSpendingReport } from '../services/spending-report'

// Distinct documentId range to avoid cross-test collisions in the shared
// test database.
const DOC_IDS = [9_100_001, 9_100_002, 9_100_003, 9_100_004]

async function cleanup() {
  for (const id of DOC_IDS) {
    await db.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, id)).run()
  }
}

async function seed(documentId: number, receipt: Record<string, unknown>) {
  const now = new Date().toISOString()
  await db
    .insert(schema.processingLogs)
    .values({
      documentId,
      status: 'completed',
      progress: 100,
      attempts: 1,
      receiptData: JSON.stringify(receipt),
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

describe('getSpendingReport', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it('groups by month and by currency/category, summing within each bucket', async () => {
    await seed(DOC_IDS[0], {
      date: '2026-01-05',
      amount: 50,
      currency: 'aed',
      category: 'groceries',
    })
    await seed(DOC_IDS[1], {
      date: '2026-01-20',
      amount: 30,
      currency: 'AED',
      category: 'groceries',
    })
    await seed(DOC_IDS[2], { date: '2026-01-15', amount: 20, currency: 'AED', category: 'dining' })

    const rows = await getSpendingReport('month')
    const groceries = rows.find((r) => r.period === '2026-01' && r.category === 'groceries')
    const dining = rows.find((r) => r.period === '2026-01' && r.category === 'dining')

    expect(groceries).toEqual({
      period: '2026-01',
      currency: 'AED',
      category: 'groceries',
      total: 80,
      count: 2,
    })
    expect(dining).toEqual({
      period: '2026-01',
      currency: 'AED',
      category: 'dining',
      total: 20,
      count: 1,
    })
  })

  it('keeps different currencies in separate buckets rather than summing them', async () => {
    await seed(DOC_IDS[0], {
      date: '2026-02-01',
      amount: 100,
      currency: 'AED',
      category: 'groceries',
    })
    await seed(DOC_IDS[1], {
      date: '2026-02-02',
      amount: 100,
      currency: 'USD',
      category: 'groceries',
    })

    const rows = await getSpendingReport('month')
    const feb = rows.filter((r) => r.period === '2026-02')

    expect(feb).toHaveLength(2)
    expect(feb.find((r) => r.currency === 'AED')?.total).toBe(100)
    expect(feb.find((r) => r.currency === 'USD')?.total).toBe(100)
  })

  it('buckets by ISO week (Monday start) when groupBy is week', async () => {
    // 2026-03-02 is a Monday.
    await seed(DOC_IDS[0], {
      date: '2026-03-03',
      amount: 10,
      currency: 'AED',
      category: 'groceries',
    })
    await seed(DOC_IDS[1], {
      date: '2026-03-08',
      amount: 10,
      currency: 'AED',
      category: 'groceries',
    })

    const rows = await getSpendingReport('week')
    const week = rows.find((r) => r.period === '2026-03-02')

    expect(week).toEqual({
      period: '2026-03-02',
      currency: 'AED',
      category: 'groceries',
      total: 20,
      count: 2,
    })
  })

  it('falls back to "uncategorized" and skips receipts with no usable date', async () => {
    await seed(DOC_IDS[0], { date: '2026-04-01', amount: 10, currency: 'AED' })
    await seed(DOC_IDS[1], { amount: 10, currency: 'AED', category: 'groceries' })

    const rows = await getSpendingReport('month')
    const april = rows.filter((r) => r.period === '2026-04')

    expect(april).toHaveLength(1)
    expect(april[0].category).toBe('uncategorized')
  })
})
