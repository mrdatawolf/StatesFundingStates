import { useEffect, useState, useCallback, useMemo } from 'react'
import { api, type StateBalance } from './api'
import AdminPanel from './components/AdminPanel'
import ChartsPanel from './components/ChartsPanel'

function formatDollars(cents: number): string {
  const billions = Math.abs(cents) / 100 / 1_000_000_000
  const sign = cents < 0 ? '-' : '+'
  return `${sign}$${billions.toFixed(1)}B`
}

function formatDollarsPerCapita(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100)
  const sign = cents < 0 ? '-' : '+'
  return `${sign}$${dollars.toLocaleString()}`
}

type SortKey = 'stateName' | 'totalReceivedCents' | 'totalPaidInCents' | 'netCents' | 'netPerCapitaCents'
type SortDir = 'asc' | 'desc'

export default function App() {
  const [balances, setBalances] = useState<StateBalance[]>([])
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('netCents')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const loadYears = useCallback(async () => {
    try {
      const data = await api.getYears()
      setYears(data)
      if (data[0] != null && selectedYear == null) setSelectedYear(data[0])
    } catch {
      setError('Could not load available years')
    }
  }, [selectedYear])

  const loadBalances = useCallback(async () => {
    if (selectedYear == null) return
    setLoading(true)
    try {
      setBalances(await api.getBalances(selectedYear))
    } catch {
      setError('Could not load balance data')
    } finally {
      setLoading(false)
    }
  }, [selectedYear])

  const sortedBalances = useMemo(() => {
    return [...balances].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [balances, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const handleDataChanged = useCallback(async () => {
    await loadYears()
    await loadBalances()
  }, [loadYears, loadBalances])

  useEffect(() => { loadYears() }, [])
  useEffect(() => { loadBalances() }, [selectedYear])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ flex: 1, padding: '1.5rem', overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ marginTop: 0, marginBottom: '0.25rem' }}>States Funding States</h1>
        <p style={{ color: '#555', marginTop: 0, marginBottom: '0.75rem', fontSize: 13 }}>
          How much each state pays into the federal government vs. how much it receives back.
          <span style={{ color: '#c0392b' }}> Red</span> = net recipient.
          <span style={{ color: '#27ae60' }}> Green</span> = net donor.
        </p>

        {years.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="year-select">Fiscal Year: </label>
            <select
              id="year-select"
              value={selectedYear ?? ''}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p style={{ color: 'red' }}>{error}</p>}
        {loading && <p>Loading…</p>}

        {!loading && balances.length === 0 && !error && (
          <p style={{ color: '#888' }}>
            No data yet. Use the Admin panel to ingest spending and tax data, then compute balances.
          </p>
        )}

        {balances.length > 0 && (
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
            <table style={{ width: '50%', flexShrink: 0, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                  {([
                    ['State', 'stateName'],
                    ['Received', 'totalReceivedCents'],
                    ['Paid In', 'totalPaidInCents'],
                    ['Net to State', 'netCents'],
                    ['Per Capita', 'netPerCapitaCents'],
                  ] as [string, SortKey][]).map(([label, key]) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      style={{ padding: '0.25rem 0.4rem', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    >
                      {label} {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : <span style={{ color: '#ccc' }}>▼</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedBalances.map((b) => (
                  <tr
                    key={b.stateFips}
                    style={{
                      borderBottom: '1px solid #eee',
                      background: b.netCents > 0 ? '#fff5f5' : '#f0fff4',
                    }}
                  >
                    <td style={{ padding: '0.2rem 0.4rem' }}>{b.stateName} ({b.stateAbbr})</td>
                    <td style={{ padding: '0.2rem 0.4rem' }}>{formatDollars(b.totalReceivedCents)}</td>
                    <td style={{ padding: '0.2rem 0.4rem' }}>{formatDollars(b.totalPaidInCents)}</td>
                    <td style={{ padding: '0.2rem 0.4rem', fontWeight: 'bold' }}>{formatDollars(b.netCents)}</td>
                    <td style={{ padding: '0.2rem 0.4rem' }}>
                      {b.netPerCapitaCents != null ? formatDollarsPerCapita(b.netPerCapitaCents) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ flex: 1, minWidth: 0 }}>
              <ChartsPanel balances={balances} />
            </div>
          </div>
        )}
      </main>

      <AdminPanel onDataChanged={handleDataChanged} />
    </div>
  )
}
