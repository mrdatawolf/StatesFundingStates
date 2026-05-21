import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as schema from './schema/index'
import { states } from './schema/states'
import { STATES_SEED } from './seed/data'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../migrations')

export function createDb(dataDir: string = './DB') {
  const client = new PGlite(dataDir)
  return drizzle(client, { schema })
}

// Applies all pending migrations. Call once at startup before handling requests.
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder })
}

// Seeds the states reference table if empty. Safe to call on every startup.
export async function ensureSeeded(db: Db): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(states)
  if ((row?.count ?? 0) > 0) return
  await db.insert(states).values([...STATES_SEED]).onConflictDoNothing()
  console.log('[db] Seeded 51 states')
}

export type Db = ReturnType<typeof createDb>

export { STATES_SEED } from './seed/data'
export * from './schema/index'
