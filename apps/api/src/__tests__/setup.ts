import * as fs from 'fs'

// Delete any test DB file left behind by a prior run (including its WAL/SHM
// sidecar files) before the db module opens a connection to it, so every
// test run starts from a completely fresh, empty database regardless of
// what a prior run - crashed, failed mid-test, or just old - left behind.
const DB_PATH = process.env.DATABASE_PATH || './receipthero.test.db'
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${DB_PATH}${suffix}`, { force: true })
}

const { migrate } = await import('drizzle-orm/bun-sqlite/migrator')
const path = await import('path')
const { db } = await import('@sm-rn/core')

// bun test never runs migrations on its own, so without this the test DB
// has zero tables and any test touching the DB fails with "no such table".
// Migrations live in packages/core (the single source of truth for the
// shared schema), not duplicated here.
migrate(db, {
  migrationsFolder: path.resolve(import.meta.dirname, '../../../../packages/core/drizzle'),
})

// Every route except a short exemption list now sits behind requireAuth
// (see apps/api/src/middleware/require-auth.ts). Pre-caching a fixed token
// here lets every existing route test attach a valid Authorization header
// without hitting a real Paperless server.
const { cacheToken } = await import('../lib/auth-cache')
export const TEST_AUTH_TOKEN = 'test-session-token'
cacheToken(TEST_AUTH_TOKEN)

export function authHeaders(): Record<string, string> {
  return { Authorization: `Token ${TEST_AUTH_TOKEN}` }
}
