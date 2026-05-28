import { pgTable, uuid, integer, varchar, timestamp, text } from 'drizzle-orm/pg-core'

export type IngestSource = 'usa_spending' | 'irs_soi' | 'census' | 'medsl_voting'
export type IngestStatus = 'pending' | 'running' | 'complete' | 'failed'

export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: varchar('source', { length: 20 }).notNull().$type<IngestSource>(),
  fiscalYear: integer('fiscal_year').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending').$type<IngestStatus>(),
  triggeredBy: varchar('triggered_by', { length: 100 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
})

export type IngestRun = typeof ingestRuns.$inferSelect
export type NewIngestRun = typeof ingestRuns.$inferInsert
