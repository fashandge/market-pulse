import { useEffect, useMemo, useRef, useState } from 'react'
import { StatusMessage } from './StatusMessage'

// Credit stress, read top-down: the ratings ladder of corporate-bond spreads,
// then where the stress is landing (AI borrowers, semis), whether it is
// spreading (traded credit, VIX, the lenders, Treasury yields), and whether it
// is systemic (Fed stress indexes, repo funding). Data is /api/market/credit:
// FRED series and TradingView history (euro sovereign yields, MOVE) merged into
// local history files, plus investment-duckdb closes.
// Every panel keeps its own date axis (weekly and daily series mix); the range
// buttons slice all of them, and price panels rebase to 100 at range start.

interface Block<K extends string> {
  dates: string[]
  series: Record<K, (number | null)[]>
}
type FredKey = 'ig' | 'bbb' | 'hy' | 'ccc' | 'stlfsi' | 'nfci' | 'funding'
type PriceKey =
  | 'HYG' | 'IEI' | 'LQD' | 'IEF' | 'KRE' | 'BIZD' | 'OWL' | 'ARCC'
  | 'CRWV' | 'NBIS' | 'ORCL' | 'META' | 'SOXX' | 'IGV' | 'SPY'
  | 'BKLN' | 'vix' | 'us10y' | 'us30y' | 'HYG/IEI' | 'LQD/IEF'
type TvKey = 'fr' | 'it' | 'es' | 'move'
interface CreditPayload {
  fred: Block<FredKey> & { last: Record<FredKey, string | null> }
  prices: Block<PriceKey>
  tv: Block<TvKey> & { last: Record<TvKey, string | null> }
  fred_live: boolean | null
  tv_live: boolean | null
}

// Solarized, matching BreadthCharts. The four line colors are the categorical
// order validated as CVD-safe on base3; status colors are kept separate.
const C = {
  base3: '#fdf6e3',
  base2: '#eee8d5',
  base1: '#93a1a1',
  base00: '#657b83',
  base01: '#586e75',
  base02: '#073642',
  grid: '#e4dcc3',
  panel: '#fbf3dc',
  bad: '#a8362b',
  warn: '#b5501a',
  ok: '#46701a',
}
const LINE = ['#268bd2', '#d33682', '#b58900', '#2aa198']
const MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type RangeKey = '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'Max'
const RANGE_MONTHS: Record<RangeKey, number> = { '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '3Y': 36, Max: Infinity }
const RANGES = Object.keys(RANGE_MONTHS) as RangeKey[]

const T = (d: string) => Date.parse(d + 'T00:00:00Z')
const DAY = 864e5

function fmtDate(s: string, weekday = false) {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', {
    ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}
const signed = (v: number, digits = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits)
const bp = (v: number) => `${Math.round(v)} bp`

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag
  const t: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10))
  return t
}

function readStore(k: string): string | null {
  try { return sessionStorage.getItem(k) } catch { return null }
}
function writeStore(k: string, v: string) {
  try { sessionStorage.setItem(k, v) } catch { /* storage blocked: keep in-memory state */ }
}

// ---- series helpers ----------------------------------------------------------
interface Pt { t: number; d: string; v: number }

function points<K extends string>(b: Block<K>, k: K): Pt[] {
  const out: Pt[] = []
  b.series[k].forEach((v, i) => { if (v != null) out.push({ t: T(b.dates[i]), d: b.dates[i], v }) })
  return out
}
// Last point at or before t, or -1.
function bisect(p: Pt[], t: number): number {
  let lo = 0, hi = p.length - 1
  if (!p.length || p[0].t > t) return -1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[mid].t <= t) lo = mid; else hi = mid - 1 }
  return lo
}
const lastPt = (p: Pt[]) => p[p.length - 1]
const ago = (p: Pt[], days: number) => { const k = bisect(p, lastPt(p).t - days * DAY); return k < 0 ? null : p[k] }
const minSince = (p: Pt[], days: number) => {
  const t0 = lastPt(p).t - days * DAY
  return p.filter((x) => x.t >= t0).reduce((m, x) => (x.v < m.v ? x : m))
}

// ---- readout tiles -------------------------------------------------------------
type Status = ['bad' | 'warn' | 'ok', string]
interface Tile { label: string; value: string; status: Status; note: string }

