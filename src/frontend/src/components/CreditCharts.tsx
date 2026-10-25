import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  | 'CRWV' | 'NBIS' | 'ORCL' | 'META' | 'SOXX' | 'SMH' | 'IGV' | 'SPY' | 'QQQ'
  | 'BKLN' | 'vix' | 'us10y' | 'us30y' | 'HYG/IEI' | 'LQD/IEF'
type TvKey = 'fr' | 'it' | 'es' | 'move'
interface CreditPayload {
  fred: Block<FredKey> & { last: Record<FredKey, string | null> }
  prices: Block<PriceKey>
  tv: Block<TvKey> & { last: Record<TvKey, string | null> }
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
const LINE = ['#268bd2', '#d33682', '#b58900', '#2aa198', '#6c71c4', '#cb4b16'] // validated CVD-safe order on base3
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
  hideable?: boolean  // each series gets a show/hide checkbox in the header
  defaultHidden?: string[]  // labels of hideable series that start unchecked
}

const ML = 48, MR = 14, MT = 8, PH = 150

function Panel({ def, from, width, span, height = PH, onExpand }: {
  def: PanelDef; from: number; width: number; span: boolean; height?: number; onExpand?: () => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(def.defaultHidden ?? []))
  const geo = useMemo(() => {
    const W = width, pw = W - ML - MR
    // Color follows the series, not its position among the visible ones.
    const visible = def.series.map((s, i) => ({ ...s, color: LINE[i] })).filter((s) => !hidden.has(s.label))
    let windowed = visible.map((s) => ({ ...s, p: s.pts.filter((x) => x.t >= from) })).filter((s) => s.p.length > 1)
    if (def.rebase && windowed.length) {
      // Rebase every series on the same day: the latest first day among them.
      const start = Math.max(...windowed.map((s) => s.p[0].t))
      windowed = windowed.map((s) => ({ ...s, p: s.p.filter((x) => x.t >= start) })).filter((s) => s.p.length > 1)
    }
    const series = windowed.map((s) => {
      if (!def.rebase) return s
      const b = s.p[0].v
      return { ...s, p: s.p.map((x) => ({ ...x, v: (x.v / b) * 100 })) }
    })
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
    const Y = (v: number) => MT + ((hi - v) / (hi - lo)) * height
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
  }, [def, from, width, hidden, height])

  if (!geo) return null
  const { W, pw, series, t0, t1, X, Y, paths, yt, xt, refs } = geo
  const H = height + MT + 22
  const tAt = hover ?? t1
  const read = series.map((s) => { const k = bisect(s.p, tAt); return k < 0 ? null : s.p[k] })
  const readDate = read.reduce<string | null>((m, x) => (x && (!m || x.d > m) ? x.d : m), null)

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.grid}`, borderRadius: 8, padding: '8px 10px 4px', minWidth: 0, gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{def.title}</div>
        {onExpand && (
          <button onClick={onExpand} title="Open a larger view" aria-label={`Expand ${def.title}`}
            style={{ flex: 'none', fontFamily: 'inherit', fontSize: 12.5, padding: '1px 8px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${C.grid}`, background: 'transparent', color: C.base01 }}>⤢ Expand</button>
        )}
      </div>
      <div style={{ color: C.base00, fontSize: 12.5, marginBottom: 4 }}>{def.note}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums', alignItems: 'center' }}>
        {def.hideable ? def.series.map((d, j) => {
          const i = series.findIndex((s) => s.label === d.label)
          const on = !hidden.has(d.label)
          return (
            <label key={d.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} disabled={on && series.length === 1}
                onChange={() => { const n = new Set(hidden); if (on) n.add(d.label); else n.delete(d.label); setHidden(n) }} />
              <span style={{ display: 'inline-block', width: 16, borderTop: `2px solid ${LINE[j]}`, borderRadius: 2 }} />
              <small style={{ color: C.base00 }}>{d.label}</small>
              {on && <b style={{ fontWeight: 600 }}>{i >= 0 && read[i] ? def.fmt(read[i]!.v) : '—'}</b>}
            </label>
          )
        }) : series.map((s, i) => (
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
        {xt.map(([t]) => <line key={t} x1={X(t)} x2={X(t)} y1={MT} y2={MT + height} stroke={C.grid} strokeWidth={1} />)}
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
          <text key={'x' + t} x={X(t)} y={MT + height + 16} textAnchor="middle" fill={C.base00} style={{ fontFamily: MONO, fontSize: 11 }}>{lab}</text>
        ))}
        {paths.map((d, i) => <path key={i} d={d} fill="none" stroke={series[i].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {series.map((s) => { const e = lastPt(s.p); return <circle key={s.label} cx={X(e.t)} cy={Y(e.v)} r={3.5} fill={s.color} stroke={C.panel} strokeWidth={2} /> })}
        {hover != null && (
          <>
            <line x1={X(Math.min(tAt, t1))} x2={X(Math.min(tAt, t1))} y1={MT} y2={MT + height} stroke={C.base01} strokeWidth={1} />
            {read.map((x, i) => x && <circle key={i} cx={X(x.t)} cy={Y(x.v)} r={4} fill={series[i].color} stroke={C.panel} strokeWidth={2} />)}
          </>
        )}
      </svg>
    </section>
  )
}

function Grid({ defs, from, latest, range }: { defs: PanelDef[]; from: number; latest: number; range: RangeKey }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const expandedDef = defs.find((d) => d.id === expanded)
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
        <Panel key={d.id} def={d} from={from} span={spans(i)} width={spans(i) ? Math.max(0, width - 22) : panelW}
          onExpand={() => setExpanded(d.id)} />
      ))}
      {expandedDef && <ExpandedPanel def={expandedDef} latest={latest} initialRange={range} onClose={() => setExpanded(null)} />}
    </div>
  )
}

