import { pgTable, uuid, char, integer, unique } from 'drizzle-orm/pg-core'
import { ingestRuns } from './ingest-runs'
import { states } from './states'

// Presidential election results by state and election year.
// Invariant: dem_votes + rep_votes + other_votes = total_votes
export const rawVotingResults = pgTable(
  'raw_voting_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestRunId: uuid('ingest_run_id').notNull().references(() => ingestRuns.id),
    stateFips: char('state_fips', { length: 2 }).notNull().references(() => states.fips),
    electionYear: integer('election_year').notNull(),
    demVotes: integer('dem_votes').notNull(),
    repVotes: integer('rep_votes').notNull(),
    otherVotes: integer('other_votes').notNull(),
    totalVotes: integer('total_votes').notNull(),
  },
  (t) => [unique('raw_voting_unique').on(t.stateFips, t.electionYear)],
)

export type RawVotingResult = typeof rawVotingResults.$inferSelect
export type NewRawVotingResult = typeof rawVotingResults.$inferInsert
