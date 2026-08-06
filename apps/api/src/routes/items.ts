import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { searchItemNames, getItemPriceHistory } from '@sm-rn/core'

const items = new Hono()

/**
 * GET /api/items/search?q=milk
 *
 * Autocomplete over distinct item names seen across processed receipts.
 */
items.get('/search', zValidator('query', z.object({ q: z.string().min(1) })), async (c) => {
  const { q } = c.req.valid('query')
  const names = await searchItemNames(q)
  return c.json({ names })
})

/**
 * GET /api/items/history?names=Milk%201L,Almarai%20Milk
 *
 * Price history (newest first) for one or more user-selected item names,
 * for cross-vendor comparison.
 */
items.get('/history', zValidator('query', z.object({ names: z.string().min(1) })), async (c) => {
  const { names } = c.req.valid('query')
  const itemNames = names
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  const history = await getItemPriceHistory(itemNames)
  return c.json({ history })
})

export default items