function buildTiles(data: CreditPayload): Tile[] {
  const f = (k: FredKey) => points(data.fred, k)
  const p = (k: PriceKey) => points(data.prices, k)
  const tiles: Tile[] = []

  const ccc = f('ccc')
  if (ccc.length) {
    const now = lastPt(ccc), low = minSince(ccc, 182)
    const higher = [...ccc].reverse().find((x) => x.v > now.v)
    tiles.push({
      label: 'CCC junk-bond spread', value: bp(now.v),
      status: !higher ? ['bad', `Highest since data starts (${fmtDate(ccc[0].d)})`]
        : T(now.d) - higher.t > 365 * DAY ? ['bad', `Highest since ${fmtDate(higher.d)}`]
        : now.v - low.v >= 150 ? ['warn', 'Widening'] : ['ok', 'Calm'],
      note: `${signed(now.v - low.v)} bp from its 6-month low (${fmtDate(low.d)}). The weakest borrowers are shut out first.`,
    })
  }
  const hy = f('hy')
  if (hy.length) {
    const now = lastPt(hy), low = minSince(hy, 182)
    tiles.push({
      label: 'High-yield spread', value: bp(now.v),
      status: now.v >= 600 ? ['bad', 'Event zone'] : now.v - low.v >= 50 ? ['warn', 'Widening fast'] : ['ok', 'Calm'],
      note: `${signed(now.v - low.v)} bp from its 6-month low (${fmtDate(low.d)}). Event zone is 600–800 bp.`,
    })
  }
  const bbb = f('bbb')
  if (bbb.length) {
    const now = lastPt(bbb), low = minSince(bbb, 182)
    tiles.push({
      label: 'BBB spread (where much AI debt sits)', value: bp(now.v),
      status: now.v - low.v >= 50 ? ['bad', 'Confirmation level'] : now.v - low.v >= 15 ? ['warn', 'Drifting wider'] : ['ok', 'Calm'],
      note: `${signed(now.v - low.v)} bp from its 6-month low. Confirmation is +50 bp held about four weeks.`,
    })
  }
  const crwv = p('CRWV'), soxx = p('SOXX'), igv = p('IGV')
  if (crwv.length) {
    const m = ago(crwv, 30), chg = m ? (lastPt(crwv).v / m.v - 1) * 100 : 0
    tiles.push({
      label: 'CoreWeave stock, 1 month', value: `${signed(chg, 1)}%`,
      status: chg <= -20 ? ['bad', 'Borrower in distress'] : chg <= -10 ? ['warn', 'Under pressure'] : ['ok', 'Stable'],
      note: 'The most leveraged AI builder; its bonds and CDS lead the AI-credit story.',
    })
  }
  if (soxx.length && igv.length) {
    const ms = ago(soxx, 30), mi = ago(igv, 30)
    const s = ms ? (lastPt(soxx).v / ms.v - 1) * 100 : 0, i = mi ? (lastPt(igv).v / mi.v - 1) * 100 : 0
    tiles.push({
      label: 'Semis vs software, 1 month', value: `${signed(s, 1)}% / ${signed(i, 1)}%`,
      status: s - i <= -10 ? ['warn', 'Semis lagging'] : ['ok', 'In line'],
      note: 'SOXX against IGV. Semis depend on customers raising money; software does not.',
    })
  }
  const st = f('stlfsi'), fund = f('funding')
  if (st.length && fund.length) {
    const s = lastPt(st), recent = fund.slice(-5), avg = recent.reduce((a, x) => a + x.v, 0) / recent.length
    tiles.push({
      label: 'System gauges', value: `${s.v.toFixed(2)} · ${signed(avg)} bp`,
      status: s.v > 0 || avg > 5 ? ['warn', 'Tightening'] : ['ok', 'Calm'],
      note: `St. Louis Fed stress index (${fmtDate(s.d)}; above 0 is above-average stress) · SOFR minus IORB, 5-day average.`,
    })
  }
  return tiles
}

