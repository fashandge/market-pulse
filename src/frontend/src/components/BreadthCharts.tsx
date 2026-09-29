import { useEffect, useMemo, useRef, useState } from 'react'

// Market breadth against SPY and QQQ: a vertical stack of panels sharing one
// trading-day x-axis, so a breadth move and the price move it did (or did not)
// lead line up in one column. Data is the full history from
// /api/market/breadth (investment duckdb, updated nightly); ranges slice it
// client-side. Hover reads every panel on the same day; drag zooms;
// double-click returns to the selected range.

interface BreadthPayload {
  as_of: string | null
  dates: string[]
  series: Record<SeriesKey, (number | null)[]>
}

type SeriesKey =
  | 'spy' | 'qqq' | 's20' | 'n20' | 's50' | 'n50' | 's200' | 'n200'
  | 'snh' | 'nnh' | 'sad' | 'nad' | 'sdd' | 'ndd'
type Fam = 'spx' | 'ndx'
type Kind = 'price' | 'pct' | 'nh' | 'ad' | 'dd'

// Solarized; the two families are validated as a CVD-safe pair on base3.
const C = {
  base3: '#fdf6e3',
  base2: '#eee8d5',
  base1: '#93a1a1',
  base00: '#657b83',
  base01: '#586e75',
  base02: '#073642',
  grid: '#e4dcc3',
  panel: '#fbf3dc',
  band: 'rgba(147, 161, 161, 0.30)',
  spx: '#268bd2',
  ndx: '#cb4b16',
}
const MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"

const FAM: Record<Fam, { name: string; etf: string; color: string }> = {
  spx: { name: 'S&P 500', etf: 'SPY', color: C.spx },
  ndx: { name: 'Nasdaq-100', etf: 'QQQ', color: C.ndx },
}

const pct = (v: number) => (v * 100).toFixed(1) + '%'
const pp = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + ' pp'

interface PanelDef {
  id: string
  title: string
  short: string
  note: string
  h: number
  kind: Kind
  keys: Record<Fam, SeriesKey>
  fmt: (v: number) => string
}

const PANELS: PanelDef[] = [
  { id: 'price', title: 'Price, rebased to 100 at range start', short: 'Price', kind: 'price', h: 240,
    note: 'SPY and QQQ total-return prices (dividends reinvested).',
    keys: { spx: 'spy', ndx: 'qqq' }, fmt: (v) => v.toFixed(1) },
  { id: 'p200', title: 'Members above their 200-day average', short: '% > 200-day', kind: 'pct', h: 130,
    note: 'Long-term trend participation. Below 50% means most members are in downtrends.',
    keys: { spx: 's200', ndx: 'n200' }, fmt: pct },
  { id: 'p50', title: 'Members above their 50-day average', short: '% > 50-day', kind: 'pct', h: 130,
    note: 'Intermediate participation. Readings under 20% have tended to mark washed-out lows.',
    keys: { spx: 's50', ndx: 'n50' }, fmt: pct },
  { id: 'p20', title: 'Members above their 20-day average', short: '% > 20-day', kind: 'pct', h: 130,
    note: 'Short-term participation; the fastest and noisiest of the three.',
    keys: { spx: 's20', ndx: 'n20' }, fmt: pct },
  { id: 'nh', title: 'Net new 52-week highs', short: 'Net new highs', kind: 'nh', h: 130,
    note: 'Share of members at a 52-week high minus share at a 52-week low, in percentage points.',
    keys: { spx: 'snh', ndx: 'nnh' }, fmt: pp },
  { id: 'ad', title: 'Cumulative advance–decline line', short: 'A/D line', kind: 'ad', h: 130,
    note: 'Running sum from range start of each day’s (advancers − decliners) as a share of members. Rising price with a falling line is a divergence.',
    keys: { spx: 'sad', ndx: 'nad' }, fmt: (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(0) },
  { id: 'dd', title: 'Distribution days, last 5 weeks', short: 'Distribution days', kind: 'dd', h: 110,
    note: 'Days the ETF fell on higher volume (institutional selling). Five or more has often preceded corrections.',
    keys: { spx: 'sdd', ndx: 'ndd' }, fmt: (v) => String(v) },
]

type RangeKey = '3M' | '6M' | '1Y' | '2Y' | '5Y' | '10Y' | 'Max'
const RANGE_DAYS: Record<RangeKey, number> = { '3M': 63, '6M': 126, '1Y': 252, '2Y': 504, '5Y': 1260, '10Y': 2520, Max: Infinity }
const RANGES = Object.keys(RANGE_DAYS) as RangeKey[]

const ML = 52, MR = 14, MT = 8
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function trailMean(a: (number | null)[], w: number): (number | null)[] {
  if (w <= 1) return a
  const out: (number | null)[] = new Array(a.length).fill(null)
  let s = 0, n = 0
  for (let i = 0; i < a.length; i++) {
    const v = a[i]
    if (v != null) { s += v; n++ }
    if (i >= w) { const o = a[i - w]; if (o != null) { s -= o; n-- } }
    if (i >= w - 1 && n === w) out[i] = s / n
  }
  return out
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag
  const t: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10))
  return t
}

