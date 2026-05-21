import { mkdir, writeFile, access } from 'fs/promises'
import { join } from 'path'
import { STATES_SEED } from '@sfs/db'

// IRS Data Book state files follow the pattern: {YY}db{statenamelowercase}.xlsx
// e.g. FY2024 Alabama → 24dbalabama.xlsx, DC → 24dbdistrictofcolumbia.xlsx
const IRS_SOI_BASE = 'https://www.irs.gov/pub/irs-soi'

export interface ScrapeResult {
  downloaded: number
  skipped: number  // file already on disk
  failed: string[] // "AL (HTTP 404)", "MT (network error)", etc.
}

// Precondition:  fiscalYear is in [2020..currentYear] — IRS Data Book uses this URL format from ~FY2020
// Postcondition: outputDir exists; one .xlsx per successfully fetched state written as {abbr.lower}.xlsx
// Invariant:     existing files are never overwritten (idempotent re-runs skip already-downloaded files)
export async function downloadIrsSoiYear(
  fiscalYear: number,
  outputDir: string,
): Promise<ScrapeResult> {
  await mkdir(outputDir, { recursive: true })

  const yy = String(fiscalYear).slice(-2)
  let downloaded = 0
  let skipped = 0
  const failed: string[] = []

  for (const state of STATES_SEED) {
    const slug = state.name.toLowerCase().replace(/\s+/g, '')
    const url = `${IRS_SOI_BASE}/${yy}db${slug}.xlsx`
    const filePath = join(outputDir, `${state.abbreviation.toLowerCase()}.xlsx`)

    const exists = await access(filePath).then(() => true).catch(() => false)
    if (exists) {
      skipped++
      continue
    }

    try {
      const response = await fetch(url)
      if (!response.ok) {
        failed.push(`${state.abbreviation} (HTTP ${response.status})`)
        continue
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      await writeFile(filePath, buffer)
      downloaded++
    } catch (err) {
      failed.push(`${state.abbreviation} (${String(err)})`)
    }
  }

  return { downloaded, skipped, failed }
}
