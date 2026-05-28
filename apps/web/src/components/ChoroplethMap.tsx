import { useState, type MouseEvent } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import type { StateBalance, VotingResult } from '../api'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

// lean in [-1, 1]: negative = Republican, positive = Democrat
// deep red → light purple → deep blue
function leanColor(lean: number | null): string {
  if (lean == null) return '#d4d4d4'
  const RED:    [number, number, number] = [178,  34,  34]
  const PURPLE: [number, number, number] = [148,  64, 148]
  const BLUE:   [number, number, number] = [ 34,  34, 178]
  const t = Math.max(-1, Math.min(1, lean))
  let r: number, g: number, b: number
  if (t <= 0) {
    const s = -t
    r = Math.round(PURPLE[0] + s * (RED[0] - PURPLE[0]))
    g = Math.round(PURPLE[1] + s * (RED[1] - PURPLE[1]))
    b = Math.round(PURPLE[2] + s * (RED[2] - PURPLE[2]))
  } else {
    r = Math.round(PURPLE[0] + t * (BLUE[0] - PURPLE[0]))
    g = Math.round(PURPLE[1] + t * (BLUE[1] - PURPLE[1]))
    b = Math.round(PURPLE[2] + t * (BLUE[2] - PURPLE[2]))
  }
  return `rgb(${r},${g},${b})`
}

function financialColor(netPerCapitaCents: number | null, maxAbs: number): string {
  if (netPerCapitaCents == null || maxAbs === 0) return '#d4d4d4'
  const t = Math.max(-1, Math.min(1, netPerCapitaCents / maxAbs))
  if (t > 0) {
    const fade = Math.round(255 * (1 - t * 0.8))
    return `rgb(255,${fade},${fade})`
  }
  const fade = Math.round(255 * (1 + t * 0.8))
  return `rgb(${fade},210,${fade})`
}

function fmtLean(lean: number | null): string {
  if (lean == null) return 'no voting data'
  const pct = (Math.abs(lean) * 100).toFixed(1)
  if (lean > 0.005)  return `D+${pct}%`
  if (lean < -0.005) return `R+${pct}%`
  return 'Even split'
}

interface Props {
  balances: StateBalance[]
  voting?: VotingResult[]
  colorMode?: 'financial' | 'political'
}

export default function ChoroplethMap({ balances, voting = [], colorMode = 'financial' }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  const byFips = new Map(balances.map((b) => [b.stateFips, b]))
  const voteByFips = new Map(voting.map((v) => [v.stateFips, v]))
  const maxAbs = Math.max(...balances.map((b) => Math.abs(b.netPerCapitaCents ?? 0)), 1)

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <ComposableMap projection="geoAlbersUsa" style={{ width: '100%', height: 'auto' }}>
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo: any) => {
              const fips = String(geo.id).padStart(2, '0')
              const b = byFips.get(fips)
              const v = voteByFips.get(fips)
              const fill = colorMode === 'political'
                ? leanColor(v?.lean ?? null)
                : financialColor(b?.netPerCapitaCents ?? null, maxAbs)
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={0.5}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', opacity: 0.75 },
                    pressed: { outline: 'none' },
                  }}
                  onMouseEnter={(e: MouseEvent) => {
                    if (!b && !v) return
                    const name = b?.stateName ?? v?.stateName ?? fips
                    const financialLine = b?.netPerCapitaCents != null
                      ? b.netPerCapitaCents > 0
                        ? `+$${Math.round(b.netPerCapitaCents / 100).toLocaleString()}/person received`
                        : `-$${Math.round(Math.abs(b.netPerCapitaCents) / 100).toLocaleString()}/person given`
                      : null
                    const leanLine = v ? fmtLean(v.lean) : null
                    const lines = [financialLine, leanLine].filter(Boolean).join(' · ')
                    setTip({ x: e.clientX, y: e.clientY, text: `${name}: ${lines}` })
                  }}
                  onMouseMove={(e: MouseEvent) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={() => setTip(null)}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>
      {tip && (
        <div style={{
          position: 'fixed', left: tip.x + 12, top: tip.y + 12,
          background: '#fff', border: '1px solid #ddd', borderRadius: 4,
          padding: '4px 8px', fontSize: 12, pointerEvents: 'none',
          zIndex: 1000, boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
