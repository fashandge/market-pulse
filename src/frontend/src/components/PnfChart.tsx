import { useEffect, useRef, useState } from 'react'
import Plotly from 'react-plotly.js'

// Handle ESM/CJS default export differences (same as MarketCapChart)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Plot = (Plotly as any).default || Plotly

// Point & Figure chart: boxes come from /api/tickers/{t}/pnf-chart (the
// investment project's P&F library: high/low method, one-step-back for 1-box
// charts); this component only draws them.

interface PnfBox {
  column: number
  level: number
  kind: 'X' | 'O'
  start: string
  end: string
}

interface PnfColumn {
  column: number
  kind: 'X' | 'O'
  bottom: number
  top: number
  n_boxes: number
  lead: 'X' | 'O' | null
  start: string
  end: string
  volume: number
  days: number
  rel_volume: number | null
}

interface PnfProfileRow {
  level: number
  volume: number
}

interface PnfPayload {
  ticker: string
  source: string | null
  box_size: number
  reversal: number
  first_date: string
  last_date: string
  last_close: number
  n_columns: number
  columns: PnfColumn[]
  boxes: PnfBox[]
  has_volume: boolean
  notes: string[]
  volume_profile: PnfProfileRow[]
}

// Cap on the relative-volume axis so one extreme column (an IPO day against a
// dormant-ticker baseline) cannot flatten every other bar; hover shows the exact value.
const REL_VOL_AXIS_CAP = 8

type RangeKey = '3M' | '6M' | '1Y' | '2Y' | '5Y'
const RANGE_DAYS: Record<RangeKey, number> = { '3M': 92, '6M': 183, '1Y': 365, '2Y': 731, '5Y': 1827 }
const RANGES: RangeKey[] = ['3M', '6M', '1Y', '2Y', '5Y']

// Box-size choices: a percent of the last close (rounded server-side to a
// chart-friendly 1/2/2.5/5 x 10^k), or an exact value typed by the user.
type BoxPreset = '1%' | '2%' | '3%' | '5%' | 'custom'
const BOX_PCT: Record<Exclude<BoxPreset, 'custom'>, number> = { '1%': 0.01, '2%': 0.02, '3%': 0.03, '5%': 0.05 }
const BOX_PRESETS: BoxPreset[] = ['1%', '2%', '3%', '5%', 'custom']

type Reversal = 1 | 3
type Style = 'xo' | 'price'

// Solarized palette
const C = {
  base3: '#fdf6e3',
  base2: '#eee8d5',
  base1: '#93a1a1',
  base01: '#586e75',
  base00: '#657b83',
  blue: '#268bd2',
  green: '#859900',
  red: '#dc322f',
}

function readSession<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = sessionStorage.getItem(key)
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback
}

function decimalsFor(box: number): number {
  const s = box.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  return s.includes('.') ? s.split('.')[1].length : 0
}

