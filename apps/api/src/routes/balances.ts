import type { FastifyInstance } from 'fastify'
import { stateBalances, states } from '@sfs/db'
import { eq, and, desc } from 'drizzle-orm'

export default async function balanceRoutes(app: FastifyInstance) {
  // Get all state balances, optionally filtered by fiscal year.
  // Postcondition: every returned record satisfies net = received - paid_in
  app.get<{ Querystring: { year?: string } }>('/balances', async (req, reply) => {
    const year = req.query.year ? parseInt(req.query.year, 10) : null

    const rows = await app.db
      .select({
        stateFips: stateBalances.stateFips,
        stateName: states.name,
        stateAbbr: states.abbreviation,
        fiscalYear: stateBalances.fiscalYear,
        totalReceivedCents: stateBalances.totalReceivedCents,
        totalPaidInCents: stateBalances.totalPaidInCents,
        netCents: stateBalances.netCents,
        population: stateBalances.population,
        netPerCapitaCents: stateBalances.netPerCapitaCents,
        computedAt: stateBalances.computedAt,
      })
      .from(stateBalances)
      .innerJoin(states, eq(stateBalances.stateFips, states.fips))
      .where(year != null ? eq(stateBalances.fiscalYear, year) : undefined)
      .orderBy(desc(stateBalances.netCents))

    return reply.send(rows)
  })

  // Get balance for a single state across all years.
  // Precondition: fips is a valid 2-character FIPS code
  app.get<{ Params: { fips: string } }>('/balances/:fips', async (req, reply) => {
    const { fips } = req.params
    if (!/^\d{2}$/.test(fips)) {
      return reply.status(400).send({ error: 'fips must be a 2-digit code' })
    }

    const rows = await app.db
      .select({
        stateFips: stateBalances.stateFips,
        stateName: states.name,
        stateAbbr: states.abbreviation,
        fiscalYear: stateBalances.fiscalYear,
        totalReceivedCents: stateBalances.totalReceivedCents,
        totalPaidInCents: stateBalances.totalPaidInCents,
        netCents: stateBalances.netCents,
        population: stateBalances.population,
        netPerCapitaCents: stateBalances.netPerCapitaCents,
      })
      .from(stateBalances)
      .innerJoin(states, eq(stateBalances.stateFips, states.fips))
      .where(and(eq(stateBalances.stateFips, fips)))
      .orderBy(desc(stateBalances.fiscalYear))

    if (rows.length === 0) {
      return reply.status(404).send({ error: `No balance data found for FIPS ${fips}` })
    }

    return reply.send(rows)
  })

  // List all fiscal years that have computed balance data.
  app.get('/balances/years', async (_req, reply) => {
    const rows = await app.db
      .selectDistinct({ fiscalYear: stateBalances.fiscalYear })
      .from(stateBalances)
      .orderBy(desc(stateBalances.fiscalYear))
    return reply.send(rows.map((r) => r.fiscalYear))
  })
}
