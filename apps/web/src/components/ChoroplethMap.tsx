import { useState, type MouseEvent } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import type { StateBalance } from '../api'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

function stateColor(netPerCapitaCents: number | null, maxAbs: number): string {
  if (netPerCapitaCents == null || maxAbs === 0) return '#d4d4d4'
  const t = Math.max(-1, Math.min(1, netPerCapitaCents / maxAbs))
  if (t > 0) {
    // recipient → red
    const fade = Math.round(255 * (1 - t * 0.8))
    return `rgb(255,${fade},${fade})`
  }
  // donor → green
  const fade = Math.round(255 * (1 + t * 0.8))
  return `rgb(${fade},210,${fade})`
}

export default function ChoroplethMap({ balances }: { balances: StateBalance[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  const byFips = new Map(balances.map((b) => [b.stateFips, b]))
  const maxAbs = Math.max(...balances.map((b) => Math.abs(b.netPerCapitaCents ?? 0)), 1)

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <ComposableMap projection="geoAlbersUsa" style={{ width: '100%', height: 'auto' }}>
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo: any) => {
              const fips = String(geo.id).padStart(2, '0')
              const b = byFips.get(fips)
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={stateColor(b?.netPerCapitaCents ?? null, maxAbs)}
                  stroke="#fff"
                  strokeWidth={0.5}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', opacity: 0.75 },
                    pressed: { outline: 'none' },
                  }}
                  onMouseEnter={(e: MouseEvent) => {
                    if (!b) return
                    const pc = b.netPerCapitaCents != null
                      ? b.netPerCapitaCents > 0
                        ? `+$${Math.round(b.netPerCapitaCents / 100).toLocaleString()} received/person`
                        : `-$${Math.round(Math.abs(b.netPerCapitaCents) / 100).toLocaleString()} given/person`
                      : 'no data'
                    setTip({ x: e.clientX, y: e.clientY, text: `${b.stateName}: ${pc}` })
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
