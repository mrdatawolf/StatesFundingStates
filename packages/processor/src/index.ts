import { eq, and, sql, desc } from 'drizzle-orm'
import type { Db } from '@sfs/db'
import {
  rawFederalSpending,
  rawTaxReceipts,
  rawPopulation,
  stateBalances,
  ingestRuns,
  states,
} from '@sfs/db'

export interface ComputeResult {
  fiscalYear: number
  statesProcessed: number
}

// Precondition:  rawFederalSpending rows exist for the given fiscalYear (from a complete ingest run)
// Precondition:  rawTaxReceipts rows exist for the given fiscalYear (from a complete ingest run)
// Postcondition: stateBalances upserted for every state that has both spending and tax data
// Invariant:     net_cents = total_received_cents - total_paid_in_cents (enforced by DB CHECK constraint)
// Invariant:     net_per_capita_cents IS NULL iff population IS NULL (enforced by DB CHECK constraint)
export async function computeBalances(db: Db, fiscalYear: number): Promise<ComputeResult> {
  const completedRuns = await db
    .select()
    .from(ingestRuns)
    .where(and(eq(ingestRuns.fiscalYear, fiscalYear), eq(ingestRuns.status, 'complete')))
    .orderBy(desc(ingestRuns.startedAt))

  const spendingRun = completedRuns.find((r) => r.source === 'usa_spending')
  const taxRun = completedRuns.find((r) => r.source === 'irs_soi')

  if (!spendingRun) {
    throw new Error(`Precondition failed: no complete usa_spending ingest run for ${fiscalYear}`)
  }
  if (!taxRun) {
    throw new Error(`Precondition failed: no complete irs_soi ingest run for ${fiscalYear}`)
  }

  const spendingByState = await db
    .select({
      stateFips: rawFederalSpending.stateFips,
      totalCents: sql<number>`sum(${rawFederalSpending.amountCents})`,
    })
    .from(rawFederalSpending)
    .where(
      and(
        eq(rawFederalSpending.ingestRunId, spendingRun.id),
        eq(rawFederalSpending.fiscalYear, fiscalYear),
      ),
    )
    .groupBy(rawFederalSpending.stateFips)

  const taxByState = await db
    .select({
      stateFips: rawTaxReceipts.stateFips,
      totalCents: sql<number>`sum(${rawTaxReceipts.amountCents})`,
    })
    .from(rawTaxReceipts)
    .where(
      and(
        eq(rawTaxReceipts.ingestRunId, taxRun.id),
        eq(rawTaxReceipts.fiscalYear, fiscalYear),
      ),
    )
    .groupBy(rawTaxReceipts.stateFips)

  const allStates = await db.select({ fips: states.fips }).from(states)

  const populationByFips = await getLatestPopulationByState(db, fiscalYear)

  const spendingMap = new Map(spendingByState.map((r) => [r.stateFips, r.totalCents]))
  const taxMap = new Map(taxByState.map((r) => [r.stateFips, r.totalCents]))

  const balances = allStates.flatMap(({ fips }) => {
    const received = spendingMap.get(fips)
    const paidIn = taxMap.get(fips)
    if (received == null || paidIn == null) return []

    const net = received - paidIn
    const population = populationByFips.get(fips) ?? null
    const netPerCapita = population != null ? Math.round(net / population) : null

    return [{
      stateFips: fips,
      fiscalYear,
      totalReceivedCents: received,
      totalPaidInCents: paidIn,
      netCents: net,
      population,
      netPerCapitaCents: netPerCapita,
      computedAt: new Date(),
      spendingRunId: spendingRun.id,
      taxRunId: taxRun.id,
    }]
  })

  if (balances.length > 0) {
    await db
      .insert(stateBalances)
      .values(balances)
      .onConflictDoUpdate({
        target: [stateBalances.stateFips, stateBalances.fiscalYear],
        set: {
          totalReceivedCents: sql`excluded.total_received_cents`,
          totalPaidInCents: sql`excluded.total_paid_in_cents`,
          netCents: sql`excluded.net_cents`,
          population: sql`excluded.population`,
          netPerCapitaCents: sql`excluded.net_per_capita_cents`,
          computedAt: sql`excluded.computed_at`,
          spendingRunId: sql`excluded.spending_run_id`,
          taxRunId: sql`excluded.tax_run_id`,
        },
      })
  }

  return { fiscalYear, statesProcessed: balances.length }
}

async function getLatestPopulationByState(db: Db, fiscalYear: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ stateFips: rawPopulation.stateFips, population: rawPopulation.population })
    .from(rawPopulation)
    .where(sql`${rawPopulation.censusYear} <= ${fiscalYear}`)
    .orderBy(sql`${rawPopulation.censusYear} desc`)

  const seen = new Map<string, number>()
  for (const row of rows) {
    if (!seen.has(row.stateFips)) seen.set(row.stateFips, row.population)
  }
  return seen
}
