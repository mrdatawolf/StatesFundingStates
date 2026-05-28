import { mkdir, writeFile, access } from 'fs/promises'
import { join } from 'path'

// MIT Election Data + Science Lab — Presidential Election Data 1976–present
// Dataset: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/42MVDX
//
// Download flow:
//   1. POST /api/access/datafile/{id} with guestbook JSON → returns a signed download URL
//   2. GET the signed URL → actual file bytes
//
// Requires a free Harvard Dataverse API key in DATAVERSE_API_KEY env var:
//   1. Register at https://dataverse.harvard.edu
//   2. Go to Account → API Token → Generate Token
//   3. Add DATAVERSE_API_KEY=<token> to .env and restart the API server
const DATAVERSE_API = 'https://dataverse.harvard.edu/api'
const DATASET_DOI = 'doi:10.7910/DVN/42MVDX'
const OUTPUT_FILENAME = 'president.tab'

export interface MedslScrapeResult {
  downloaded: boolean
  skipped: boolean   // file already on disk
  filePath: string
}

// Precondition:  DATAVERSE_API_KEY env var is set (free account at dataverse.harvard.edu)
// Precondition:  outputDir can be created if it doesn't exist
// Postcondition: presidential election tab file saved to {outputDir}/president.tab
// Invariant:     existing file is never overwritten (idempotent re-runs skip it)
export async function downloadMedslVoting(outputDir: string): Promise<MedslScrapeResult> {
  const apiKey = process.env['DATAVERSE_API_KEY']
  if (!apiKey) {
    throw new Error('DATAVERSE_API_KEY is not set — restart the API server after adding it to .env')
  }

  await mkdir(outputDir, { recursive: true })

  const filePath = join(outputDir, OUTPUT_FILENAME)
  const exists = await access(filePath).then(() => true).catch(() => false)
  if (exists) {
    return { downloaded: false, skipped: true, filePath }
  }

  const { fileId, datasetId } = await resolvePresidentialFile(apiKey)

  // Step 1: POST with guestbook response to obtain a signed download URL
  const guestbookRes = await fetch(`${DATAVERSE_API}/access/datafile/${fileId}`, {
    method: 'POST',
    headers: {
      'User-Agent': 'StatesFundingStates/1.0',
      'X-Dataverse-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      datasetId,
      name: 'StatesFundingStates',
      email: 'anonymous@example.com',
      institution: '',
      position: '',
      customQuestions: [],
    }),
  })

  if (!guestbookRes.ok) {
    const body = await guestbookRes.text().catch(() => '')
    throw new Error(`Dataverse guestbook POST failed: HTTP ${guestbookRes.status} — ${body}`)
  }

  const guestbookJson = await guestbookRes.json() as { status: string; data?: { signedUrl?: string } }
  const signedUrl = guestbookJson.data?.signedUrl
  if (!signedUrl) {
    throw new Error(`Dataverse guestbook response missing signedUrl: ${JSON.stringify(guestbookJson)}`)
  }

  // Step 2: GET the signed URL to download the file
  const fileRes = await fetch(signedUrl, {
    headers: { 'User-Agent': 'StatesFundingStates/1.0' },
  })
  if (!fileRes.ok) {
    throw new Error(`Dataverse signed URL download failed: HTTP ${fileRes.status}`)
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer())
  await writeFile(filePath, buffer)

  return { downloaded: true, skipped: false, filePath }
}

// Queries Harvard Dataverse metadata to get the file ID and dataset ID for the presidential file.
async function resolvePresidentialFile(apiKey: string): Promise<{ fileId: number; datasetId: number }> {
  const url = `${DATAVERSE_API}/datasets/:persistentId/?persistentId=${DATASET_DOI}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'StatesFundingStates/1.0',
      'X-Dataverse-key': apiKey,
    },
  })
  if (!res.ok) {
    throw new Error(`Dataverse metadata request failed: HTTP ${res.status}`)
  }

  const meta = await res.json() as DataverseDatasetResponse
  const datasetId = meta.data?.id
  const files = meta.data?.latestVersion?.files ?? []

  if (!datasetId || files.length === 0) {
    throw new Error('Dataverse returned no dataset ID or files for the MEDSL dataset.')
  }

  // Match the state-level presidential file — contains "president" but not "county"
  const presidentialFile = files.find((f) => {
    const name = (f.label ?? f.dataFile.filename).toLowerCase()
    return name.includes('president') && !name.includes('county')
  })

  if (!presidentialFile) {
    const names = files.map((f) => f.label ?? f.dataFile.filename).join(', ')
    throw new Error(`Could not find presidential state-level file in MEDSL dataset. Found: ${names}`)
  }

  return { fileId: presidentialFile.dataFile.id, datasetId }
}

interface DataverseDatasetResponse {
  data?: {
    id?: number
    latestVersion?: {
      files?: Array<{
        label: string
        dataFile: { id: number; filename: string }
      }>
    }
  }
}
