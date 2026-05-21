import { eq } from 'drizzle-orm'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { Db } from '@sfs/db'
import { ingestRuns, rawTaxReceipts, STATES_SEED } from '@sfs/db'
import type { RawTaxRecord, CollectorResult } from './types.js'

// Precondition:  fileBuffer is a valid IRS SOI Excel/CSV file for a single state and fiscal year
// Precondition:  fiscalYear matches the data in the file (caller's responsibility to verify)
// Precondition:  stateFips is a valid 2-digit FIPS code for the state this file belongs to
// Postcondition: ingest_run record exists with status='complete'; rawTaxReceipts rows written for parsed states
// Invariant:     all amountCents values are >= 0
export async function collectIrsSoi(
  db: Db,
  fiscalYear: number,
  fileBuffer: Buffer,
  mimeType: string,
  stateFips?: string,
): Promise<CollectorResult> {
  const [run] = await db
    .insert(ingestRuns)
    .values({ source: 'irs_soi', fiscalYear, status: 'running', triggeredBy: 'admin-upload', startedAt: new Date() })
    .returning()

  if (!run) throw new Error('Failed to create ingest run')

  try {
    const records = await parseIrsFile(fileBuffer, mimeType, fiscalYear, stateFips)

    if (records.length === 0) {
      throw new Error('Postcondition failed: parsed 0 records from IRS file — check file format')
    }

    await db.insert(rawTaxReceipts).values(
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

// Precondition:  filesDir contains .xlsx files named {stateabbr.lower}.xlsx (from downloadIrsSoiYear)
// Precondition:  all files in filesDir are IRS Data Book state files for fiscalYear
// Postcondition: single ingest_run created; rawTaxReceipts rows written for all parseable states
// Invariant:     parse errors for individual states are collected and returned, not thrown
export async function collectIrsSoiBatch(
  db: Db,
  fiscalYear: number,
  filesDir: string,
): Promise<CollectorResult & { parseErrors: string[] }> {
  const [run] = await db
    .insert(ingestRuns)
    .values({ source: 'irs_soi', fiscalYear, status: 'running', triggeredBy: 'auto-scrape', startedAt: new Date() })
    .returning()

  if (!run) throw new Error('Failed to create ingest run')

  const parseErrors: string[] = []
  const allRecords: RawTaxRecord[] = []

  // Build abbr → fips lookup from the seed data
  const abbrToFips = Object.fromEntries(
    STATES_SEED.map((s) => [s.abbreviation.toLowerCase(), s.fips]),
  )

  try {
    const files = (await readdir(filesDir)).filter((f) => f.endsWith('.xlsx'))
    if (files.length === 0) {
      throw new Error(`No .xlsx files found in ${filesDir}`)
    }

    for (const file of files) {
      const abbr = file.replace(/\.xlsx$/, '')
      const fips = abbrToFips[abbr]
      if (!fips) {
        parseErrors.push(`${file}: unknown state abbreviation`)
        continue
      }

      try {
        const buffer = await readFile(join(filesDir, file))
        const records = await parseIrsFile(
          buffer,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fiscalYear,
          fips,
        )
        allRecords.push(...records)
      } catch (err) {
        parseErrors.push(`${file}: ${String(err)}`)
      }
    }

    if (allRecords.length > 0) {
      await db.insert(rawTaxReceipts).values(
        allRecords.map((r) => ({ ...r, ingestRunId: run.id })),
      ).onConflictDoNothing()
    }

    await db
      .update(ingestRuns)
      .set({ status: 'complete', completedAt: new Date() })
      .where(eq(ingestRuns.id, run.id))

    return { ingestRunId: run.id, rowsWritten: allRecords.length, parseErrors }
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: 'failed', completedAt: new Date(), error: String(err) })
      .where(eq(ingestRuns.id, run.id))
    throw err
  }
}

// IRS SOI files vary by year. This parser handles the common CSV layout.
// When a new year's format differs, add a format branch here.
async function parseIrsFile(
  buffer: Buffer,
  mimeType: string,
  fiscalYear: number,
  stateFips?: string,
): Promise<RawTaxRecord[]> {
  let rows: unknown[][]

  if (mimeType === 'text/csv' || mimeType === 'application/csv') {
    rows = parseCsv(buffer.toString('utf8'))
  } else {
    const xlsx = await import('xlsx')
    const workbook = xlsx.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
    if (!sheet) throw new Error('Excel file has no sheets')
    rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
  }

  if (!stateFips) {
    // Single-file upload without state specified — return empty and log structure
    const preview = rows.slice(0, 8).map((r, i) => `row ${i}: ${JSON.stringify(r)}`).join('\n')
    throw new Error(
      `stateFips is required to parse IRS SOI file. File structure preview:\n${preview}`,
    )
  }

  return extractTaxRecords(rows, stateFips, fiscalYear)
}

function parseCsv(text: string): unknown[][] {
  return text.trim().split('\n').map((line) => line.split(',').map((c) => c.trim()))
}

type TaxType = 'individual_income' | 'corporate' | 'payroll' | 'excise' | 'estate'

// IRS Data Book state file layout (observed FY2024):
//   row 0: state name + "Fiscal Year YYYY"
//   row 1: column headers — col 0 is the row label; col 3 is "Internal Revenue gross collections (thousands of dollars)"
//   row 2: column numbers "(1)", "(2)", ...
//   row 3+: data rows by tax type
//
// "Individual income tax and employment taxes" bundles individual income + payroll into one row;
// stored under individual_income since no separate breakdown is available at state level.
// Estate and gift tax rows both map to the 'estate' bucket and are summed.
function extractTaxRecords(rows: unknown[][], stateFips: string, fiscalYear: number): RawTaxRecord[] {
  // Header row contains "gross collection" in the amounts column header
  const headerIdx = rows.findIndex((row) =>
    row.some((cell) => typeof cell === 'string' && cell.toLowerCase().includes('gross collection')),
  )

  if (headerIdx === -1) {
    const preview = rows
      .slice(0, 10)
      .map((r, i) => `  row ${i}: ${JSON.stringify(r)}`)
      .join('\n')
    throw new Error(
      `Cannot find "gross collection" header in state FIPS ${stateFips}. First 10 rows:\n${preview}`,
    )
  }

  const headerRow = rows[headerIdx] as unknown[]
  const grossIdx = headerRow.findIndex(
    (c) => typeof c === 'string' && c.toLowerCase().includes('gross collection'),
  )
  const amountIdx = grossIdx >= 0 ? grossIdx : 3  // col 3 per observed file structure

  // Most-specific match first; stops at first match so "individual income tax and employment"
  // takes priority over the narrower "individual income tax" or "employment tax" entries
  const LABEL_MAP: Array<{ match: string; taxType: TaxType }> = [
    { match: 'individual income tax and employment', taxType: 'individual_income' },
    { match: 'individual income tax', taxType: 'individual_income' },
    { match: 'employment tax', taxType: 'payroll' },
    { match: 'corporation income', taxType: 'corporate' },
    { match: 'excise', taxType: 'excise' },
    { match: 'estate tax', taxType: 'estate' },
    { match: 'gift tax', taxType: 'estate' },
  ]

  // Rows to skip regardless of label keywords above
  const SKIP_SUBSTRINGS = ['total', 'estate and trust income', 'tax-exempt']

  // Accumulate by taxType so estate + gift tax sum into one row (unique constraint requirement)
  const acc = new Map<TaxType, number>()

  for (const row of rows.slice(headerIdx + 1)) {
    const label = (row as unknown[])[0]
    if (typeof label !== 'string') continue
    const labelLower = label.toLowerCase().trim()

    if (SKIP_SUBSTRINGS.some((s) => labelLower.includes(s))) continue

    let taxType: TaxType | undefined
    for (const { match, taxType: t } of LABEL_MAP) {
      if (labelLower.includes(match)) {
        taxType = t
        break
      }
    }
    if (!taxType) continue

    const raw = (row as unknown[])[amountIdx]
    if (typeof raw !== 'number' || isNaN(raw) || raw < 0) continue

    acc.set(taxType, (acc.get(taxType) ?? 0) + raw)
  }

  // IRS amounts in thousands of dollars → ×1000 → dollars → ×100 → cents
  return Array.from(acc.entries()).map(([taxType, totalThousands]) => ({
    stateFips,
    fiscalYear,
    taxType,
    amountCents: Math.round(totalThousands * 1000 * 100),
  }))
}