export function PnfChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<RangeKey>(() => readSession('pnfRange', RANGES, '1Y'))
  const [boxPreset, setBoxPreset] = useState<BoxPreset>(() => readSession('pnfBoxPreset', BOX_PRESETS, '3%'))
  const [customBox, setCustomBox] = useState<string>(() => sessionStorage.getItem('pnfCustomBox') || '')
  const [reversal, setReversal] = useState<Reversal>(() =>
    sessionStorage.getItem('pnfReversal') === '1' ? 1 : 3,
  )
  const [style, setStyle] = useState<Style>(() => readSession('pnfStyle', ['xo', 'price'] as const, 'xo'))
  // Width of the chart wrapper, so Plotly gets an explicit pixel width: at least
  // the wrapper, wider (scrolling) when many columns need room for their labels.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapWidth, setWrapWidth] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWrapWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Last fetch result, tagged with the request it answered; `loading` is derived
  // by comparing that tag with the current request (no setState-in-effect).
  const [result, setResult] = useState<{ key: string; data?: PnfPayload; error?: string } | null>(null)

  const customBoxValue = Number(customBox)
  const customBoxValid = boxPreset !== 'custom' || (Number.isFinite(customBoxValue) && customBoxValue > 0)

  const params = new URLSearchParams({ since: String(RANGE_DAYS[range]), reversal: String(reversal) })
  if (boxPreset === 'custom') params.set('box', String(customBoxValue))
  else params.set('box_pct', String(BOX_PCT[boxPreset]))
  const requestKey = `${ticker}?${params.toString()}`
  const loading = customBoxValid && result?.key !== requestKey
  const data = !loading ? result?.data ?? null : null
  const error = !loading ? result?.error ?? null : null

  useEffect(() => {
    sessionStorage.setItem('pnfRange', range)
    sessionStorage.setItem('pnfBoxPreset', boxPreset)
    sessionStorage.setItem('pnfCustomBox', customBox)
    sessionStorage.setItem('pnfReversal', String(reversal))
    sessionStorage.setItem('pnfStyle', style)
  }, [range, boxPreset, customBox, reversal, style])

  useEffect(() => {
    if (!customBoxValid) return
    let cancelled = false
    const [path, query] = requestKey.split('?')
    // Debounce so typing a custom box size doesn't fire a request per keystroke.
    const handle = setTimeout(() => {
      fetch(`/api/tickers/${encodeURIComponent(path)}/pnf-chart?${query}`)
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => null)
            throw new Error(body?.detail || `HTTP ${res.status}`)
          }
          return res.json() as Promise<PnfPayload>
        })
        .then((payload) => {
          if (!cancelled) setResult({ key: requestKey, data: payload })
        })
        .catch((err) => {
          if (!cancelled) setResult({ key: requestKey, error: err instanceof Error ? err.message : 'Unknown error' })
        })
    }, boxPreset === 'custom' ? 400 : 0)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [requestKey, customBoxValid, boxPreset])

  const segButton = <T extends string | number>(
    value: T,
    current: T,
    label: string,
    onClick: (v: T) => void,
    i: number,
  ) => (
    <button
      key={String(value)}
      onClick={() => onClick(value)}
      className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
        i > 0 ? 'border-l border-sol-base1/30' : ''
      } ${current === value ? 'bg-sol-blue text-white' : 'bg-sol-base2 text-sol-base00 hover:bg-sol-base1/20'}`}
    >
      {label}
    </button>
  )

  const control = (label: string, children: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <span className="text-sm text-sol-base1">{label}</span>
      <div className="inline-flex rounded-lg overflow-hidden shadow-sm">{children}</div>
    </div>
  )

  let plot: React.ReactNode = null
  let caption: React.ReactNode = null
  if (data && data.boxes.length > 0) {
    const b = data.box_size
    const dec = decimalsFor(b)
    const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })
    const traces = (['X', 'O'] as const).map((kind) => {
      const sub = data.boxes.filter((bx) => bx.kind === kind)
      return {
        x: sub.map((bx) => bx.column),
        y: sub.map((bx) => bx.level),
        type: 'scatter' as const,
        mode: 'text' as const,
        name: kind === 'X' ? 'X (rising)' : 'O (falling)',
        text: sub.map((bx) => (style === 'price' ? fmt(bx.level) : kind)),
        textfont: {
          color: kind === 'X' ? C.green : C.red,
          size: style === 'price' ? 10 : 13,
          family: 'Menlo, Consolas, monospace',
        },
        hovertext: sub.map((bx) => `${kind} column ${bx.column}<br>box ${fmt(bx.level)}<br>${bx.start} → ${bx.end}`),
        hoverinfo: 'text' as const,
      }
    })
    // Volume panes: relative volume per column (below, shares x) and volume at
    // price (right, shares y). Skipped when the bars carry no volume.
    const showVol = data.has_volume
    const volTraces = showVol
      ? [
          {
            x: data.columns.map((c) => c.column),
            y: data.columns.map((c) => c.rel_volume ?? 0),
            type: 'bar' as const,
            xaxis: 'x',
            yaxis: 'y2',
            name: 'rel. volume',
            marker: { color: data.columns.map((c) => (c.kind === 'X' ? C.green : C.red)), opacity: 0.75 },
            hovertext: data.columns.map(
              (c) =>
                `${c.kind} column ${c.column}<br>${c.days} day${c.days === 1 ? '' : 's'}, ` +
                `${(c.volume / 1e6).toFixed(1)}M shares` +
                (c.rel_volume != null
                  ? `<br>rel. volume ${c.rel_volume.toFixed(2)}x`
                  : '<br>no 50-bar baseline yet (fewer than 10 prior bars) — no bar drawn'),
            ),
            hoverinfo: 'text' as const,
          },
          {
            x: data.volume_profile.map((r) => r.volume / 1e6),
            y: data.volume_profile.map((r) => r.level),
            type: 'bar' as const,
            orientation: 'h' as const,
            xaxis: 'x2',
            yaxis: 'y',
            width: b * 0.9,
            name: 'volume at price',
            marker: { color: C.base1, opacity: 0.55 },
            hovertext: data.volume_profile.map((r) => `${fmt(r.level)}: ${(r.volume / 1e6).toFixed(1)}M shares`),
            hoverinfo: 'text' as const,
          },
        ]
      : []
    // Sparse x ticks: the first column of each month, labelled with its start date.
    const seen = new Set<string>()
    const tickvals: number[] = []
    const ticktext: string[] = []
    for (const col of data.columns) {
      const month = col.start.slice(0, 7)
      if (!seen.has(month)) {
        seen.add(month)
        tickvals.push(col.column)
        ticktext.push(col.start)
      }
    }
    // Loop rather than Math.min(...spread): a spread throws RangeError past ~100k args.
    let lo = Infinity
    let hi = -Infinity
    for (const bx of data.boxes) {
      if (bx.level < lo) lo = bx.level
      if (bx.level > hi) hi = bx.level
    }
    const ymin = lo - b
    const ymax = hi + b
    const nLevels = Math.round((ymax - ymin) / b)
    // Room per column so price labels ("117.5") never overlap; wider than the
    // wrapper means the wrapper scrolls horizontally.
    const minWidth = (data.n_columns + 2) * (style === 'price' ? 40 : 18) + 90
    const plotWidth = Math.max(wrapWidth || 0, minWidth)
    const maxRel = data.columns.reduce((m, c) => Math.max(m, c.rel_volume ?? 0), 0)
    const relCap = Math.max(1.2, Math.min(maxRel * 1.05, REL_VOL_AXIS_CAP))
    const relCapped = maxRel > REL_VOL_AXIS_CAP
    const noBaseline = data.columns.filter((c) => c.rel_volume == null).length
    caption = (
      <>
        <span className="font-semibold text-sol-base01">{data.ticker}</span> Point &amp; Figure — box {fmt(b)} (
        {((b / data.last_close) * 100).toFixed(1)}% of last close), {data.reversal}-box reversal,{' '}
        {data.first_date} → {data.last_date}, {data.n_columns} columns, last {data.last_close.toFixed(2)}
        {data.source ? ` [${data.source}]` : ''}.{' '}
        <span className="text-sol-green">X</span> = rising column, <span className="text-sol-red">O</span> = falling
        column; hover a box for its column's dates.
        {data.has_volume &&
          ' Below: each column\'s volume relative to the 50-bar average before it (dotted line = 1×); right: volume traded at each price level.'}
        {data.has_volume && noBaseline > 0 && ` ${noBaseline} column${noBaseline === 1 ? '' : 's'} without a bar: fewer than 10 prior bars, so no 50-bar baseline (e.g. a new listing).`}
        {data.has_volume && relCapped && ` Volume axis capped at ${REL_VOL_AXIS_CAP}× (max ${maxRel.toFixed(1)}×) — hover a bar for the exact value.`}
        {data.notes.length > 0 && (
          <span className="text-sol-yellow"> Note: {data.notes.join('; ')}.</span>
        )}
      </>
    )
    const axisBase = { tickfont: { color: C.base00, size: 11 }, gridcolor: `${C.base1}40`, linecolor: C.base1, zeroline: false }
    const plotHeight = showVol ? 860 : 720
    plot = (
      <Plot
        data={[...traces, ...volTraces]}
        layout={{
          xaxis: {
            ...axisBase,
            title: { text: 'column (one per reversal; labels = column start date)', font: { color: C.base00 } },
            tickvals,
            ticktext,
            range: [-1, data.n_columns],
            domain: [0, showVol ? 0.85 : 1],
            anchor: showVol ? 'y2' : 'y',
          },
          yaxis: {
            ...axisBase,
            title: { text: 'price', font: { color: C.base00 } },
            range: [ymin, ymax],
            dtick: nLevels <= 80 ? b : undefined,
            tickformat: `,.${dec}f`,
            domain: [showVol ? 0.25 : 0, 1],
            anchor: 'x',
          },
          ...(showVol
            ? {
                xaxis2: {
                  ...axisBase,
                  title: { text: 'vol (M)', font: { color: C.base00, size: 11 } },
                  domain: [0.86, 1],
                  anchor: 'y',
                },
                yaxis2: {
                  ...axisBase,
                  title: { text: 'rel. vol', font: { color: C.base00, size: 11 } },
                  domain: [0, 0.21],
                  anchor: 'x',
                  range: [0, relCap],
                },
                shapes: [
                  {
                    type: 'line',
                    xref: 'paper',
                    x0: 0,
                    x1: 0.85,
                    yref: 'y2',
                    y0: 1,
                    y1: 1,
                    line: { color: C.base1, width: 1, dash: 'dot' },
                  },
                ],
              }
            : {}),
          showlegend: false,
          autosize: false,
          width: plotWidth,
          height: plotHeight,
          bargap: 0.15,
          margin: { t: 30, r: 20, b: 60, l: 70 },
          hovermode: 'closest',
          hoverlabel: { bgcolor: C.base2, bordercolor: C.blue, font: { color: C.base01 } },
          plot_bgcolor: C.base3,
          paper_bgcolor: C.base3,
          font: { family: 'Atkinson Hyperlegible, Helvetica, Arial, sans-serif' },
        }}
        style={{ width: `${plotWidth}px`, height: `${plotHeight}px` }}
        config={{ displaylogo: false }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {control('Range:', RANGES.map((r, i) => segButton(r, range, r, setRange, i)))}
        {control(
          'Box:',
          BOX_PRESETS.map((p, i) => segButton(p, boxPreset, p === 'custom' ? 'Custom' : p, setBoxPreset, i)),
        )}
        {boxPreset === 'custom' && (
          <input
            type="number"
            min="0"
            step="any"
            value={customBox}
            onChange={(e) => setCustomBox(e.target.value)}
            placeholder="box size, e.g. 2"
            className={`w-36 px-3 py-1.5 text-sm bg-sol-base3 border rounded-lg text-sol-base01 placeholder-sol-base1 focus:outline-none focus:ring-1 focus:ring-sol-blue ${
              customBoxValid ? 'border-sol-base1/40 focus:border-sol-blue' : 'border-sol-red'
            }`}
          />
        )}
        {control('Reversal:', [
          segButton<Reversal>(3, reversal, '3-box', setReversal, 0),
          segButton<Reversal>(1, reversal, '1-box (Wyckoff)', setReversal, 1),
        ])}
        {control('Style:', [
          segButton<Style>('xo', style, 'X / O', setStyle, 0),
          segButton<Style>('price', style, 'Price', setStyle, 1),
        ])}
      </div>

      {!customBoxValid && (
        <div className="flex items-center justify-center h-64 text-sol-base1">Enter a positive box size.</div>
      )}
      {customBoxValid && loading && (
        <div className="flex items-center justify-center h-64 text-sol-base1">Loading {ticker}…</div>
      )}
      {customBoxValid && error && (
        <div className="flex items-center justify-center h-64 text-sol-red">Error: {error}</div>
      )}
      {customBoxValid && !loading && !error && data && data.boxes.length === 0 && (
        <div className="flex items-center justify-center h-64 text-sol-base1">No P&F data for {ticker}.</div>
      )}
      {customBoxValid && !loading && !error && plot && <p className="text-sm text-sol-base00">{caption}</p>}
      <div
        ref={wrapRef}
        className={`w-full rounded-lg border border-sol-base1/30 overflow-x-auto ${
          customBoxValid && !loading && !error && plot ? '' : 'hidden'
        }`}
      >
        {customBoxValid && !loading && !error && plot}
      </div>
    </div>
  )
}