function Chip({ status }: { status: Status }) {
  const color = C[status[0]]
  return (
    <span style={{
      alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700,
      padding: '1px 9px 1px 7px', borderRadius: 999, border: `1px solid ${color}`, color: C.base02,
    }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {status[1]}
    </span>
  )
}

// ---- panels ----------------------------------------------------------------------
interface SeriesDef { label: string; pts: Pt[] }
interface PanelDef {
  id: string
  title: string
  note: string
  series: SeriesDef[]
  fmt: (v: number) => string
  rebase?: boolean
  baseline?: number
  refs?: { y: number; label: string }[]
  lowRef?: boolean
}

const ML = 48, MR = 14, MT = 8, PH = 150

function Panel({ def, from, width, span }: { def: PanelDef; from: number; width: number; span: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const geo = useMemo(() => {
    const W = width, pw = W - ML - MR
    const series = def.series.map((s, i) => {
      let p = s.pts.filter((x) => x.t >= from)
      if (def.rebase && p.length) { const b = p[0].v; p = p.map((x) => ({ ...x, v: (x.v / b) * 100 })) }
      return { ...s, p, color: LINE[i] }
    }).filter((s) => s.p.length > 1)
    if (!series.length || pw <= 0) return null
    const t0 = Math.min(...series.map((s) => s.p[0].t)), t1 = Math.max(...series.map((s) => lastPt(s.p).t))
    const refs = [...(def.refs ?? [])]
    if (def.lowRef && series.length === 1) {
      const low = series[0].p.reduce((m, x) => (x.v < m.v ? x : m))
      refs.push({ y: low.v, label: `low ${def.fmt(low.v)}` })
    }
    let lo = Infinity, hi = -Infinity
    series.forEach((s) => s.p.forEach((x) => { lo = Math.min(lo, x.v); hi = Math.max(hi, x.v) }))
    for (const y of [...refs.map((r) => r.y), ...(def.baseline != null ? [def.baseline] : [])]) { lo = Math.min(lo, y); hi = Math.max(hi, y) }
    const pad = (hi - lo) * 0.06 || 1
    lo -= pad; hi += pad
    const X = (t: number) => ML + (t1 > t0 ? ((t - t0) / (t1 - t0)) * pw : 0)
    const Y = (v: number) => MT + ((hi - v) / (hi - lo)) * PH
    const paths = series.map((s) => s.p.map((x, k) => (k ? 'L' : 'M') + X(x.t).toFixed(1) + ' ' + Y(x.v).toFixed(1)).join(''))
    const span = (t1 - t0) / DAY, monStep = span > 1500 ? 12 : span > 500 ? 3 : span > 200 ? 2 : 1
    const xt: [number, string][] = []
    const d0 = new Date(t0)
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
      if (m > 11) { m = 0; y++ }
      const t = Date.UTC(y, m, 1)
      if (t > t1) break
      if (monStep === 12 ? m === 0 : m % monStep === 0) xt.push([t, m === 0 ? String(y) : MON[m]])
    }
    return { W, pw, series, t0, t1, X, Y, paths, yt: niceTicks(lo, hi, 4), xt, refs }
  }, [def, from, width])

  if (!geo) return null
  const { W, pw, series, t0, t1, X, Y, paths, yt, xt, refs } = geo
  const H = PH + MT + 22
  const tAt = hover ?? t1
  const read = series.map((s) => { const k = bisect(s.p, tAt); return k < 0 ? null : s.p[k] })
  const readDate = read.reduce<string | null>((m, x) => (x && (!m || x.d > m) ? x.d : m), null)

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.grid}`, borderRadius: 8, padding: '8px 10px 4px', minWidth: 0, gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{def.title}</div>
      <div style={{ color: C.base00, fontSize: 12.5, marginBottom: 4 }}>{def.note}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums', alignItems: 'center' }}>
        {series.map((s, i) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 16, borderTop: `2px solid ${s.color}`, borderRadius: 2 }} />
            {series.length > 1 && <small style={{ color: C.base00 }}>{s.label}</small>}
            <b style={{ fontWeight: 600 }}>{read[i] ? def.fmt(read[i]!.v) : '—'}</b>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: C.base00, fontSize: 12 }}>{readDate ? fmtDate(readDate, true) : ''}</span>
      </div>
      <svg
        width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
        tabIndex={0} role="img" aria-label={def.title}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const fx = Math.min(1, Math.max(0, (e.clientX - r.left - ML) / (r.width - ML - MR)))
          setHover(t0 + fx * (t1 - t0))
        }}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
      >
        {xt.map(([t]) => <line key={t} x1={X(t)} x2={X(t)} y1={MT} y2={MT + PH} stroke={C.grid} strokeWidth={1} />)}
        {yt.map((v) => (
          <g key={v}>
            <line x1={ML} x2={ML + pw} y1={Y(v)} y2={Y(v)} stroke={C.grid} strokeWidth={1} />
            <text x={ML - 6} y={Y(v)} dy="0.35em" textAnchor="end" fill={C.base00}
              style={{ fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{+v.toFixed(2)}</text>
          </g>
        ))}
        {def.baseline != null && <line x1={ML} x2={ML + pw} y1={Y(def.baseline)} y2={Y(def.baseline)} stroke={C.base01} strokeWidth={1.25} />}
        {refs.map((r) => (
          <g key={r.label}>
            <line x1={ML} x2={ML + pw} y1={Y(r.y)} y2={Y(r.y)} stroke={C.base1} strokeDasharray="5 4" strokeWidth={1} />
            <text x={ML + 4} y={Y(r.y) - 4} fill={C.base00} style={{ fontFamily: MONO, fontSize: 11 }}>{r.label}</text>
          </g>
        ))}
        {xt.map(([t, lab]) => (
          <text key={'x' + t} x={X(t)} y={MT + PH + 16} textAnchor="middle" fill={C.base00} style={{ fontFamily: MONO, fontSize: 11 }}>{lab}</text>
        ))}
        {paths.map((d, i) => <path key={i} d={d} fill="none" stroke={series[i].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {series.map((s) => { const e = lastPt(s.p); return <circle key={s.label} cx={X(e.t)} cy={Y(e.v)} r={3.5} fill={s.color} stroke={C.panel} strokeWidth={2} /> })}
        {hover != null && (
          <>
            <line x1={X(Math.min(tAt, t1))} x2={X(Math.min(tAt, t1))} y1={MT} y2={MT + PH} stroke={C.base01} strokeWidth={1} />
            {read.map((x, i) => x && <circle key={i} cx={X(x.t)} cy={Y(x.v)} r={4} fill={series[i].color} stroke={C.panel} strokeWidth={2} />)}
          </>
        )}
      </svg>
    </section>
  )
}

function Grid({ defs, from }: { defs: PanelDef[]; from: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const cols = width >= 900 ? 2 : 1
  const panelW = Math.max(0, (width - (cols - 1) * 10) / cols - 22)
  // An odd panel out at the end of a two-column grid spans the full row.
  const spans = (i: number) => cols === 2 && defs.length % 2 === 1 && i === defs.length - 1
  return (
    <div ref={ref} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10 }}>
      {width > 0 && defs.map((d, i) => (
        <Panel key={d.id} def={d} from={from} span={spans(i)} width={spans(i) ? Math.max(0, width - 22) : panelW} />
      ))}
    </div>
  )
}

function Section({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ fontWeight: 700, fontSize: 16.5, marginBottom: 2 }}>{title}</div>
      <p style={{ margin: '0 0 8px', color: C.base01, fontSize: 13.5, maxWidth: '95ch' }}>{intro}</p>
      {children}
    </section>
  )
}

const btn = (active: boolean): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${active ? C.base01 : C.grid}`,
  background: active ? C.base2 : 'transparent',
  color: C.base02, fontWeight: active ? 700 : 400,
})

