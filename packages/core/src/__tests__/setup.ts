import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as path from 'path'
import { db } from '../db'

// bun test never runs migrations on its own, so without this the test DB
// has zero tables and any test touching the DB fails with "no such table".
migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle') })
