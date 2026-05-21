import type { CSSProperties, ReactNode } from 'react'
import {
  PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer,
  ScatterChart, Scatter, CartesianGrid,
} from 'recharts'
import type { StateBalance } from '../api'
import ChoroplethMap from './ChoroplethMap'

function lerp(t: number, a: [number, number, number], b: [number, number, number]): string {
  const r = Math.round(a[0] + t * (b[0] - a[0]))
  const g = Math.round(a[1] + t * (b[1] - a[1]))
  const bl = Math.round(a[2] + t * (b[2] - a[2]))
  return `rgb(${r},${g},${bl})`
}

const RED_A: [number, number, number] = [255, 160, 160]
const RED_B: [number, number, number] = [160, 0, 0]
const GRN_A: [number, number, number] = [144, 238, 144]
const GRN_B: [number, number, number] = [0, 100, 0]

function ChartLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {children}
    </p>
  )
}

function formatK(dollars: number): string {
  return `$${(dollars / 1000).toFixed(0)}K`
}

export default function ChartsPanel({ balances }: { balances: StateBalance[] }) {
  // ── Pie data ──────────────────────────────────────────────────────────────
  const positive = [...balances].filter((b) => b.netCents > 0).sort((a, b) => b.netCents - a.netCents)
  const negative = [...balances].filter((b) => b.netCents < 0).sort((a, b) => a.netCents - b.netCents)
  const piePos = positive.map((b) => ({ name: b.stateAbbr, fullName: b.stateName, value: b.netCents / 1e11 }))
  const pieNeg = negative.map((b) => ({ name: b.stateAbbr, fullName: b.stateName, value: Math.abs(b.netCents) / 1e11 }))

  // ── Net bar data (inverted: donors positive, recipients negative) ─────────
  const barData = [...balances]
    .sort((a, b) => a.netCents - b.netCents)
    .map((b) => ({ name: b.stateAbbr, net: parseFloat((-b.netCents / 1e11).toFixed(2)) }))

  // ── Return on dollar ──────────────────────────────────────────────────────
  const returnData = [...balances]
    .filter((b) => b.totalPaidInCents > 0)
    .map((b) => ({
      name: b.stateAbbr,
      fullName: b.stateName,
      ratio: parseFloat((b.totalReceivedCents / b.totalPaidInCents).toFixed(3)),
    }))
    .sort((a, b) => b.ratio - a.ratio)

  // ── Scatter: paid per capita vs received per capita ───────────────────────
  const scatterData = balances
    .filter((b) => b.population != null && b.population > 0)
    .map((b) => ({
      name: b.stateAbbr,
      fullName: b.stateName,
      x: Math.round(b.totalPaidInCents / b.population! / 100),
      y: Math.round(b.totalReceivedCents / b.population! / 100),
    }))
  const scatterMax = Math.max(...scatterData.flatMap((d) => [d.x, d.y]), 1)
  const diagonal = [{ x: 0, y: 0 }, { x: scatterMax, y: scatterMax }]

  // ── Tooltips ──────────────────────────────────────────────────────────────
  const pieTip = ({ active, payload }: { active?: boolean; payload?: { payload: { fullName: string; value: number } }[] }) => {
    if (!active || !payload?.[0]) return null
    const { fullName, value } = payload[0].payload
    return <div style={tipStyle}><strong>{fullName}</strong><br />${value.toFixed(1)}B net</div>
  }

  const barTip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (!active || !payload?.[0]) return null
    const v = payload[0].value ?? 0
    return <div style={tipStyle}><strong>{label}</strong><br />{v >= 0 ? '+' : ''}{v.toFixed(1)}B</div>
  }

  const returnTip = ({ active, payload }: { active?: boolean; payload?: { payload: { fullName: string; ratio: number } }[] }) => {
    if (!active || !payload?.[0]) return null
    const { fullName, ratio } = payload[0].payload
    return <div style={tipStyle}><strong>{fullName}</strong><br />${ratio.toFixed(2)} back per $1 paid</div>
  }

  const scatterTip = ({ active, payload }: { active?: boolean; payload?: { payload: { fullName: string; x: number; y: number } }[] }) => {
    if (!active || !payload?.[0]) return null
    const { fullName, x, y } = payload[0].payload
    return (
      <div style={tipStyle}>
        <strong>{fullName}</strong><br />
        Paid: {formatK(x)}/person<br />
        Received: {formatK(y)}/person
      </div>
    )
  }

  const ScatterDot = (props: { cx?: number; cy?: number; payload?: { x: number; y: number; name: string } }) => {
    const { cx = 0, cy = 0, payload } = props
    if (!payload) return null
    const isRecipient = payload.y > payload.x
    return (
      <g>
        <circle cx={cx} cy={cy} r={4} fill={isRecipient ? '#e74c3c' : '#27ae60'} fillOpacity={0.85} />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={7} fill="#444">{payload.name}</text>
      </g>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>

      {/* Choropleth map */}
      <div>
        <ChartLabel>Net per capita by state — red = recipient, green = donor</ChartLabel>
        <ChoroplethMap balances={balances} />
      </div>

      {/* Two pies */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChartLabel><span style={{ color: '#c0392b' }}>Net GIVEN TO ({positive.length})</span></ChartLabel>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={piePos} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%">
                {piePos.map((_, i) => <Cell key={i} fill={lerp(i / Math.max(piePos.length - 1, 1), RED_A, RED_B)} />)}
              </Pie>
              <Tooltip content={pieTip as never} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChartLabel><span style={{ color: '#27ae60' }}>Net Taken From ({negative.length})</span></ChartLabel>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieNeg} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%">
                {pieNeg.map((_, i) => <Cell key={i} fill={lerp(i / Math.max(pieNeg.length - 1, 1), GRN_A, GRN_B)} />)}
              </Pie>
              <Tooltip content={pieTip as never} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Return on dollar */}
      <div>
        <ChartLabel>Return on dollar — received per $1 paid in (break-even = $1.00)</ChartLabel>
        <ResponsiveContainer width="100%" height={680}>
          <BarChart data={returnData} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 24 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(1)}`} domain={[0, 'dataMax + 0.1']} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={22} />
            <ReferenceLine x={1} stroke="#999" strokeDasharray="3 3" />
            <Tooltip content={returnTip as never} />
            <Bar dataKey="ratio" isAnimationActive={false} barSize={9}>
              {returnData.map((d, i) => (
                <Cell key={i} fill={d.ratio > 1 ? '#e74c3c' : '#27ae60'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Net by state bar */}
      <div>
        <ChartLabel>Net by state ($B) — donors above zero, recipients below</ChartLabel>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 48, left: 16 }}>
            <XAxis dataKey="name" tick={{ fontSize: 8 }} angle={-60} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}B`} />
            <ReferenceLine y={0} stroke="#999" />
            <Tooltip content={barTip as never} />
            <Bar dataKey="net" isAnimationActive={false}>
              {barData.map((d, i) => <Cell key={i} fill={d.net > 0 ? '#27ae60' : '#e74c3c'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Scatter: paid vs received per capita */}
      <div>
        <ChartLabel>Paid vs. received per capita — dots above diagonal = net recipient</ChartLabel>
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 32, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" dataKey="x" name="Paid" tick={{ fontSize: 10 }} tickFormatter={formatK} label={{ value: 'Paid per capita', position: 'insideBottom', offset: -20, fontSize: 10 }} domain={[0, scatterMax]} />
            <YAxis type="number" dataKey="y" name="Received" tick={{ fontSize: 10 }} tickFormatter={formatK} label={{ value: 'Received per capita', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10 }} domain={[0, scatterMax]} />
            <Tooltip content={scatterTip as never} />
            {/* break-even diagonal */}
            <Scatter data={diagonal} line={{ stroke: '#bbb', strokeDasharray: '5 3' }} shape={() => null as never} legendType="none" isAnimationActive={false} />
            {/* state data */}
            <Scatter data={scatterData} shape={ScatterDot as never} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

    </div>
  )
}

const tipStyle: CSSProperties = {
  background: '#fff', border: '1px solid #ddd', borderRadius: 4,
  padding: '4px 8px', fontSize: 12, lineHeight: 1.5,
}