export function CreditCharts() {
  const [data, setData] = useState<CreditPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>(() => {
    const s = readStore('creditRange')
    return RANGES.includes(s as RangeKey) ? (s as RangeKey) : '6M'
  })

  useEffect(() => {
    fetch('/api/market/credit')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const groups = useMemo(() => {
    if (!data) return null
    const f = (k: FredKey) => points(data.fred, k)
    const p = (k: PriceKey) => points(data.prices, k)
    const sp = (label: string, k: PriceKey) => ({ label, pts: p(k) })
    const tv = (label: string, k: TvKey) => ({ label, pts: points(data.tv, k) })
    const idx = (v: number) => v.toFixed(1)
    const ladder: PanelDef[] = [
      { id: 'ig', title: 'Investment grade (all)', note: 'Moves slowly. A jump here means the hyperscalers themselves are being repriced.', series: [{ label: 'IG', pts: f('ig') }], fmt: bp, lowRef: true },
      { id: 'bbb', title: 'BBB, lowest investment grade', note: 'Where Oracle and much AI issuance sits. Confirmation: +50 bp off the low, held about four weeks.', series: [{ label: 'BBB', pts: f('bbb') }], fmt: bp, lowRef: true },
      { id: 'hy', title: 'High yield (junk)', note: 'Event zone is 600–800 bp. The April 2025 tariff shock peaked near 460 bp.', series: [{ label: 'HY', pts: f('hy') }], fmt: bp, lowRef: true },
      { id: 'ccc', title: 'CCC and below', note: 'The weakest borrowers, first to lose access to credit.', series: [{ label: 'CCC', pts: f('ccc') }], fmt: bp, lowRef: true },
    ]
    const landing: PanelDef[] = [
      { id: 'ai', title: 'AI borrowers, rebased to 100', note: 'Debt-funded builders (CoreWeave, Nebius, Oracle) and Meta, the largest recent AI bond issuer.',
        series: [sp('CRWV', 'CRWV'), sp('NBIS', 'NBIS'), sp('ORCL', 'ORCL'), sp('META', 'META')], fmt: idx, rebase: true, baseline: 100 },
      { id: 'semis', title: 'Semis against software, rebased to 100', note: 'SOXX semiconductors, IGV software, SPY the S&P 500.',
        series: [sp('SOXX', 'SOXX'), sp('IGV', 'IGV'), sp('SPY', 'SPY')], fmt: idx, rebase: true, baseline: 100 },
    ]
    const spreading: PanelDef[] = [
      { id: 'ratio', title: 'Traded credit against Treasuries, rebased to 100', note: 'HYG/IEI and LQD/IEF: corporate-bond ETFs over same-maturity Treasury ETFs. Falling means credit is losing to Treasuries.',
        series: [sp('HYG/IEI', 'HYG/IEI'), sp('LQD/IEF', 'LQD/IEF')], fmt: idx, rebase: true, baseline: 100 },
      { id: 'loans', title: 'Leveraged loans: BKLN price', note: 'Senior-loan ETF price, not total return. A sliding price means buyers of leveraged loans, the market next to private credit, are pulling back. It fell to about $17 in March 2020.',
        series: [sp('BKLN', 'BKLN')], fmt: (v) => '$' + v.toFixed(2) },
      { id: 'lenders', title: 'Crowded-out lenders, rebased to 100', note: 'KRE regional banks, BIZD business development companies (listed private-credit lenders), OWL Blue Owl, ARCC Ares Capital.',
        series: [sp('KRE', 'KRE'), sp('BIZD', 'BIZD'), sp('OWL', 'OWL'), sp('ARCC', 'ARCC')], fmt: idx, rebase: true, baseline: 100 },
      { id: 'vix', title: 'VIX', note: 'Spreads widening while VIX stays under 20 means bonds see the risk and stocks do not yet.',
        series: [sp('VIX', 'vix')], fmt: (v) => v.toFixed(1), refs: [{ y: 20, label: '20' }] },
    ]
    const rates: PanelDef[] = [
      { id: 'yields', title: 'Treasury yields', note: 'The rate shock. Higher base rates and wider spreads compound for borrowers with negative free cash flow.',
        series: [sp('10-year', 'us10y'), sp('30-year', 'us30y')], fmt: (v) => v.toFixed(2) + '%' },
      { id: 'move', title: 'MOVE index: Treasury volatility', note: 'Implied volatility of Treasury yields, the bond-market VIX. Its long-run average is roughly 100; it passed 150 in the 2022 rate shock and the March 2023 bank failures.',
        series: [tv('MOVE', 'move')], fmt: (v) => v.toFixed(1), refs: [{ y: 100, label: '~long-run average' }] },
      { id: 'euro', title: 'Euro sovereign spreads over the German Bund', note: 'France, Italy and Spain 10-year yields minus Germany\'s, in basis points. Widening means investors doubt those governments\' finances.',
        series: [tv('France', 'fr'), tv('Italy', 'it'), tv('Spain', 'es')], fmt: bp },
    ]
    const systemic: PanelDef[] = [
      { id: 'stress', title: 'Financial stress indexes (weekly)', note: 'St. Louis Fed STLFSI4 and Chicago Fed NFCI. 0 is average stress; above 0 is tighter than average.',
        series: [{ label: 'STLFSI4', pts: f('stlfsi') }, { label: 'NFCI', pts: f('nfci') }], fmt: (v) => v.toFixed(2), baseline: 0 },
      { id: 'funding', title: 'Repo funding pressure: SOFR minus IORB', note: 'Overnight repo rate minus the rate the Fed pays on reserves. Persistently above 0 means banks are short of cash.',
        series: [{ label: 'SOFR − IORB', pts: f('funding') }], fmt: bp, baseline: 0 },
    ]
    return { ladder, landing, spreading, rates, systemic }
  }, [data])

  const tiles = useMemo(() => (data ? buildTiles(data) : []), [data])

  if (error) return <StatusMessage kind="error">Error: {error}</StatusMessage>
  if (!data || !groups) return <StatusMessage kind="loading">Loading credit history…</StatusMessage>

  const latest = data.prices.dates[data.prices.dates.length - 1]
  const months = RANGE_MONTHS[range]
  const from = isFinite(months) ? T(latest) - months * 30.44 * DAY : -Infinity
  const selectRange = (r: RangeKey) => { setRange(r); writeStore('creditRange', r) }

  return (
    <div style={{ color: C.base02 }}>
      <p style={{ margin: '0 0 12px', color: C.base01, fontSize: 14.5, maxWidth: '85ch' }}>
        Read top-down. Stress usually shows first in the weakest borrowers, then climbs the ratings ladder, and
        only at the end reaches the system-wide gauges. Spreads are the extra yield over Treasuries in basis
        points (100 bp = 1 percentage point). Hover a panel to read it on any day.
      </p>

      {data.fred_live === false && (
        <StatusMessage kind="error">
          FRED did not respond, so spreads and stress indexes come from the stored history (latest {data.fred.last.hy ? fmtDate(data.fred.last.hy) : 'unknown'}).
        </StatusMessage>
      )}
      {data.tv_live === false && (
        <StatusMessage kind="error">
          TradingView did not respond, so euro spreads and MOVE come from the stored history (latest {data.tv.last.move ? fmtDate(data.tv.last.move) : 'unknown'}).
        </StatusMessage>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: C.panel, border: `1px solid ${C.grid}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.base01 }}>{t.label}</div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
            <Chip status={t.status} />
            <div style={{ fontSize: 12.5, color: C.base00 }}>{t.note}</div>
          </div>
        ))}
      </div>

      <div style={{
        position: 'sticky', top: 0, zIndex: 5, background: C.base3, marginTop: 14,
        display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.grid}`,
      }}>
        <span style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.base1, marginRight: 4 }}>Range</span>
        {RANGES.map((r) => (
          <button key={r} style={btn(range === r)} aria-pressed={range === r} onClick={() => selectRange(r)}>{r}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.base00 }}>Price panels rebase to 100 at range start</span>
      </div>

      <Section title="1. The ratings ladder" intro="Option-adjusted spreads of ICE BofA corporate-bond indexes. Same shape on every rung means a market-wide repricing; widening steepest at the bottom means the weakest borrowers are being shut out first. The dashed line is each spread's low in the selected range.">
        <Grid defs={groups.ladder} from={from} />
      </Section>
      <Section title="2. Where it is landing" intro="The borrowers funding the AI build-out with debt, and their suppliers. Semis fall when their customers' cost of capital rises; software does not depend on it.">
        <Grid defs={groups.landing} from={from} />
      </Section>
      <Section title="3. Is it spreading?" intro="Traded credit you can also watch intraday (HYG, LQD, BIZD, KRE in the Credit theme), the loan market and the lenders that get squeezed if the stress leaves AI, and equity fear.">
        <Grid defs={groups.spreading} from={from} />
      </Section>
      <Section title="4. Rates and sovereign stress" intro="The interest-rate shock that started the selloff: Treasury yields, Treasury volatility, and European government spreads. Rate volatility calming while credit keeps widening means the stress has moved from rates into credit.">
        <Grid defs={groups.rates} from={from} />
      </Section>
      <Section title="5. Is it systemic yet?" intro="Composite stress indexes and the repo funding market. The stress indexes spiked in the April 2025 tariff shock and repo funding was tight in late 2025 (use the 2Y range). A credit-cost problem becomes a crisis when these light up.">
        <Grid defs={groups.systemic} from={from} />
      </Section>

      <p style={{ fontSize: 12.5, color: C.base1, marginTop: 16, maxWidth: '95ch' }}>
        Sources: FRED (ICE BofA option-adjusted spreads through {data.fred.last.hy ? fmtDate(data.fred.last.hy) : '—'};
        STLFSI4 and NFCI through {data.fred.last.stlfsi ? fmtDate(data.fred.last.stlfsi) : '—'}; SOFR and IORB),
        merged into a local history file because FRED serves only the last three years of the ICE series. Euro
        10-year yields and MOVE from TradingView's daily history (unofficial feed, also stored locally) through{' '}
        {data.tv.last.move ? fmtDate(data.tv.last.move) : '—'}. Prices, VIX and Treasury yields from the investment
        project duckdb through the {fmtDate(latest)} close, adjusted for splits and dividends (BKLN for splits
        only). Not shown: single-name CDS (CoreWeave, Oracle, hyperscalers) and bond trades on
        FINRA TRACE, which have no free history feed.
      </p>
    </div>
  )
}