function logTicks(lo: number, hi: number): number[] {
  const base = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]
  let t: number[] = []
  for (let e = -1; e <= 4; e++) base.forEach((b) => { const v = b * 10 ** e; if (v >= lo && v <= hi) t.push(v) })
  while (t.length > 7) t = t.filter((_, i) => i % 2 === 0)
  return t.length < 3 ? niceTicks(lo, hi, 4).filter((v) => v > 0) : t
}

function fmtDate(s: string) {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

function readStore(k: string): string | null {
  try { return sessionStorage.getItem(k) } catch { return null }
}
function writeStore(k: string, v: string) {
  try { sessionStorage.setItem(k, v) } catch { /* storage blocked: keep in-memory state */ }
}

const btn = (active: boolean): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${active ? C.base01 : C.grid}`,
  background: active ? C.base2 : 'transparent',
  color: C.base02, fontWeight: active ? 700 : 400,
})
const groupLabel: React.CSSProperties = {
  fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.base1, marginRight: 4,
}

function LineKey({ fam }: { fam: Fam }) {
  return <span style={{ display: 'inline-block', width: 16, borderTop: `2px solid ${FAM[fam].color}`, borderRadius: 2 }} />
}

export function BreadthCharts() {
  const [data, setData] = useState<BreadthPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<RangeKey | null>(() => {
    const s = readStore('breadthRange')
    return RANGES.includes(s as RangeKey) ? (s as RangeKey) : '1Y'
  })
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  const [fams, setFams] = useState<Record<Fam, boolean>>({ spx: true, ndx: true })
  const [shade, setShade] = useState(true)
  const [ddThr, setDdThr] = useState(0.1)
  const [logScale, setLogScale] = useState(true)
  const [smooth, setSmooth] = useState(10)
  const [show, setShow] = useState<Record<string, boolean>>(() => {
    const base = Object.fromEntries(PANELS.map((p) => [p.id, true]))
    try { return { ...base, ...JSON.parse(readStore('breadthPanels') || '{}') } } catch { return base }
  })
  const [hover, setHover] = useState<number | null>(null)
  const [brush, setBrush] = useState<{ panel: string; a: number; b: number } | null>(null)
  const [width, setWidth] = useState(0)
  const stackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/market/breadth')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    const el = stackRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [data])

  const N = data?.dates.length ?? 0
  const [i0, i1] = useMemo<[number, number]>(() => {
    if (zoom) return zoom
    const n = RANGE_DAYS[preset ?? '1Y']
    return [Math.max(0, N - (isFinite(n) ? n : N)), N - 1]
  }, [zoom, preset, N])

  // SPY drawdown from its running all-time high, over the full history.
  const spyDD = useMemo(() => {
    if (!data) return []
    let m = -Infinity
    return data.series.spy.map((v) => { if (v == null) return 0; m = Math.max(m, v); return v / m - 1 })
  }, [data])

  const smoothed = useMemo(() => {
    if (!data) return null
    return { snh: trailMean(data.series.snh, smooth), nnh: trailMean(data.series.nnh, smooth) }
  }, [data, smooth])

  const bands = useMemo(() => {
    const out: [number, number][] = []
    if (!data || !shade) return out
    let s: number | null = null
    for (let i = i0; i <= i1; i++) {
      const on = spyDD[i] <= -ddThr
      if (on && s == null) s = i
      if ((!on || i === i1) && s != null) { out.push([s, on ? i : i - 1]); s = null }
    }
    // Dips that briefly recover above the line (gap under 10 trading days) are one episode.
    for (let k = out.length - 1; k > 0; k--) {
      if (out[k][0] - out[k - 1][1] < 10) { out[k - 1][1] = out[k][1]; out.splice(k, 1) }
    }
    return out
  }, [data, shade, ddThr, spyDD, i0, i1])

  const deepest = useMemo(() => {
    let lo = 0
    for (let i = i0; i <= i1; i++) lo = Math.min(lo, spyDD[i] ?? 0)
    return lo
  }, [spyDD, i0, i1])

  const xTicks = useMemo(() => {
    if (!data) return []
    const span = i1 - i0, out: [number, string][] = []
    const yrStep = span > 3000 ? 2 : 1
    const monStep = span > 700 ? 12 : span > 300 ? 3 : 1
    for (let i = i0 + 1; i <= i1; i++) {
      const d = data.dates[i], prev = data.dates[i - 1]
      if (d.slice(0, 7) === prev.slice(0, 7)) continue
      const y = +d.slice(0, 4), m = +d.slice(5, 7)
      if (monStep === 12) { if (m === 1 && y % yrStep === 0) out.push([i, String(y)]) }
      else if ((m - 1) % monStep === 0) out.push([i, m === 1 ? String(y) : MON[m - 1]])
    }
    return out
  }, [data, i0, i1])

  const W = Math.max(0, width - 22)
  const pw = W - ML - MR
  const X = (i: number) => ML + (i1 > i0 ? ((i - i0) / (i1 - i0)) * pw : 0)
  const visible = PANELS.filter((p) => show[p.id])
  const famList = (['spx', 'ndx'] as Fam[]).filter((f) => fams[f])

  // Per-panel geometry: values over the range, y-scale, ticks and path strings.
  const panels = useMemo(() => {
    if (!data || !smoothed || pw <= 0) return []
    return visible.map((p, idx) => {
      const last = idx === visible.length - 1
      const series = famList.map((f) => {
        const key = p.keys[f], a = data.series[key], v: (number | null)[] = []
        if (p.kind === 'price') { const b = a[i0] as number; for (let i = i0; i <= i1; i++) v.push(a[i] == null ? null : (a[i] as number) / b * 100) }
        else if (p.kind === 'ad') { let s = 0; for (let i = i0; i <= i1; i++) { if (i > i0) s += a[i] ?? 0; v.push(s) } }
        else if (p.kind === 'nh') { const m = smoothed[key as 'snh' | 'nnh']; for (let i = i0; i <= i1; i++) v.push(m[i]) }
        else for (let i = i0; i <= i1; i++) v.push(a[i])
        return { f, v }
      })
      let lo: number, hi: number
      const useLog = p.kind === 'price' && logScale
      if (p.kind === 'pct') { lo = 0; hi = 1 }
      else {
        lo = Infinity; hi = -Infinity
        series.forEach((s) => s.v.forEach((x) => { if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x) } }))
        if (!isFinite(lo)) { lo = 0; hi = 1 }
        if (p.kind === 'nh' || p.kind === 'ad') { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
        if (p.kind === 'dd') { lo = 0; hi = Math.max(hi, 6) }
        const pad = (hi - lo) * 0.06 || 1
        if (useLog) { lo /= 1.03; hi *= 1.03 }
        else if (p.kind !== 'dd') { lo -= pad; hi += pad }
      }
      const ph = p.h
      const Y = useLog
        ? (v: number) => MT + ((Math.log(hi) - Math.log(v)) / (Math.log(hi) - Math.log(lo))) * ph
        : (v: number) => MT + ((hi - v) / (hi - lo)) * ph
      const yt = p.kind === 'pct' ? [0, 0.2, 0.5, 0.8, 1] : useLog ? logTicks(lo, hi) : niceTicks(lo, hi, p.kind === 'dd' ? 3 : 4)
      const ytFmt = p.kind === 'pct' ? (v: number) => Math.round(v * 100) + '%'
        : p.kind === 'nh' || p.kind === 'ad' ? (v: number) => String(Math.round(v * 100))
        : (v: number) => String(+v.toFixed(2))
      const paths = series.map((s) => {
        let d = '', pen = false
        s.v.forEach((x, k) => {
          if (x == null || (useLog && x <= 0)) { pen = false; return }
          const px = X(i0 + k).toFixed(1), py = Y(x).toFixed(1)
          d += p.kind === 'dd' && pen ? `H${px}V${py}` : (pen ? 'L' : 'M') + px + ' ' + py
          pen = true
        })
        return { f: s.f, d }
      })
      const baseline = p.kind === 'price' ? 100 : p.kind === 'nh' || p.kind === 'ad' ? 0 : null
      return { p, last, series, Y, ph, yt, ytFmt, paths, useLog, baseline, H: ph + MT + (last ? 24 : 6) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, smoothed, i0, i1, pw, logScale, show, fams])

  if (error) return <div className="text-sol-red p-4">Error: {error}</div>
  if (!data) return <div className="text-sol-base1 p-4">Loading breadth history...</div>

  const idxAt = (el: SVGSVGElement, clientX: number) => {
    const r = el.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - r.left - ML) / (r.width - ML - MR)))
    return Math.round(i0 + f * (i1 - i0))
  }
  const selectRange = (r: RangeKey) => { setPreset(r); setZoom(null); writeStore('breadthRange', r) }
  const togglePanel = (id: string) => {
    const next = { ...show, [id]: !show[id] }
    setShow(next); writeStore('breadthPanels', JSON.stringify(next))
  }
  const toggleFam = (f: Fam) => {
    const next = { ...fams, [f]: !fams[f] }
    if (!next.spx && !next.ndx) next[f === 'spx' ? 'ndx' : 'spx'] = true
    setFams(next)
  }

  const at = hover ?? i1
  const thrPct = Math.round(ddThr * 100)
  const bandNote = !shade ? '' : bands.length
    ? `Shaded bands mark days when SPY closed at least ${thrPct}% below its prior all-time high (${bands.length} episode${bands.length > 1 ? 's' : ''} in this range; deepest ${(-deepest * 100).toFixed(1)}%), so you can compare breadth going into and coming out of each drop.`
    : `No shading in this range: SPY's deepest close was ${(-deepest * 100).toFixed(1)}% below its prior high, short of the ${thrPct}% threshold. Lower the threshold or widen the range.`

  return (
    <div style={{ color: C.base02 }}>
      <p style={{ margin: '0 0 12px', color: C.base01, fontSize: 14.5, maxWidth: '80ch' }}>
        Every panel shares one trading-day axis. Hover to read all panels on the same day; drag across a
        panel to zoom, double-click to go back. Breadth counts the actual index members on each date
        (S&amp;P 500 for SPY, Nasdaq-100 for QQQ).
      </p>

      {/* Filter row */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5, background: C.base3,
        display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center',
        padding: '10px 0', borderBottom: `1px solid ${C.grid}`,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={groupLabel}>Range</span>
          {RANGES.map((r) => (
            <button key={r} style={btn(!zoom && preset === r)} aria-pressed={!zoom && preset === r} onClick={() => selectRange(r)}>{r}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={groupLabel}>Index</span>
          {(['spx', 'ndx'] as Fam[]).map((f) => (
            <button key={f} style={{ ...btn(fams[f]), display: 'inline-flex', alignItems: 'center', gap: 6 }}
              aria-pressed={fams[f]} onClick={() => toggleFam(f)}>
              <LineKey fam={f} />{FAM[f].name} · {FAM[f].etf}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center', fontSize: 13.5 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={shade} onChange={(e) => setShade(e.target.checked)} />
            <span style={{ width: 14, height: 12, background: C.band, display: 'inline-block' }} />
            Shade SPY drawdowns ≥
            <select value={ddThr} onChange={(e) => setDdThr(+e.target.value)} style={{ fontFamily: 'inherit', fontSize: 13.5 }}>
              <option value={0.05}>5%</option><option value={0.1}>10%</option><option value={0.2}>20%</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
            Log price scale
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            New-highs smoothing
            <select value={smooth} onChange={(e) => setSmooth(+e.target.value)} style={{ fontFamily: 'inherit', fontSize: 13.5 }}>
              <option value={1}>None</option><option value={5}>5-day</option><option value={10}>10-day</option><option value={20}>20-day</option>
            </select>
          </label>
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 13, color: C.base01 }}>
          {hover == null ? 'Latest: ' : ''}{fmtDate(data.dates[at])}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', margin: '8px 0', fontSize: 13 }}>
        {PANELS.map((p) => (
          <label key={p.id} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', color: C.base01 }}>
            <input type="checkbox" checked={show[p.id]} onChange={() => togglePanel(p.id)} />{p.short}
          </label>
        ))}
      </div>

      <div ref={stackRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {panels.map(({ p, last, series, Y, ph, yt, ytFmt, paths, useLog, baseline, H }) => {
          const k = at - i0
          return (
            <section key={p.id} style={{ background: C.panel, border: `1px solid ${C.grid}`, borderRadius: 8, padding: '8px 10px 4px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 16px', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.title}</div>
                  <div style={{ color: C.base00, fontSize: 12.5 }}>{p.note}</div>
                </div>
                <div style={{ display: 'flex', gap: 14, fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                  {series.map((s) => {
                    const v = s.v[k]
                    return (
                      <span key={s.f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <LineKey fam={s.f} />
                        <b style={{ fontWeight: 600 }}>{v == null ? '—' : p.fmt(v)}</b>
                        <small style={{ color: C.base00 }}>{p.kind === 'price' || p.kind === 'dd' ? FAM[s.f].etf : FAM[s.f].name}</small>
                      </span>
                    )
                  })}
                </div>
              </div>
              <svg
                width={W} height={H} viewBox={`0 0 ${W} ${H}`}
                style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
                tabIndex={0} role="img" aria-label={p.title}
                onPointerMove={(e) => {
                  const i = idxAt(e.currentTarget, e.clientX)
                  setHover(i)
                  if (brush && brush.panel === p.id) setBrush({ ...brush, b: i })
                }}
                onPointerLeave={() => { if (!brush) setHover(null) }}
                onPointerDown={(e) => {
                  if (e.pointerType !== 'mouse' || e.button !== 0) return
                  const i = idxAt(e.currentTarget, e.clientX)
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setBrush({ panel: p.id, a: i, b: i })
                }}
                onPointerUp={() => {
                  if (!brush) return
                  const a = Math.min(brush.a, brush.b), b = Math.max(brush.a, brush.b)
                  setBrush(null)
                  if (b - a >= 10) setZoom([a, b])
                }}
                onDoubleClick={() => setZoom(null)}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 21 : 1
                  if (e.key === 'ArrowLeft') { setHover(Math.max(i0, at - step)); e.preventDefault() }
                  if (e.key === 'ArrowRight') { setHover(Math.min(i1, at + step)); e.preventDefault() }
                  if (e.key === 'Escape') setHover(null)
                }}
                onBlur={() => setHover(null)}
              >
                {bands.map(([a, b]) => (
                  <rect key={a} x={X(a)} y={MT} width={Math.max(1, X(b) - X(a))} height={ph} fill={C.band} />
                ))}
                {xTicks.map(([i]) => (
                  <line key={i} x1={X(i)} x2={X(i)} y1={MT} y2={MT + ph} stroke={C.grid} strokeWidth={1} />
                ))}
                {yt.map((v) => (
                  <g key={v}>
                    <line x1={ML} x2={ML + pw} y1={Y(v)} y2={Y(v)}
                      stroke={baseline != null && Math.abs(v - baseline) < 1e-9 ? C.base1 : C.grid} strokeWidth={1} />
                    <text x={ML - 6} y={Y(v)} dy="0.35em" textAnchor="end" fill={C.base00}
                      style={{ fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{ytFmt(v)}</text>
                  </g>
                ))}
                {last && xTicks.map(([i, lab]) => (
                  <text key={'x' + i} x={X(i)} y={MT + ph + 16} textAnchor="middle" fill={C.base00}
                    style={{ fontFamily: MONO, fontSize: 11 }}>{lab}</text>
                ))}
                {paths.map((pa) => (
                  <path key={pa.f} d={pa.d} fill="none" stroke={FAM[pa.f].color}
                    strokeWidth={p.kind === 'price' ? 2 : 1.6} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {hover != null && (
                  <>
                    <line x1={X(at)} x2={X(at)} y1={MT} y2={MT + ph} stroke={C.base01} strokeWidth={1} />
                    {series.map((s) => {
                      const v = s.v[k]
                      if (v == null || (useLog && v <= 0)) return null
                      return <circle key={s.f} cx={X(at)} cy={Y(v)} r={4} fill={FAM[s.f].color} stroke={C.panel} strokeWidth={2} />
                    })}
                  </>
                )}
                {brush && brush.panel === p.id && (
                  <rect x={X(Math.min(brush.a, brush.b))} y={MT} height={ph}
                    width={Math.abs(X(brush.b) - X(brush.a))} fill={C.base01} fillOpacity={0.12} />
                )}
              </svg>
            </section>
          )
        })}
      </div>
      <p style={{ fontSize: 12.5, color: C.base00, margin: '6px 2px 0' }}>{bandNote}</p>

      <LatestReadings data={data} />

      <p style={{ fontSize: 12.5, color: C.base1, marginTop: 16, maxWidth: '95ch' }}>
        Source: investment project duckdb (market_breadth_daily, daily_bars_adjusted, index_distribution_days),
        through the {fmtDate(data.dates[N - 1])} close. Breadth uses point-in-time index membership. Prices are
        split- and dividend-adjusted. Moving-average and 52-week measures start once enough history exists.
      </p>
    </div>
  )
}

// Level now and change over ~1 month (21 trading days), per index family.
function LatestReadings({ data }: { data: BreadthPayload }) {
  const N = data.dates.length, L = N - 1, M = N - 22
  const s = data.series
  const rows: [string, SeriesKey, SeriesKey, (v: number) => string, (a: number, b: number) => string][] = [
    ['SPY / QQQ price', 'spy', 'qqq', (v) => '$' + v.toFixed(2), (a, b) => ((a / b - 1) * 100).toFixed(1) + '%'],
    ['Above 200-day average', 's200', 'n200', pct, (a, b) => pp(a - b)],
    ['Above 50-day average', 's50', 'n50', pct, (a, b) => pp(a - b)],
    ['Above 20-day average', 's20', 'n20', pct, (a, b) => pp(a - b)],
    ['Net new 52-week highs (1 day)', 'snh', 'nnh', pp, (a, b) => pp(a - b)],
    ['Distribution days, 5 weeks', 'sdd', 'ndd', (v) => String(v), (a, b) => (a - b >= 0 ? '+' : '') + (a - b)],
  ]
  const cell = (k: SeriesKey, f: (v: number) => string, df: (a: number, b: number) => string) => {
    const a = s[k][L], b = M >= 0 ? s[k][M] : null
    return [a == null ? '—' : f(a), a == null || b == null ? '—' : df(a, b)]
  }
  const th: React.CSSProperties = { padding: '5px 10px', textAlign: 'right', fontWeight: 700, borderBottom: `1px solid ${C.grid}`, background: C.panel, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '4px 10px', textAlign: 'right', borderBottom: `1px solid ${C.grid}`, whiteSpace: 'nowrap' }
  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>Latest readings, close of {fmtDate(data.dates[L])}</div>
      <div style={{ overflowX: 'auto', border: `1px solid ${C.grid}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              {['Measure', 'S&P 500 · SPY', 'change, 1 month', 'Nasdaq-100 · QQQ', 'change, 1 month'].map((h, i) => (
                <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b, f, df]) => (
              <tr key={label}>
                <td style={{ ...td, textAlign: 'left' }}>{label}</td>
                {[...cell(a, f, df), ...cell(b, f, df)].map((v, i) => <td key={i} style={td}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
