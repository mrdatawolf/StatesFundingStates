import { pgTable, uuid, char, integer, bigint, timestamp, unique, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { ingestRuns } from './ingest-runs'
import { states } from './states'

// Invariants enforced by DB CHECK constraints:
//   net_cents = total_received_cents - total_paid_in_cents
//   net_per_capita_cents IS NULL iff population IS NULL
export const stateBalances = pgTable(
  'state_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateFips: char('state_fips', { length: 2 }).notNull().references(() => states.fips),
    fiscalYear: integer('fiscal_year').notNull(),
    totalReceivedCents: bigint('total_received_cents', { mode: 'number' }).notNull(),
    totalPaidInCents: bigint('total_paid_in_cents', { mode: 'number' }).notNull(),
    netCents: bigint('net_cents', { mode: 'number' }).notNull(),
    population: integer('population'),
    netPerCapitaCents: integer('net_per_capita_cents'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    spendingRunId: uuid('spending_run_id').notNull().references(() => ingestRuns.id),
    taxRunId: uuid('tax_run_id').notNull().references(() => ingestRuns.id),
  },
  (t) => [
    unique('state_balance_unique').on(t.stateFips, t.fiscalYear),
    check('net_cents_check', sql`${t.netCents} = ${t.totalReceivedCents} - ${t.totalPaidInCents}`),
    check(
      'per_capita_null_parity',
      sql`(${t.population} IS NULL) = (${t.netPerCapitaCents} IS NULL)`,
    ),
  ],
)

export type StateBalance = typeof stateBalances.$inferSelect
export type NewStateBalance = typeof stateBalances.$inferInsert
