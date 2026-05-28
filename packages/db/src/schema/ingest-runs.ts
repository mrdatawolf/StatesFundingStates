import { pgTable, uuid, integer, varchar, timestamp, text, pgEnum } from 'drizzle-orm/pg-core'

export const ingestSourceEnum = pgEnum('ingest_source', ['usa_spending', 'irs_soi', 'census', 'medsl_voting'])
export const ingestStatusEnum = pgEnum('ingest_status', ['pending', 'running', 'complete', 'failed'])

export type IngestSource = typeof ingestSourceEnum.enumValues[number]
export type IngestStatus = typeof ingestStatusEnum.enumValues[number]

export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: ingestSourceEnum('source').notNull(),
  fiscalYear: integer('fiscal_year').notNull(),
  status: ingestStatusEnum('status').notNull().default('pending'),
  triggeredBy: varchar('triggered_by', { length: 100 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
})

export type IngestRun = typeof ingestRuns.$inferSelect
export type NewIngestRun = typeof ingestRuns.$inferInsert
