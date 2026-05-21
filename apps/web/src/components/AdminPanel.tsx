import { useState, useRef, useCallback } from 'react'
import { api, type IngestRun } from '../api'

interface Props {
  onDataChanged: () => void
}

type ActionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

function useAction(fn: () => Promise<unknown>) {
  const [state, setState] = useState<ActionState>({ status: 'idle' })

  const run = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const result = await fn()
      setState({ status: 'success', message: JSON.stringify(result) })
    } catch (err) {
      setState({ status: 'error', message: String(err) })
    }
  }, [fn])

  return { state, run }
}

function StatusLine({ state }: { state: ActionState }) {
  if (state.status === 'idle') return null
  if (state.status === 'loading') return <p style={s.statusLoading}>Running…</p>
  if (state.status === 'success') return <p style={s.statusOk}>{state.message}</p>
  return <p style={s.statusErr}>{state.message}</p>
}

function SectionHeader({ title }: { title: string }) {
  return <h3 style={s.sectionHeader}>{title}</h3>
}

export default function AdminPanel({ onDataChanged }: Props) {
  const [open, setOpen] = useState(true)
  // IRS SOI lags 12-18 months; currentYear - 2 is the safest year with all three sources complete
  const defaultYear = new Date().getFullYear() - 2

  const [usaYear, setUsaYear] = useState(defaultYear)
  const [irsScrapeYear, setIrsScrapeYear] = useState(defaultYear)
  const [irsYear, setIrsYear] = useState(defaultYear)
  const [irsFile, setIrsFile] = useState<File | null>(null)
  const irsFileRef = useRef<HTMLInputElement>(null)
  const [censusYear, setCensusYear] = useState(2020)
  const [computeYear, setComputeYear] = useState(defaultYear)
  const [runs, setRuns] = useState<IngestRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  const usa = useAction(useCallback(async () => {
    const r = await api.fetchUsaSpending(usaYear)
    onDataChanged()
    return r
  }, [usaYear, onDataChanged]))

  const irsScrape = useAction(useCallback(async () => {
    const r = await api.scrapeIrsSoi(irsScrapeYear)
    onDataChanged()
    return r
  }, [irsScrapeYear, onDataChanged]))

  const irs = useAction(useCallback(async () => {
    if (!irsFile) throw new Error('Select a file first')
    const r = await api.uploadIrsSoi(irsYear, irsFile)
    onDataChanged()
    return r
  }, [irsYear, irsFile, onDataChanged]))

  const census = useAction(useCallback(async () => {
    const r = await api.fetchCensus(censusYear)
    onDataChanged()
    return r
  }, [censusYear, onDataChanged]))

  const compute = useAction(useCallback(async () => {
    const r = await api.computeBalances(computeYear)
    onDataChanged()
    return r
  }, [computeYear, onDataChanged]))

  const refreshRuns = async () => {
    setRunsLoading(true)
    try {
      setRuns(await api.getIngestRuns())
    } finally {
      setRunsLoading(false)
    }
  }

  return (
    <aside style={{ ...s.panel, width: open ? 300 : 40 }}>
      <button style={s.toggle} onClick={() => setOpen((o) => !o)} title={open ? 'Collapse' : 'Expand'}>
        {open ? '›' : '‹'}
      </button>

      {open && (
        <div style={s.inner}>
          <h2 style={s.title}>Admin</h2>

          {/* USASpending */}
          <SectionHeader title="USASpending.gov" />
          <div style={s.row}>
            <label style={s.label}>Fiscal year</label>
            <input style={s.input} type="number" value={usaYear} onChange={(e) => setUsaYear(+e.target.value)} />
          </div>
          <button style={s.btn} disabled={usa.state.status === 'loading'} onClick={usa.run}>
            Fetch spending data
          </button>
          <StatusLine state={usa.state} />

          {/* IRS SOI — auto-download */}
          <SectionHeader title="IRS Statistics of Income" />
          <p style={s.hint}>Auto-download downloads all 51 state files from IRS.gov (FY2020+).</p>
          <div style={s.row}>
            <label style={s.label}>Fiscal year</label>
            <input style={s.input} type="number" min={2020} value={irsScrapeYear} onChange={(e) => setIrsScrapeYear(+e.target.value)} />
          </div>
          <button style={{ ...s.btn, ...s.btnPrimary }} disabled={irsScrape.state.status === 'loading'} onClick={irsScrape.run}>
            {irsScrape.state.status === 'loading' ? 'Downloading…' : 'Auto-download & ingest'}
          </button>
          <StatusLine state={irsScrape.state} />

          {/* IRS SOI — manual single-state upload */}
          <p style={{ ...s.hint, marginTop: 12 }}>Or upload a single-state file manually:</p>
          <div style={s.row}>
            <label style={s.label}>Fiscal year</label>
            <input style={s.input} type="number" value={irsYear} onChange={(e) => setIrsYear(+e.target.value)} />
          </div>
          <div style={s.row}>
            <label style={s.label}>File (.xlsx)</label>
            <input
              ref={irsFileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ fontSize: 11 }}
              onChange={(e) => setIrsFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button style={s.btn} disabled={irs.state.status === 'loading' || !irsFile} onClick={irs.run}>
            Upload file
          </button>
          <StatusLine state={irs.state} />

          {/* Census */}
          <SectionHeader title="Census Bureau" />
          <p style={s.hint}>Decennial census (exact counts). Annual PEP estimates not yet supported.</p>
          <div style={s.row}>
            <label style={s.label}>Census year</label>
            <select style={s.input} value={censusYear} onChange={(e) => setCensusYear(+e.target.value)}>
              <option value={2020}>2020</option>
            </select>
          </div>
          <button style={s.btn} disabled={census.state.status === 'loading'} onClick={census.run}>
            Fetch population
          </button>
          <StatusLine state={census.state} />

          {/* Compute */}
          <SectionHeader title="Compute Balances" />
          <p style={s.hint}>Requires completed spending + tax runs for the year.</p>
          <div style={s.row}>
            <label style={s.label}>Fiscal year</label>
            <input style={s.input} type="number" value={computeYear} onChange={(e) => setComputeYear(+e.target.value)} />
          </div>
          <button style={{ ...s.btn, ...s.btnPrimary }} disabled={compute.state.status === 'loading'} onClick={compute.run}>
            Compute
          </button>
          <StatusLine state={compute.state} />

          {/* Run history */}
          <SectionHeader title="Ingest Runs" />
          <button style={{ ...s.btn, marginBottom: 8 }} onClick={refreshRuns} disabled={runsLoading}>
            {runsLoading ? 'Loading…' : 'Refresh'}
          </button>
          {runs.length > 0 && (
            <table style={s.runTable}>
              <thead>
                <tr>
                  <th style={s.th}>Source</th>
                  <th style={s.th}>Year</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td style={s.td}>{r.source}</td>
                    <td style={s.td}>{r.fiscalYear}</td>
                    <td style={{ ...s.td, color: statusColor(r.status) }}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </aside>
  )
}

function statusColor(status: IngestRun['status']) {
  if (status === 'complete') return '#198754'
  if (status === 'failed') return '#dc3545'
  if (status === 'running') return '#0d6efd'
  return '#6c757d'
}

const s = {
  panel: {
    position: 'relative' as const,
    borderLeft: '1px solid #dee2e6',
    background: '#f8f9fa',
    minHeight: '100vh',
    flexShrink: 0,
    transition: 'width 0.2s',
    overflow: 'hidden',
  },
  toggle: {
    position: 'absolute' as const,
    top: 12,
    left: 8,
    background: 'none',
    border: '1px solid #ccc',
    borderRadius: 4,
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: 16,
    lineHeight: 1,
  },
  inner: { padding: '12px 16px 24px', paddingTop: 44 },
  title: { margin: '0 0 16px', fontSize: 16, fontWeight: 700 },
  sectionHeader: {
    margin: '20px 0 8px',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#6c757d',
    borderBottom: '1px solid #dee2e6',
    paddingBottom: 4,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  label: { fontSize: 12, color: '#495057', width: 80, flexShrink: 0 },
  input: { fontSize: 13, padding: '3px 6px', border: '1px solid #ced4da', borderRadius: 4, width: 80 },
  btn: {
    fontSize: 13,
    padding: '5px 12px',
    border: '1px solid #ced4da',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
    width: '100%',
    marginBottom: 4,
  },
  btnPrimary: { background: '#0d6efd', color: '#fff', border: '1px solid #0d6efd' },
  hint: { fontSize: 11, color: '#6c757d', margin: '0 0 6px' },
  statusOk: { fontSize: 11, color: '#198754', wordBreak: 'break-all' as const, margin: '2px 0' },
  statusErr: { fontSize: 11, color: '#dc3545', wordBreak: 'break-all' as const, margin: '2px 0' },
  statusLoading: { fontSize: 11, color: '#6c757d', margin: '2px 0' },
  runTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 },
  th: { textAlign: 'left' as const, padding: '2px 4px', borderBottom: '1px solid #dee2e6', color: '#6c757d' },
  td: { padding: '3px 4px', borderBottom: '1px solid #f0f0f0' },
}
