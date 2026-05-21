import { eq } from 'drizzle-orm'
import type { Db } from '@sfs/db'
import { ingestRuns, rawFederalSpending } from '@sfs/db'
import type { RawSpendingRecord, CollectorResult } from './types.js'

const BASE_URL = 'https://api.usaspending.gov/api/v2'

// Precondition:  fiscalYear is in [1990..currentYear]
// Postcondition: ingest_run record exists with status='complete'; rawFederalSpending rows written for all available states
// Invariant:     all amountCents values are >= 0
export async function collectUsaSpending(
  db: Db,
  fiscalYear: number,
): Promise<CollectorResult> {
  const currentYear = new Date().getFullYear()
  if (fiscalYear < 1990 || fiscalYear > currentYear) {
    throw new Error(`Precondition failed: fiscalYear must be between 1990 and ${currentYear}`)
  }

  const [run] = await db
    .insert(ingestRuns)
    .values({ source: 'usa_spending', fiscalYear, status: 'running', triggeredBy: 'api', startedAt: new Date() })
    .returning()

  if (!run) throw new Error('Failed to create ingest run')

  try {
    const records = await fetchSpendingByState(fiscalYear)

    if (records.length > 0) {
      await db.insert(rawFederalSpending).values(
        records.map((r) => ({ ...r, ingestRunId: run.id })),
      ).onConflictDoNothing()
    }

    await db
      .update(ingestRuns)
      .set({ status: 'complete', completedAt: new Date() })
      .where(eq(ingestRuns.id, run.id))

    return { ingestRunId: run.id, rowsWritten: records.length }
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: 'failed', completedAt: new Date(), error: String(err) })
      .where(eq(ingestRuns.id, run.id))
    throw err
  }
}

// USASpending returns 2-letter postal abbreviations in shape_code, not FIPS codes
const ABBR_TO_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
  DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17',
  IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
  MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31',
  NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38',
  OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46',
  TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54',
  WI: '55', WY: '56',
}

async function fetchSpendingByState(fiscalYear: number): Promise<RawSpendingRecord[]> {
  const response = await fetch(`${BASE_URL}/search/spending_by_geography/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: 'place_of_performance',
      geo_layer: 'state',
      filters: {
        time_period: [{ start_date: `${fiscalYear - 1}-10-01`, end_date: `${fiscalYear}-09-30` }],
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`USASpending API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { results: Array<{ shape_code: string; aggregated_amount: number }> }
  const records: RawSpendingRecord[] = []

  for (const result of data.results) {
    const fips = ABBR_TO_FIPS[result.shape_code]
    if (!fips) continue // skip territories (PR, GU, VI, etc.) not in our states table

    const amountCents = Math.round(result.aggregated_amount * 100)
    if (amountCents < 0) continue

    records.push({
      stateFips: fips,
      fiscalYear,
      category: 'grants', // USASpending totals; split by category in a future iteration
      amountCents,
    })
  }

  return records
}
