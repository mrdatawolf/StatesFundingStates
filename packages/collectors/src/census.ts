import { eq } from 'drizzle-orm'
import type { Db } from '@sfs/db'
import { ingestRuns, rawPopulation } from '@sfs/db'
import type { RawPopulationRecord, CollectorResult } from './types.js'

const CENSUS_API_BASE = 'https://api.census.gov/data'

// Supported decennial census years. Annual PEP estimates require a paid API subscription
// and the endpoint structure changes with each vintage. Decennial data is exact counts,
// freely available, and sufficient for per-capita federal funding ratios.
const SUPPORTED_YEARS = [2020] as const
type DecennialYear = typeof SUPPORTED_YEARS[number]

// Decennial endpoint and population variable per year.
// 2020: PL 94-171 Redistricting Data, P1_001N = Total Population
const DECENNIAL_CONFIG: Record<DecennialYear, { path: string; popVar: string }> = {
  2020: { path: 'dec/pl', popVar: 'P1_001N' },
}

// Precondition:  censusYear is a supported decennial year (currently: 2020)
// Precondition:  apiKey is a valid Census Bureau API key (required — Census returns HTML without one)
// Postcondition: rawPopulation rows written for all 50 states + DC
// Invariant:     population > 0 for every written row
export async function collectCensusPopulation(
  db: Db,
  censusYear: number,
  apiKey: string,
): Promise<CollectorResult> {
  if (!(SUPPORTED_YEARS as readonly number[]).includes(censusYear)) {
    throw new Error(
      `Precondition failed: censusYear must be one of ${SUPPORTED_YEARS.join(', ')}. ` +
      `Annual estimates are not yet supported.`,
    )
  }

  const [run] = await db
    .insert(ingestRuns)
    .values({ source: 'census', fiscalYear: censusYear, status: 'running', triggeredBy: 'api', startedAt: new Date() })
    .returning()

  if (!run) throw new Error('Failed to create ingest run')

  try {
    const records = await fetchDecennialPopulation(censusYear as DecennialYear, apiKey)

    if (records.length < 50) {
      throw new Error(`Postcondition failed: expected 50+ state records, got ${records.length}`)
    }

    await db.insert(rawPopulation).values(
      records.map((r) => ({ ...r, ingestRunId: run.id })),
    ).onConflictDoNothing()

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

async function fetchDecennialPopulation(
  censusYear: DecennialYear,
  apiKey: string,
): Promise<RawPopulationRecord[]> {
  const { path, popVar } = DECENNIAL_CONFIG[censusYear]
  const keyParam = apiKey ? `&key=${apiKey}` : ''
  const url = `${CENSUS_API_BASE}/${censusYear}/${path}?get=${popVar},NAME&for=state:*${keyParam}`

  const res = await fetch(url, { headers: { 'User-Agent': 'StatesFundingStates/1.0' } })
  const text = await res.text()

  if (text.trimStart().startsWith('<')) {
    const redacted = url.replace(keyParam, keyParam ? '&key=REDACTED' : '(no key)')
    throw new Error(
      `Census API returned HTML instead of JSON.\n` +
      `URL: ${redacted}\n` +
      `Ensure CENSUS_API_KEY is set in .env — Census requires a key for all requests.`,
    )
  }

  const data = JSON.parse(text) as string[][]
  const [header, ...dataRows] = data
  if (!header) throw new Error('Census API returned empty response')

  const popIdx = header.findIndex((h) => h === popVar)
  const stateIdx = header.findIndex((h) => h === 'state' || h === 'STATE')
  if (popIdx === -1 || stateIdx === -1) {
    throw new Error(`Census response missing expected columns. Got: ${header.join(', ')}`)
  }

  // FIPS codes above 56 are territories (Puerto Rico = 72, etc.) not in our states table
  return dataRows
    .map((row) => ({
      stateFips: row[stateIdx]?.padStart(2, '0') ?? '',
      censusYear,
      population: parseInt(row[popIdx] ?? '0', 10),
    }))
    .filter((r) => r.population > 0 && r.stateFips.length === 2 && parseInt(r.stateFips, 10) <= 56)
}
