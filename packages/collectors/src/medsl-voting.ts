import { eq } from 'drizzle-orm'
import type { Db } from '@sfs/db'
import { ingestRuns, rawVotingResults } from '@sfs/db'
import type { RawVotingRecord, CollectorResult } from './types.js'

// MEDSL 1976-2020 Presidential Election Data
// Download from: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/42MVDX
// File: "1976-2020-president.tab" (download as CSV/tab-separated)
//
// CSV columns used:
//   year, state_fips, party_simplified, writein, candidatevotes, totalvotes
//   party_simplified values: DEMOCRAT | REPUBLICAN | LIBERTARIAN | OTHER

// Precondition:  csvBuffer contains the MEDSL presidential CSV (UTF-8, comma or tab separated)
// Postcondition: one row per state per election year in raw_voting_results
export async function collectMedslVoting(
  db: Db,
  csvBuffer: Buffer,
): Promise<CollectorResult> {
  const records = parseMedslCsv(csvBuffer)

  if (records.length === 0) {
    throw new Error('Precondition failed: CSV produced no parseable records')
  }

  const years = [...new Set(records.map((r) => r.electionYear))].sort()
  // Use 0 as fiscal year placeholder; election data spans multiple years
  const fiscalYear = years[years.length - 1] ?? 0

  const [run] = await db
    .insert(ingestRuns)
    .values({
      source: 'medsl_voting',
      fiscalYear,
      status: 'running',
      triggeredBy: 'admin-upload',
      startedAt: new Date(),
    })
    .returning()

  if (!run) throw new Error('Failed to create ingest run')

  try {
    await db
      .insert(rawVotingResults)
      .values(records.map((r) => ({ ...r, ingestRunId: run.id })))
      .onConflictDoNothing()

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

function parseMedslCsv(csvBuffer: Buffer): RawVotingRecord[] {
  const text = csvBuffer.toString('utf-8')
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const [headerLine, ...dataLines] = lines
  if (!headerLine) throw new Error('CSV is empty')

  const sep = headerLine.includes('\t') ? '\t' : ','
  const header = headerLine.split(sep).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())

  const col = (name: string) => {
    const idx = header.indexOf(name)
    if (idx === -1) throw new Error(`MEDSL CSV missing expected column: "${name}"`)
    return idx
  }

  const yearIdx = col('year')
  const fipsIdx = col('state_fips')
  const partyIdx = col('party_simplified')
  const writeinIdx = col('writein')
  const candidateVotesIdx = col('candidatevotes')
  const totalVotesIdx = col('totalvotes')

  // Accumulate per (state_fips, year)
  type Bucket = { dem: number; rep: number; other: number; total: number }
  const buckets = new Map<string, Bucket>()

  for (const line of dataLines) {
    const cols = splitCsvLine(line, sep)
    const cell = (idx: number) => (cols[idx] ?? '').trim().replace(/^"|"$/g, '')

    // Skip write-in candidates; their votes are typically already included in totalvotes
    const writein = cell(writeinIdx).toUpperCase()
    if (writein === 'TRUE' || writein === '1') continue

    const yearStr = cell(yearIdx)
    const fipsStr = cell(fipsIdx)
    const party = cell(partyIdx).toUpperCase()
    const candidateVotes = parseInt(cell(candidateVotesIdx).replace(/,/g, ''), 10)
    const totalVotes = parseInt(cell(totalVotesIdx).replace(/,/g, ''), 10)

    if (!yearStr || !fipsStr) continue
    const year = parseInt(yearStr, 10)
    if (isNaN(year) || isNaN(candidateVotes) || candidateVotes < 0) continue

    // Zero-pad FIPS to 2 chars (CSV stores as integer: 1 → "01")
    const stateFips = fipsStr.padStart(2, '0')
    // Skip territories (FIPS > 56) and invalid codes
    if (parseInt(stateFips, 10) > 56 || parseInt(stateFips, 10) === 0) continue

    const key = `${stateFips}:${year}`
    const bucket = buckets.get(key) ?? { dem: 0, rep: 0, other: 0, total: 0 }

    if (party === 'DEMOCRAT') {
      bucket.dem += candidateVotes
    } else if (party === 'REPUBLICAN') {
      bucket.rep += candidateVotes
    } else {
      bucket.other += candidateVotes
    }

    // totalVotes is repeated on every row for the same state/year — take the max to avoid 0-row races
    if (!isNaN(totalVotes) && totalVotes > bucket.total) {
      bucket.total = totalVotes
    }

    buckets.set(key, bucket)
  }

  return Array.from(buckets.entries()).map(([key, b]) => {
    const [stateFips, yearStr] = key.split(':') as [string, string]
    return {
      stateFips,
      electionYear: parseInt(yearStr, 10),
      demVotes: b.dem,
      repVotes: b.rep,
      otherVotes: b.other,
      totalVotes: b.total,
    }
  })
}

// Handles quoted fields that may contain the delimiter character
function splitCsvLine(line: string, sep: string): string[] {
  if (sep === '\t') return line.split('\t')

  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === sep && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
