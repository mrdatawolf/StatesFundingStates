import { pgTable, uuid, char, integer, bigint, varchar, unique } from 'drizzle-orm/pg-core'
import { ingestRuns } from './ingest-runs'
import { states } from './states'

export type TaxType = 'individual_income' | 'corporate' | 'payroll' | 'excise' | 'estate'

// Invariant: amount_cents >= 0
export const rawTaxReceipts = pgTable(
  'raw_tax_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestRunId: uuid('ingest_run_id').notNull().references(() => ingestRuns.id),
    stateFips: char('state_fips', { length: 2 }).notNull().references(() => states.fips),
    fiscalYear: integer('fiscal_year').notNull(),
    taxType: varchar('tax_type', { length: 30 }).notNull().$type<TaxType>(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  },
  (t) => [unique('raw_tax_unique').on(t.ingestRunId, t.stateFips, t.fiscalYear, t.taxType)],
)

export type RawTaxReceipt = typeof rawTaxReceipts.$inferSelect
export type NewRawTaxReceipt = typeof rawTaxReceipts.$inferInsert
