const BASE = '/api'

export interface StateBalance {
  stateFips: string
  stateName: string
  stateAbbr: string
  fiscalYear: number
  totalReceivedCents: number
  totalPaidInCents: number
  netCents: number
  population: number | null
  netPerCapitaCents: number | null
  computedAt: string
}

export interface IngestRun {
  id: string
  source: 'usa_spending' | 'irs_soi' | 'census' | 'medsl_voting'
  fiscalYear: number
  status: 'pending' | 'running' | 'complete' | 'failed'
  triggeredBy: string | null
  startedAt: string | null
  completedAt: string | null
  error: string | null
}

export interface CollectorResult {
  ingestRunId: string
  rowsWritten: number
}

export interface VotingResult {
  stateFips: string
  stateName: string
  stateAbbr: string
  electionYear: number
  demVotes: number
  repVotes: number
  otherVotes: number
  totalVotes: number
  demShare: number | null
  repShare: number | null
  lean: number | null  // (demVotes - repVotes) / totalVotes, range [-1, 1]
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getYears: () =>
    request<number[]>(`${BASE}/balances/years`),

  getBalances: (year?: number) =>
    request<StateBalance[]>(year != null ? `${BASE}/balances?year=${year}` : `${BASE}/balances`),

  fetchUsaSpending: (fiscalYear: number) =>
    request<CollectorResult>(`${BASE}/ingest/usa-spending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiscalYear }),
    }),

  uploadIrsSoi: (fiscalYear: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<CollectorResult>(`${BASE}/ingest/irs-soi?year=${fiscalYear}`, {
      method: 'POST',
      body: form,
    })
  },

  fetchCensus: (censusYear: number) =>
    request<CollectorResult>(`${BASE}/ingest/census`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ censusYear }),
    }),

  computeBalances: (fiscalYear: number) =>
    request<{ fiscalYear: number; statesProcessed: number }>(`${BASE}/ingest/compute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiscalYear }),
    }),

  scrapeIrsSoi: (fiscalYear: number) =>
    request<{
      scrape: { downloaded: number; skipped: number; failed: string[] }
      ingest: { ingestRunId: string; rowsWritten: number; parseErrors: string[] }
    }>(`${BASE}/ingest/irs-soi/scrape?year=${fiscalYear}`, { method: 'POST' }),

  getVotingYears: () =>
    request<number[]>(`${BASE}/voting/years`),

  getVoting: (electionYear: number) =>
    request<VotingResult[]>(`${BASE}/voting?year=${electionYear}`),

  scrapeMedslVoting: () =>
    request<{
      scrape: { downloaded: boolean; skipped: boolean; filePath: string }
      ingest: { ingestRunId: string; rowsWritten: number }
    }>(`${BASE}/ingest/medsl-voting/scrape`, { method: 'POST' }),

  getIngestRuns: () =>
    request<IngestRun[]>(`${BASE}/ingest/runs`),
}
