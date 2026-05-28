import type { FastifyInstance } from 'fastify'
import { rawVotingResults, states } from '@sfs/db'
import { eq, desc } from 'drizzle-orm'

export default async function votingRoutes(app: FastifyInstance) {
  // Get voting results for a given election year, with computed lean values.
  // Postcondition: lean = (demVotes - repVotes) / totalVotes, range [-1, 1]
  app.get<{ Querystring: { year?: string } }>('/voting', async (req, reply) => {
    const year = req.query.year ? parseInt(req.query.year, 10) : null

    const rows = await app.db
      .select({
        stateFips: rawVotingResults.stateFips,
        stateName: states.name,
        stateAbbr: states.abbreviation,
        electionYear: rawVotingResults.electionYear,
        demVotes: rawVotingResults.demVotes,
        repVotes: rawVotingResults.repVotes,
        otherVotes: rawVotingResults.otherVotes,
        totalVotes: rawVotingResults.totalVotes,
      })
      .from(rawVotingResults)
      .innerJoin(states, eq(rawVotingResults.stateFips, states.fips))
      .where(year != null ? eq(rawVotingResults.electionYear, year) : undefined)
      .orderBy(rawVotingResults.stateFips)

    const result = rows.map((r) => ({
      ...r,
      demShare: r.totalVotes > 0 ? r.demVotes / r.totalVotes : null,
      repShare: r.totalVotes > 0 ? r.repVotes / r.totalVotes : null,
      lean: r.totalVotes > 0 ? (r.demVotes - r.repVotes) / r.totalVotes : null,
    }))

    return reply.send(result)
  })

  // List all election years that have voting data, most recent first.
  app.get('/voting/years', async (_req, reply) => {
    const rows = await app.db
      .selectDistinct({ electionYear: rawVotingResults.electionYear })
      .from(rawVotingResults)
      .orderBy(desc(rawVotingResults.electionYear))
    return reply.send(rows.map((r) => r.electionYear))
  })
}
