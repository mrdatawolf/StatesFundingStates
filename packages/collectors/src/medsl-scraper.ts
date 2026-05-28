import { mkdir, writeFile, access } from 'fs/promises'
import { join } from 'path'

// MIT Election Data + Science Lab — Presidential Election Data 1976–present
// Dataset: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/42MVDX
// We discover the file ID at runtime via the Dataverse API so we're not coupled to a hardcoded ID.
const DATAVERSE_API = 'https://dataverse.harvard.edu/api'
const DATASET_DOI = 'doi:10.7910/DVN/42MVDX'
const OUTPUT_FILENAME = 'president.tab'

export interface MedslScrapeResult {
  downloaded: boolean
  skipped: boolean   // file already on disk
  filePath: string
}

// Precondition:  outputDir can be created if it doesn't exist
// Postcondition: presidential election tab file saved to {outputDir}/president.tab
// Invariant:     existing file is never overwritten (idempotent re-runs skip it)
export async function downloadMedslVoting(outputDir: string): Promise<MedslScrapeResult> {
  await mkdir(outputDir, { recursive: true })

  const filePath = join(outputDir, OUTPUT_FILENAME)
  const exists = await access(filePath).then(() => true).catch(() => false)
  if (exists) {
    return { downloaded: false, skipped: true, filePath }
  }

  const fileId = await resolvePresidentialFileId()
  const downloadUrl = `${DATAVERSE_API}/access/datafile/${fileId}`

  const res = await fetch(downloadUrl, { headers: { 'User-Agent': 'StatesFundingStates/1.0' } })
  if (!res.ok) {
    throw new Error(`Failed to download MEDSL presidential file: HTTP ${res.status} from ${downloadUrl}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  await writeFile(filePath, buffer)

  return { downloaded: true, skipped: false, filePath }
}

// Queries Harvard Dataverse to find the file ID for the presidential election CSV/tab file.
// The file is named something like "1976-2020-president.tab" or "1976-2024-president.tab".
async function resolvePresidentialFileId(): Promise<number> {
  const url = `${DATAVERSE_API}/datasets/:persistentId/?persistentId=${DATASET_DOI}`
  const res = await fetch(url, { headers: { 'User-Agent': 'StatesFundingStates/1.0' } })
  if (!res.ok) {
    throw new Error(`Dataverse metadata request failed: HTTP ${res.status}`)
  }

  const meta = await res.json() as DataverseDatasetResponse
  const files = meta.data?.latestVersion?.files ?? []

  if (files.length === 0) {
    throw new Error('Dataverse returned no files for the MEDSL dataset. The dataset may have moved or require authentication.')
  }

  // Match the presidential data file — it contains "president" but not "county" (avoid county-level files)
  const presidentialFile = files.find((f) => {
    const name = (f.label ?? f.dataFile.filename).toLowerCase()
    return name.includes('president') && !name.includes('county')
  })

  if (!presidentialFile) {
    const names = files.map((f) => f.label ?? f.dataFile.filename).join(', ')
    throw new Error(`Could not find presidential state-level file in MEDSL dataset. Found: ${names}`)
  }

  return presidentialFile.dataFile.id
}

interface DataverseDatasetResponse {
  data?: {
    latestVersion?: {
      files?: Array<{
        label: string
        dataFile: { id: number; filename: string }
      }>
    }
  }
}
