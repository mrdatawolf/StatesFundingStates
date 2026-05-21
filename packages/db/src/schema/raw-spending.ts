import { pgTable, uuid, char, integer, bigint, varchar, unique } from 'drizzle-orm/pg-core'
import { ingestRuns } from './ingest-runs'
import { states } from './states'

export type SpendingCategory = 'grants' | 'contracts' | 'loans' | 'direct_payments' | 'insurance'

// Invariant: amount_cents >= 0 (enforced via application-layer precondition; all USASpending values are non-negative)
export const rawFederalSpending = pgTable(
  'raw_federal_spending',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestRunId: uuid('ingest_run_id').notNull().references(() => ingestRuns.id),
    stateFips: char('state_fips', { length: 2 }).notNull().references(() => states.fips),
    fiscalYear: integer('fiscal_year').notNull(),
    category: varchar('category', { length: 30 }).notNull().$type<SpendingCategory>(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  },
  (t) => [unique('raw_spending_unique').on(t.ingestRunId, t.stateFips, t.fiscalYear, t.category)],
)

export type RawFederalSpending = typeof rawFederalSpending.$inferSelect
export type NewRawFederalSpending = typeof rawFederalSpending.$inferInsert
