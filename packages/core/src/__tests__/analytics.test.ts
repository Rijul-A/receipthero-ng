import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { getVendorSpendReport, getItemFrequencyReport } from '../services/analytics'

const DOC_IDS = [9_500_001, 9_500_002, 9_500_003]

async function cleanupLogs() {
  for (const id of DOC_IDS) {
    await db.delete(schema.processingLogs).where(eq(schema.processingLogs.documentId, id)).run()
  }
}

async function cleanupItems() {
  for (const id of DOC_IDS) {
    await db.delete(schema.receiptItems).where(eq(schema.receiptItems.documentId, id)).run()
  }
}

async function seedLog(documentId: number, receipt: Record<string, unknown>) {
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

async function seedItem(documentId: number, item: Partial<schema.NewReceiptItemEntry>) {
  const now = new Date().toISOString()
  await db
    .insert(schema.receiptItems)
    .values({
      documentId,
      itemName: 'raw name',
      quantity: 1,
      createdAt: now,
      ...item,
    })
    .run()
}

describe('getVendorSpendReport', () => {
  beforeEach(cleanupLogs)
  afterEach(cleanupLogs)

  it('sums spend per vendor, keeping currencies separate', async () => {
    await seedLog(DOC_IDS[0], { vendor: 'Carrefour', amount: 100, currency: 'AED' })
    await seedLog(DOC_IDS[1], { vendor: 'Carrefour', amount: 50, currency: 'AED' })
    await seedLog(DOC_IDS[2], { vendor: 'Carrefour', amount: 20, currency: 'USD' })

    const rows = await getVendorSpendReport()
    const carrefourAed = rows.find((r) => r.vendor === 'Carrefour' && r.currency === 'AED')
    const carrefourUsd = rows.find((r) => r.vendor === 'Carrefour' && r.currency === 'USD')

    expect(carrefourAed).toEqual({
      vendor: 'Carrefour',
      storeLocation: null,
      currency: 'AED',
      total: 150,
      count: 2,
    })
    expect(carrefourUsd).toEqual({
      vendor: 'Carrefour',
      storeLocation: null,
      currency: 'USD',
      total: 20,
      count: 1,
    })
  })

  it('sorts by total descending', async () => {
    await seedLog(DOC_IDS[0], { vendor: 'Small Store', amount: 10, currency: 'AED' })
    await seedLog(DOC_IDS[1], { vendor: 'Big Store', amount: 500, currency: 'AED' })

    const rows = await getVendorSpendReport()
    const bigIdx = rows.findIndex((r) => r.vendor === 'Big Store')
    const smallIdx = rows.findIndex((r) => r.vendor === 'Small Store')
    expect(bigIdx).toBeLessThan(smallIdx)
  })

  it('merges vendor names that differ only by casing instead of fragmenting them', async () => {
    await seedLog(DOC_IDS[0], { vendor: 'Carrefour', amount: 50, currency: 'AED' })
    await seedLog(DOC_IDS[1], { vendor: 'CARREFOUR', amount: 30, currency: 'AED' })
    await seedLog(DOC_IDS[2], { vendor: 'carrefour', amount: 20, currency: 'AED' })

    const rows = await getVendorSpendReport()
    const carrefourRows = rows.filter((r) => r.vendor.toLowerCase() === 'carrefour')

    expect(carrefourRows).toHaveLength(1)
    expect(carrefourRows[0].total).toBe(100)
    expect(carrefourRows[0].count).toBe(3)
    // Displays whichever casing was encountered first.
    expect(carrefourRows[0].vendor).toBe('Carrefour')
  })

  it('keeps two locations of the same vendor separate, merging casing within each location', async () => {
    await seedLog(DOC_IDS[0], {
      vendor: 'Carrefour',
      storeLocation: 'Deira City Centre',
      amount: 40,
      currency: 'AED',
    })
    await seedLog(DOC_IDS[1], {
      vendor: 'Carrefour',
      storeLocation: 'DEIRA CITY CENTRE',
      amount: 10,
      currency: 'AED',
    })
    await seedLog(DOC_IDS[2], {
      vendor: 'Carrefour',
      storeLocation: 'Mall of the Emirates',
      amount: 100,
      currency: 'AED',
    })

    const rows = await getVendorSpendReport().then((r) =>
      r.filter((row) => row.vendor === 'Carrefour'),
    )

    expect(rows).toHaveLength(2)
    const deira = rows.find((r) => r.storeLocation === 'Deira City Centre')
    const moe = rows.find((r) => r.storeLocation === 'Mall of the Emirates')
    expect(deira?.total).toBe(50)
    expect(deira?.count).toBe(2)
    expect(moe?.total).toBe(100)
  })
})

describe('getItemFrequencyReport', () => {
  beforeEach(cleanupItems)
  afterEach(cleanupItems)

  it('tallies total spend and purchase count per item, keyed by canonical name', async () => {
    await seedItem(DOC_IDS[0], {
      itemName: 'Almarai Milk 1L',
      canonicalName: 'Analytics Test Milk',
      currency: 'AED',
      totalPrice: 500,
      purchaseDate: '2026-01-01',
    })
    await seedItem(DOC_IDS[1], {
      itemName: 'Milk 1 Liter',
      canonicalName: 'Analytics Test Milk',
      currency: 'AED',
      totalPrice: 550,
      purchaseDate: '2026-02-01',
    })

    const rows = await getItemFrequencyReport()
    const milk = rows.find((r) => r.name === 'Analytics Test Milk')

    expect(milk).toEqual({
      name: 'Analytics Test Milk',
      currency: 'AED',
      totalSpent: 10.5,
      purchaseCount: 2,
      firstPurchase: '2026-01-01',
      lastPurchase: '2026-02-01',
    })
  })

  it('nets refunds into totalSpent without counting them as purchases', async () => {
    await seedItem(DOC_IDS[0], {
      itemName: 'Analytics Test Bread',
      canonicalName: 'Analytics Test Bread',
      currency: 'AED',
      totalPrice: 300,
      purchaseDate: '2026-01-01',
    })
    await seedItem(DOC_IDS[1], {
      itemName: 'Analytics Test Bread',
      canonicalName: 'Analytics Test Bread',
      currency: 'AED',
      totalPrice: -100,
      purchaseDate: '2026-01-05',
    })

    const rows = await getItemFrequencyReport()
    const bread = rows.find((r) => r.name === 'Analytics Test Bread')

    expect(bread?.totalSpent).toBe(2)
    expect(bread?.purchaseCount).toBe(1)
  })

  it('falls back to itemName when canonicalName is null', async () => {
    await seedItem(DOC_IDS[0], {
      itemName: 'Unresolved Raw Name',
      canonicalName: null,
      currency: 'AED',
      totalPrice: 100,
    })

    const rows = await getItemFrequencyReport()
    expect(rows.find((r) => r.name === 'Unresolved Raw Name')).toBeTruthy()
  })
})
