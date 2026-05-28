import { useEffect, useState, useCallback, useMemo } from 'react'
import { api, type StateBalance, type VotingResult } from './api'
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

function fmtLean(lean: number | null): string {
  if (lean == null) return '—'
  const pct = (Math.abs(lean) * 100).toFixed(1)
  if (lean > 0.005)  return `D+${pct}%`
  if (lean < -0.005) return `R+${pct}%`
  return 'Even'
}

function leanCategory(lean: number | null): 'republican' | 'swing' | 'democrat' | null {
  if (lean == null) return null
  if (lean <= -0.10) return 'republican'
  if (lean >=  0.10) return 'democrat'
  return 'swing'
}

type SortKey = 'stateName' | 'totalReceivedCents' | 'totalPaidInCents' | 'netCents' | 'netPerCapitaCents'
type SortDir = 'asc' | 'desc'
type PartyFilter = 'all' | 'republican' | 'swing' | 'democrat'

export default function App() {
  const [balances, setBalances] = useState<StateBalance[]>([])
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('netCents')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [voting, setVoting] = useState<VotingResult[]>([])
  const [votingYears, setVotingYears] = useState<number[]>([])
  const [selectedVotingYear, setSelectedVotingYear] = useState<number | null>(null)
  const [partyFilter, setPartyFilter] = useState<PartyFilter>('all')
  const [mapColorMode, setMapColorMode] = useState<'financial' | 'political'>('financial')

  const loadYears = useCallback(async () => {
    try {
      const [balYears, voteYears] = await Promise.all([api.getYears(), api.getVotingYears()])
      setYears(balYears)
      setVotingYears(voteYears)
      if (balYears[0] != null && selectedYear == null) setSelectedYear(balYears[0])
      if (voteYears[0] != null && selectedVotingYear == null) setSelectedVotingYear(voteYears[0])
    } catch {
      setError('Could not load available years')
    }
  }, [selectedYear, selectedVotingYear])

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

  const loadVoting = useCallback(async () => {
    if (selectedVotingYear == null) return
    try {
      setVoting(await api.getVoting(selectedVotingYear))
    } catch {
      // Voting data is optional — don't error-block the main view
    }
  }, [selectedVotingYear])

  const voteByFips = useMemo(() => new Map(voting.map((v) => [v.stateFips, v])), [voting])

  const filteredBalances = useMemo(() => {
    if (partyFilter === 'all') return balances
    return balances.filter((b) => {
      const v = voteByFips.get(b.stateFips)
      return leanCategory(v?.lean ?? null) === partyFilter
    })
  }, [balances, partyFilter, voteByFips])

  const sortedBalances = useMemo(() => {
    return [...filteredBalances].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredBalances, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const handleDataChanged = useCallback(async () => {
    await loadYears()
    await loadBalances()
    await loadVoting()
  }, [loadYears, loadBalances, loadVoting])

  useEffect(() => { loadYears() }, [])
  useEffect(() => { loadBalances() }, [selectedYear])
  useEffect(() => { loadVoting() }, [selectedVotingYear])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ flex: 1, padding: '1.5rem', overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <img src="/logo.png" alt="States Funding States logo" style={{ width: 40, height: 40, flexShrink: 0 }} />
          <h1 style={{ margin: 0 }}>States Funding States</h1>
        </div>
        <p style={{ color: '#555', marginTop: 0, marginBottom: '0.75rem', fontSize: 13 }}>
          How much each state pays into the federal government vs. how much it receives back.
          <span style={{ color: '#c0392b' }}> Red</span> = net recipient.
          <span style={{ color: '#27ae60' }}> Green</span> = net donor.
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          {years.length > 0 && (
            <div>
              <label htmlFor="year-select" style={{ fontSize: 13, marginRight: 4 }}>Fiscal Year:</label>
              <select
                id="year-select"
                value={selectedYear ?? ''}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          {votingYears.length > 0 && (
            <div>
              <label htmlFor="voting-year-select" style={{ fontSize: 13, marginRight: 4 }}>Election Year:</label>
              <select
                id="voting-year-select"
                value={selectedVotingYear ?? ''}
                onChange={(e) => setSelectedVotingYear(parseInt(e.target.value, 10))}
              >
                {votingYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="party-filter" style={{ fontSize: 13, marginRight: 4 }}>Party:</label>
            <select
              id="party-filter"
              value={partyFilter}
              onChange={(e) => setPartyFilter(e.target.value as PartyFilter)}
            >
              <option value="all">All states</option>
              <option value="republican">Republican</option>
              <option value="swing">Swing</option>
              <option value="democrat">Democrat</option>
            </select>
          </div>
          {voting.length > 0 && (
            <div>
              <label htmlFor="map-color" style={{ fontSize: 13, marginRight: 4 }}>Map color:</label>
              <select
                id="map-color"
                value={mapColorMode}
                onChange={(e) => setMapColorMode(e.target.value as 'financial' | 'political')}
              >
                <option value="financial">Financial (red/green)</option>
                <option value="political">Political lean (red/purple/blue)</option>
              </select>
            </div>
          )}
        </div>

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
                  {voting.length > 0 && (
                    <th style={{ padding: '0.25rem 0.4rem', whiteSpace: 'nowrap', color: '#666' }}>
                      Lean ({selectedVotingYear})
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedBalances.map((b) => {
                  const v = voteByFips.get(b.stateFips)
                  return (
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
                      {voting.length > 0 && (
                        <td style={{ padding: '0.2rem 0.4rem', color: v?.lean != null ? (v.lean > 0 ? '#0052a5' : '#b22222') : '#999' }}>
                          {fmtLean(v?.lean ?? null)}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div style={{ flex: 1, minWidth: 0 }}>
              <ChartsPanel balances={balances} voting={voting} mapColorMode={mapColorMode} />
            </div>
          </div>
        )}
      </main>

      <AdminPanel onDataChanged={handleDataChanged} />
    </div>
  )
}
