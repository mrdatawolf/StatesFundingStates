import { pgTable, uuid, char, integer, unique } from 'drizzle-orm/pg-core'
import { ingestRuns } from './ingest-runs'
import { states } from './states'

// Invariant: population > 0
export const rawPopulation = pgTable(
  'raw_population',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestRunId: uuid('ingest_run_id').notNull().references(() => ingestRuns.id),
    stateFips: char('state_fips', { length: 2 }).notNull().references(() => states.fips),
    censusYear: integer('census_year').notNull(),
    population: integer('population').notNull(),
  },
  (t) => [unique('raw_population_unique').on(t.stateFips, t.censusYear)],
)

export type RawPopulation = typeof rawPopulation.$inferSelect
export type NewRawPopulation = typeof rawPopulation.$inferInsert