const rangeStart = (range: RangeKey, latest: number) =>
  isFinite(RANGE_MONTHS[range]) ? latest - RANGE_MONTHS[range] * 30.44 * DAY : -Infinity

// A large view of one panel in a pop-up, with its own range buttons, for
// studying how the series move together. Esc or a click outside closes it.
function ExpandedPanel({ def, latest, initialRange, onClose }: {
  def: PanelDef; latest: number; initialRange: RangeKey; onClose: () => void
}) {
  const [range, setRange] = useState<RangeKey>(initialRange)
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const el = boxRef.current
    const measure = () => setSize({ w: el ? el.clientWidth : 0, h: window.innerHeight })
    const ro = el ? new ResizeObserver(measure) : null
    if (el && ro) ro.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={def.title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(7, 54, 66, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div ref={boxRef} onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1500px, 96vw)', maxHeight: '94vh', overflow: 'auto', background: C.base3, borderRadius: 10, padding: '10px 12px 12px', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.base1, marginRight: 4 }}>Range</span>
          {RANGES.map((r) => (
            <button key={r} style={btn(range === r)} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>
          ))}
          <button onClick={onClose} aria-label="Close" style={{ ...btn(false), marginLeft: 'auto' }}>✕ Close</button>
        </div>
        {size.w > 0 && (
          <Panel def={def} from={rangeStart(range, latest)} span={false}
            width={Math.max(0, size.w - 24 - 22)} height={Math.max(260, Math.min(720, size.h * 0.62))} />
        )}
      </div>
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

// Bloomberg-only series (the Goldman Short Index, Oracle and Meta 10-year bond
// yields) as the Credit Bubble Bulletin's weekly chart images, scraped and
// stored by the backend (cbb_charts.py), credited and linked back.
interface Digitized {
  dates?: string[]
  values?: number[]
  points?: [number, number][]
  width?: number
  height?: number
  px_per_day?: number
  units_per_px?: number
  label_fit_error?: number
  scale?: { a: number; b: number }
  error?: string
}
type BenchKey = 'QQQ' | 'SPY'
type Benchmarks = Partial<Record<BenchKey, { dates: string[]; closes: number[] }>>
interface CbbChart { name: string; label: string; updated: string | null; digitized?: Digitized }
interface MostShortedPayload {
  dates: string[]
  values: number[]
  settlement: string | null
  effective?: string
  members: { ticker: string; short_pct: number }[]
}
interface CbbPayload {
  groups: Partial<Record<'goldman_short' | 'oracle' | 'meta', CbbChart[]>>
  series: Partial<Record<'goldman_short', { dates: string[]; values: number[]; px_per_day: number[] }>>
  benchmarks?: Benchmarks
  source_url: string
  live: boolean | null
}

const OVERLAY = '#dc322f'
const BENCH_COLOR: Record<BenchKey, string> = { QQQ: '#6c71c4', SPY: '#859900' }
const BENCH_TIP_COLOR: Record<BenchKey, string> = { QQQ: '#a9acec', SPY: '#b5c94a' } // readable on the dark tooltip
const BENCH_KEYS: BenchKey[] = ['QQQ', 'SPY']

// A benchmark's closes on the chart's days, rebased to the digitized index's
// first value, in the image's pixel coordinates (row = (value - a) / b).
function benchLine(dig: Digitized, b: { dates: string[]; closes: number[] } | undefined) {
  if (!b || !dig.dates || !dig.values || !dig.points || !dig.scale) return null
  const byDate = new Map(b.dates.map((d, i) => [d, b.closes[i]]))
  const closes = dig.dates.map((d) => {
    if (byDate.has(d)) return byDate.get(d) as number
    let k = b.dates.length - 1  // a day the benchmark did not trade: its last earlier close
    while (k >= 0 && b.dates[k] > d) k--
    return k >= 0 ? b.closes[k] : null
  })
  const c0 = closes[0]
  if (c0 == null) return null
  const g0 = dig.values[0]
  const pts = closes.map((c, i) => (c == null ? null : [dig.points![i][0], (g0 * (c / c0) - dig.scale!.a) / dig.scale!.b] as [number, number]))
  return { pts, pct: closes.map((c) => (c == null ? null : (c / c0 - 1) * 100)) }
}

// The original chart image with the digitized daily values drawn on top in the
// image's own pixel coordinates, so any misreading shows as red off the blue line.
function OverlaidImage({ src, alt, dig, show, benchmarks, showBench }: {
  src: string; alt: string; dig: Digitized; show: boolean; benchmarks?: Benchmarks; showBench: Record<BenchKey, boolean>
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const pts = dig.points ?? []
  const w = dig.width ?? 1, h = dig.height ?? 1
  // The tooltip is positioned against the window (position: fixed), so the image
  // box's clipping never crops it: beside the cursor, flipped and clamped to
  // stay fully inside the window.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el || !cursor) return
    const gap = 14, pad = 8, tw = el.offsetWidth, th = el.offsetHeight
    let left = cursor.x + gap
    if (left + tw > window.innerWidth - pad) left = cursor.x - gap - tw
    let top = cursor.y + gap
    if (top + th > window.innerHeight - pad) top = cursor.y - gap - th
    el.style.left = `${Math.max(pad, Math.min(left, window.innerWidth - pad - tw))}px`
    el.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - pad - th))}px`
  }, [cursor, hover])
  const bench = BENCH_KEYS.map((k) => ({ k, line: showBench[k] ? benchLine(dig, benchmarks?.[k]) : null }))
  const pctOf = (i: number) => (dig.values ? (dig.values[i] / dig.values[0] - 1) * 100 : 0)
  const fmtPct = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${w} / ${h}`, border: `1px solid ${C.grid}`, borderRadius: 4, background: '#fff', overflow: 'hidden' }}>
      <img src={src} alt={alt} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      {(show || bench.some((x) => x.line)) && pts.length > 0 && (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - r.left) / r.width) * w
            let best = 0
            pts.forEach((p, i) => { if (Math.abs(p[0] - x) < Math.abs(pts[best][0] - x)) best = i })
            setHover(best)
            setCursor({ x: e.clientX, y: e.clientY })
          }}
          onPointerLeave={() => { setHover(null); setCursor(null) }}>
          {bench.map(({ k, line }) => line && (
            <polyline key={k} points={line.pts.filter((p): p is [number, number] => p != null).map((p) => p.join(',')).join(' ')}
              fill="none" stroke={BENCH_COLOR[k]} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
          {show && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={OVERLAY} strokeWidth={1.5}
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {show && pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={pts.length > 60 ? 3 : 6} fill="none" stroke={OVERLAY}
              strokeWidth={i === hover ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && (
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={h} stroke={OVERLAY} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      )}
      {hover != null && cursor && dig.dates && dig.values && (
        <div ref={tipRef} style={{
          position: 'fixed', left: cursor.x + 14, top: cursor.y + 14, zIndex: 50,
          // Semi-transparent so the lines under it stay visible; the text shadow keeps it legible.
          background: 'rgba(7, 54, 66, 0.55)', color: C.base3, textShadow: '0 0 3px rgba(7, 54, 66, 0.9)',
          fontFamily: MONO, fontSize: 12, padding: '3px 7px', borderRadius: 4, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          <div>{fmtDate(dig.dates[hover], true)}: <b>{dig.values[hover].toFixed(1)}</b> ({fmtPct(pctOf(hover))} since chart start)</div>
          {bench.map(({ k, line }) => line && line.pct[hover] != null && (
            <div key={k}><span style={{ color: BENCH_TIP_COLOR[k] }}>{k}</span> {fmtPct(line.pct[hover] as number)}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function CbbPanel({ title, note, charts, data }: { title: string; note: string; charts: CbbChart[]; data: CbbPayload }) {
  const [overlay, setOverlay] = useState(true)
  const [showBench, setShowBench] = useState<Record<BenchKey, boolean>>({ QQQ: true, SPY: true })
  if (!charts.length) return null
  const canOverlay = charts.some((c) => c.digitized?.points?.length)
  return (
    <section style={{ background: C.panel, border: `1px solid ${C.grid}`, borderRadius: 8, padding: '8px 10px 10px', marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
        {canOverlay && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.base01, cursor: 'pointer' }}>
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
            <span style={{ display: 'inline-block', width: 14, borderTop: `2px solid ${OVERLAY}` }} />
            Overlay the digitized values (hover to read a day)
          </label>
        )}
        {canOverlay && data.benchmarks && (
          <div style={{ display: 'inline-flex', gap: 14, alignItems: 'center', fontSize: 13, color: C.base01 }}>
            {BENCH_KEYS.filter((k) => data.benchmarks?.[k]).map((k) => (
              <label key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={showBench[k]} onChange={(e) => setShowBench({ ...showBench, [k]: e.target.checked })} />
                <span style={{ display: 'inline-block', width: 14, borderTop: `2px solid ${BENCH_COLOR[k]}` }} />
                {k}
              </label>
            ))}
          </div>
        )}
      </div>
      <div style={{ color: C.base00, fontSize: 12.5, margin: '2px 0 8px', maxWidth: '110ch' }}>
        {note}
        {data.live === false && ' The site did not respond, so these are the stored charts.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {charts.map((c) => {
          const src = `/api/market/credit/cbb-charts/${encodeURIComponent(c.name)}?v=${c.updated ?? ''}`
          const dig = c.digitized
          return (
            <figure key={c.name} style={{ margin: 0 }}>
              {dig?.points?.length ? (
                <OverlaidImage src={src} alt={`${title}: ${c.label}`} dig={dig} show={overlay} benchmarks={data.benchmarks} showBench={showBench} />
              ) : (
                <a href={src} target="_blank" rel="noopener noreferrer">
                  <img src={src} alt={`${title}: ${c.label}`}
                    style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'contain', display: 'block', borderRadius: 4, border: `1px solid ${C.grid}`, background: '#fff' }} />
                </a>
              )}
              <figcaption style={{ fontSize: 12, color: C.base00, marginTop: 4 }}>
                {c.label}{c.updated ? ` · chart updated ${fmtDate(c.updated)}` : ''}
                {dig?.points?.length ? ` · read ${dig.points.length} days at ${dig.px_per_day} px/day, ${dig.units_per_px?.toFixed(2)} points per pixel, axis-label fit within ${dig.label_fit_error?.toFixed(2)}` : ''}
                {dig?.error ? ` · could not digitize: ${dig.error}` : ''}
              </figcaption>
            </figure>
          )
        })}
      </div>
      <div style={{ fontSize: 12, color: C.base1, marginTop: 6 }}>
        Bloomberg data, charts from Doug Noland's{' '}
        <a href={data.source_url} target="_blank" rel="noopener noreferrer" style={{ color: C.base01 }}>Credit Bubble Bulletin</a>,
        updated weekly.
      </div>
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
  const [cbb, setCbb] = useState<CbbPayload | null>(null)
  const [mostShorted, setMostShorted] = useState<MostShortedPayload | null>(null)
  useEffect(() => {
    // Optional extra, like the scraped charts: the tab renders without it.
    fetch('/api/market/credit/most-shorted')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMostShorted)
      .catch(() => setMostShorted(null))
  }, [])
  useEffect(() => {
    // Optional extra: the tab renders without these charts if the scrape fails.
    fetch('/api/market/credit/cbb-charts')
      .then((r) => (r.ok ? r.json() : null))
      .then(setCbb)
      .catch(() => setCbb(null))
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
    const gs = cbb?.series.goldman_short
    if (gs && gs.dates.length > 1) {
      const sharpFrom = gs.dates[gs.px_per_day.findIndex((p) => p >= 20)]
      spreading.push({
        id: 'goldmanDigitized', title: 'Goldman Short Index, digitized from the weekly charts',
        note: `Daily values read off the Credit Bubble Bulletin's Bloomberg charts (check them against the overlay below). ${sharpFrom ? `From ${fmtDate(sharpFrom)} the 34-day chart is used, accurate to a few tenths of a point; earlier days` : 'Days'} come from the year-to-date chart, accurate to about 2 points, with one-day spikes the least accurate. Each week's charts extend the stored history.`,
        series: [{ label: 'Goldman', pts: gs.dates.map((d, i) => ({ t: T(d), d, v: gs.values[i] })) }],
        fmt: (v) => v.toFixed(1),
      })
    }
    if (mostShorted && mostShorted.dates.length > 1) {
      const top = mostShorted.members.slice(0, 8).map((x) => `${x.ticker} ${x.short_pct}%`).join(', ')
      spreading.push({
        id: 'mostShorted', title: 'Most-shorted basket (free stand-in for the Goldman Short Index) against QQQ, SPY and semiconductors, rebased to 100',
        note: `The 50 US stocks with the highest short interest as a share of shares outstanding (market value ≥ $1B, price ≥ $5), equal-weighted and rebuilt monthly from FINRA short interest and SEC share counts. Tracks the Goldman index's turning points, not its level. QQQ, SPY and the semiconductor ETFs SMH and SOXX are total return like the basket, all rebased on the same day. Current basket from FINRA's ${mostShorted.settlement ? fmtDate(mostShorted.settlement) : '—'} data, most shorted first: ${top}.`,
        series: [
          { label: 'Basket', pts: mostShorted.dates.map((d, i) => ({ t: T(d), d, v: mostShorted.values[i] })) },
          sp('QQQ', 'QQQ'), sp('SPY', 'SPY'), sp('SMH', 'SMH'), sp('SOXX', 'SOXX'),
        ],
        fmt: idx, rebase: true, baseline: 100, hideable: true, defaultHidden: ['SPY', 'SMH', 'SOXX'],
      })
    }
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
  }, [data, mostShorted, cbb])

  const tiles = useMemo(() => (data ? buildTiles(data) : []), [data])

  if (error) return <StatusMessage kind="error">Error: {error}</StatusMessage>
  if (!data || !groups) return <StatusMessage kind="loading">Loading credit history…</StatusMessage>

  const latest = data.prices.dates[data.prices.dates.length - 1]
  const months = RANGE_MONTHS[range]
  const from = isFinite(months) ? T(latest) - months * 30.44 * DAY : -Infinity
  const selectRange = (r: RangeKey) => { setRange(r); writeStore('creditRange', r) }
  const tsy10 = points(data.prices, 'us10y')
  const us10y = tsy10.length ? lastPt(tsy10).v.toFixed(2) + '%' : '—'

  return (
    <div style={{ color: C.base02 }}>
      <p style={{ margin: '0 0 12px', color: C.base01, fontSize: 14.5, maxWidth: '85ch' }}>
        Read top-down. Stress usually shows first in the weakest borrowers, then climbs the ratings ladder, and
        only at the end reaches the system-wide gauges. Spreads are the extra yield over Treasuries in basis
        points (100 bp = 1 percentage point). Hover a panel to read it on any day.
      </p>


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
        <Grid defs={groups.ladder} from={from} latest={T(latest)} range={range} />
      </Section>
      <Section title="2. Where it is landing" intro="The borrowers funding the AI build-out with debt, and their suppliers. Semis fall when their customers' cost of capital rises; software does not depend on it.">
        <Grid defs={groups.landing} from={from} latest={T(latest)} range={range} />
        {cbb && (
          <CbbPanel data={cbb} title="AI borrowers' own bond yields: Oracle and Meta 10-year"
            note={`What these companies pay to borrow for ten years. Subtract the 10-year Treasury yield (${us10y} at the latest close, section 4) to get each company's credit spread. A spread near 3 points, where Oracle was in October 2026, is junk-like for an investment-grade borrower.`}
            charts={[
              ...(cbb.groups.oracle ?? []).map((c) => ({ ...c, label: `Oracle 10-year yield, ${c.label.toLowerCase()}` })),
              ...(cbb.groups.meta ?? []).map((c) => ({ ...c, label: `Meta 10-year yield, ${c.label.toLowerCase()}` })),
            ]} />
        )}
      </Section>
      <Section title="3. Is it spreading?" intro="Traded credit you can also watch intraday (HYG, LQD, BIZD, KRE in the Credit theme), the loan market and the lenders that get squeezed if the stress leaves AI, equity fear, and the most-shorted stocks.">
        <Grid defs={groups.spreading} from={from} latest={T(latest)} range={range} />
        {cbb && (
          <CbbPanel data={cbb} title="Goldman Short Index (most-shorted US stocks)"
            note="Goldman's basket of the 50 most-shorted US stocks. A sharp rally in a weak market is a short squeeze, not relief; a steady fall means short sellers are winning as credit tightens. Read it against the CCC spread: both moving together is a real signal, a squeeze while CCC keeps widening is not."
            charts={cbb.groups.goldman_short ?? []} />
        )}
      </Section>
      <Section title="4. Rates and sovereign stress" intro="The interest-rate shock that started the selloff: Treasury yields, Treasury volatility, and European government spreads. Rate volatility calming while credit keeps widening means the stress has moved from rates into credit.">
        <Grid defs={groups.rates} from={from} latest={T(latest)} range={range} />
      </Section>
      <Section title="5. Is it systemic yet?" intro="Composite stress indexes and the repo funding market. The stress indexes spiked in the April 2025 tariff shock and repo funding was tight in late 2025 (use the 2Y range). A credit-cost problem becomes a crisis when these light up.">
        <Grid defs={groups.systemic} from={from} latest={T(latest)} range={range} />
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
