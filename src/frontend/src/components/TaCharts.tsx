import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  createTextWatermark,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'

// One OHLCV+indicators bar. Keys vary by timeframe (week_start vs date, the MA
// set, roc_12 vs cci_20, …) so we keep it loosely typed and read by config.
type Bar = Record<string, number | string | null>

type Timeframe = 'weekly' | 'monthly' | 'daily'
type RangeKey = '3M' | '6M' | '1Y' | '2Y' | '5Y' | '10Y' | 'Max'
type PaneKind = 'volume' | 'macd' | 'rsi' | 'obv' | 'kdj' | 'roc' | 'cci'

interface MASpec {
  key: string
  label: string
  color: string
  dashed?: boolean
}

interface TfConfig {
  endpoint: (ticker: string) => string
  timeKey: string // 'week_start' | 'date'
  mas: MASpec[] // overlays on the price pane
  volAvgKey: string
  volAvgLabel: string
  panes: PaneKind[] // indicator panes below price, in order
  rocKey?: string // payload key for the 'roc' pane (roc_12 weekly, roc_3 monthly)
  rocTitle?: string // pane title for the 'roc' pane (e.g. 'ROC 12')
  ranges: RangeKey[]
  defaultRange: RangeKey
  rangeBars: Partial<Record<RangeKey, number>>
  titleSuffix: string // 'Weekly' | 'Monthly' | 'Daily'
}

// Solarized palette
const C = {
  base3: '#fdf6e3',
  base2: '#eee8d5',
  base1: '#93a1a1',
  base01: '#586e75',
  base00: '#657b83',
  blue: '#268bd2',
  cyan: '#2aa198',
  green: '#859900',
  red: '#dc322f',
  yellow: '#b58900',
  orange: '#cb4b16',
  magenta: '#d33682',
  violet: '#6c71c4',
  redLight: '#e8918f',
  amber: '#e89611',
}

const CONFIG: Record<Timeframe, TfConfig> = {
  weekly: {
    endpoint: (t) => `/api/tickers/${t.toLowerCase()}/weekly-chart`,
    timeKey: 'week_start',
    mas: [
      { key: 'sma_5', label: 'SMA5', color: C.green },
      { key: 'sma_10', label: 'SMA10', color: C.violet },
      { key: 'sma_40', label: 'SMA40', color: C.red },
    ],
    volAvgKey: 'vol_avg_4',
    volAvgLabel: '4wk',
    panes: ['volume', 'macd', 'rsi', 'obv', 'roc', 'kdj'],
    rocKey: 'roc_12',
    rocTitle: 'ROC 12',
    ranges: ['1Y', '2Y', '5Y', 'Max'],
    defaultRange: '1Y',
    rangeBars: { '1Y': 52, '2Y': 104, '5Y': 260 },
    titleSuffix: 'Weekly',
  },
  monthly: {
    endpoint: (t) => `/api/tickers/${t.toLowerCase()}/monthly-chart`,
    timeKey: 'month_start',
    mas: [
      { key: 'sma_3', label: 'SMA3', color: C.green },
      { key: 'sma_12', label: 'SMA12', color: C.violet },
      { key: 'ema_21', label: 'EMA21', color: C.blue, dashed: true },
    ],
    volAvgKey: 'vol_avg_3',
    volAvgLabel: '3mo',
    panes: ['volume', 'macd', 'rsi', 'obv', 'roc', 'kdj'],
    rocKey: 'roc_3',
    rocTitle: 'ROC 3',
    ranges: ['1Y', '2Y', '5Y', '10Y', 'Max'],
    defaultRange: '2Y',
    rangeBars: { '1Y': 12, '2Y': 24, '5Y': 60, '10Y': 120 },
    titleSuffix: 'Monthly',
  },
  daily: {
    endpoint: (t) => `/api/tickers/${t.toLowerCase()}/daily-chart`,
    timeKey: 'date',
    mas: [
      { key: 'ema_8', label: 'EMA8', color: C.amber, dashed: true },
      { key: 'ema_13', label: 'EMA13', color: C.blue, dashed: true },
      { key: 'ema_21', label: 'EMA21', color: C.green, dashed: true },
      { key: 'ema_50', label: 'EMA50', color: C.violet, dashed: true },
      { key: 'sma_100', label: 'SMA100', color: C.red, dashed: true },
      { key: 'sma_150', label: 'SMA150', color: C.redLight, dashed: true },
      { key: 'sma_200', label: 'SMA200', color: C.red },
    ],
    volAvgKey: 'vol_avg_10',
    volAvgLabel: '10d',
    panes: ['volume', 'macd', 'rsi', 'obv', 'kdj', 'cci'],
    ranges: ['3M', '6M', '1Y', '2Y', 'Max'],
    defaultRange: '3M',
    rangeBars: { '3M': 63, '6M': 126, '1Y': 252, '2Y': 504 },
    titleSuffix: 'Daily',
  },
}

// Vertical stretch per pane kind; the price pane is always tallest.
const PRICE_STRETCH = 3.2
const PANE_STRETCH: Record<PaneKind, number> = {
  volume: 1,
  macd: 1.2,
  rsi: 1,
  obv: 1,
  kdj: 1.2,
  roc: 1.2,
  cci: 1.2,
}

const PANE_TITLE: Record<PaneKind, string> = {
  volume: 'Volume',
  macd: 'MACD (12,26,9)',
  rsi: 'RSI 14',
  obv: 'OBV',
  kdj: 'KDJ (9,3,3)',
  roc: 'ROC 12',
  cci: 'CCI 20',
}

const lineOpts = (color: string) => ({
  color,
  lineWidth: 2 as const,
  priceLineVisible: false,
  lastValueVisible: false,
})

// ── Legend (per-pane top-left watermark, updated live on hover) ──────────────
const TITLE_COLOR = 'rgba(88,110,117,0.55)'
const seg = (text: string, color: string) => ({
  text,
  color,
  fontSize: 12,
  fontFamily: 'inherit',
  fontStyle: '',
})

const num = (v: Bar[string]): number | null => (typeof v === 'number' ? v : null)
const f2 = (v: Bar[string]) => {
  const n = num(v)
  return n == null ? '–' : n.toFixed(2)
}
const fVol = (v: Bar[string]) => {
  const n = num(v)
  if (n == null) return '–'
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}

// Value lines (excluding the title line) for one indicator pane.
const paneLegend = (kind: PaneKind, r: Bar, cfg: TfConfig) => {
  switch (kind) {
    case 'volume':
      return [
        seg(`Vol ${fVol(r.volume)}`, C.base01),
        seg(`${cfg.volAvgLabel} ${fVol(r[cfg.volAvgKey])}`, C.violet),
      ]
    case 'macd':
      return [
        seg(`MACD ${f2(r.macd)}`, C.blue),
        seg(`Signal ${f2(r.macd_signal)}`, C.orange),
        seg(`Hist ${f2(r.macd_hist)}`, C.base01),
      ]
    case 'rsi':
      return [seg(`RSI ${f2(r.rsi_14)}`, C.violet)]
    case 'obv':
      return [seg(`OBV ${fVol(r.obv)}`, C.cyan)]
    case 'kdj':
      return [
        seg(`K ${f2(r.kdj_k)}`, C.blue),
        seg(`D ${f2(r.kdj_d)}`, C.orange),
        seg(`J ${f2(r.kdj_j)}`, C.magenta),
      ]
    case 'roc':
      return [seg(`ROC ${f2(r[cfg.rocKey ?? 'roc_12'])}`, C.yellow)]
    case 'cci':
      return [seg(`CCI ${f2(r.cci_20)}`, C.violet)]
  }
}

// All panes' watermark lines for one bar: [price pane, ...indicator panes].
const legendLines = (r: Bar, ticker: string, cfg: TfConfig) => {
  const price = [
    seg(`${ticker} · ${cfg.titleSuffix}  ·  ${String(r[cfg.timeKey])}`, TITLE_COLOR),
    seg(`O ${f2(r.open)}  H ${f2(r.high)}  L ${f2(r.low)}  C ${f2(r.close)}`, C.base01),
    ...cfg.mas.map((m) => seg(`${m.label} ${f2(r[m.key])}`, m.color)),
  ]
  const indicators = cfg.panes.map((kind) => {
    let title: string = PANE_TITLE[kind]
    if (kind === 'volume') title = `Volume + ${cfg.volAvgLabel} avg`
    else if (kind === 'roc') title = cfg.rocTitle ?? PANE_TITLE.roc
    return [seg(title, TITLE_COLOR), ...paneLegend(kind, r, cfg)]
  })
  return [price, ...indicators]
}

// ── Background-band primitives (drawn behind the pane's line series) ─────────

// Vertical green/red zones marking a bull/bear regime over time (KDJ K≥D).
const REGIME_GREEN = 'rgba(133,153,0,0.16)'
const REGIME_RED = 'rgba(220,50,47,0.13)'

interface RegimeBar {
  time: Time
  bull: boolean
}

class RegimeBandsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _chart: IChartApi | null,
    private _bars: RegimeBar[],
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    const chart = this._chart
    if (!chart) return
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const ts = chart.timeScale()
      const half = ts.options().barSpacing / 2
      // Merge consecutive visible bars of the same regime into runs.
      const runs: { start: number; end: number; bull: boolean }[] = []
      for (const b of this._bars) {
        const x = ts.timeToCoordinate(b.time)
        if (x == null) continue
        const last = runs[runs.length - 1]
        if (last && last.bull === b.bull) last.end = x
        else runs.push({ start: x, end: x, bull: b.bull })
      }
      runs.forEach((run, i) => {
        const left = i === 0 ? 0 : run.start - half
        const right = i === runs.length - 1 ? mediaSize.width : run.end + half
        context.fillStyle = run.bull ? REGIME_GREEN : REGIME_RED
        context.fillRect(left, 0, right - left, mediaSize.height)
      })
    })
  }
}

class RegimeBandsPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null
  constructor(private _bars: RegimeBar[]) {}
  attached(p: SeriesAttachedParameter<Time>) {
    this._chart = p.chart
  }
  detached() {
    this._chart = null
  }
  paneViews(): IPrimitivePaneView[] {
    return [
      {
        zOrder: (): PrimitivePaneViewZOrder => 'bottom',
        renderer: () => new RegimeBandsRenderer(this._chart, this._bars),
      },
    ]
  }
}

// Horizontal shaded band between two price levels (e.g. RSI 30–70).
class PriceBandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _series: ISeriesApi<'Line'> | null,
    private _lower: number,
    private _upper: number,
    private _color: string,
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    const series = this._series
    if (!series) return
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const yUpper = series.priceToCoordinate(this._upper)
      const yLower = series.priceToCoordinate(this._lower)
      if (yUpper == null || yLower == null) return
      context.fillStyle = this._color
      context.fillRect(0, yUpper, mediaSize.width, yLower - yUpper)
    })
  }
}

class PriceBandPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<'Line'> | null = null
  constructor(
    private _lower: number,
    private _upper: number,
    private _color: string,
  ) {}
  attached(p: SeriesAttachedParameter<Time>) {
    this._series = p.series as ISeriesApi<'Line'>
  }
  detached() {
    this._series = null
  }
  paneViews(): IPrimitivePaneView[] {
    return [
      {
        zOrder: (): PrimitivePaneViewZOrder => 'bottom',
        renderer: () => new PriceBandRenderer(this._series, this._lower, this._upper, this._color),
      },
    ]
  }
}

// ── Pane builders ────────────────────────────────────────────────────────────
function buildIndicatorPane(
  kind: PaneKind,
  chart: IChartApi,
  paneIndex: number,
  rows: Bar[],
  cfg: TfConfig,
) {
  const time = (r: Bar) => r[cfg.timeKey] as Time
  const lineData = (key: string) =>
    rows.filter((r) => num(r[key]) != null).map((r) => ({ time: time(r), value: r[key] as number }))

  const addLine = (key: string, color: string, width: 1 | 2 = 2) => {
    const s = chart.addSeries(LineSeries, { ...lineOpts(color), lineWidth: width }, paneIndex)
    s.setData(lineData(key))
    return s
  }

  const guide = (series: ISeriesApi<'Line'>, price: number, color: string, label = '') =>
    series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: label !== '',
      title: label,
    })

  switch (kind) {
    case 'volume': {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' } }, paneIndex)
      vol.setData(
        rows.map((r) => ({
          time: time(r),
          value: r.volume as number,
          color: (r.close as number) >= (r.open as number)
            ? 'rgba(133,153,0,0.5)'
            : 'rgba(220,50,47,0.5)',
        })),
      )
      addLine(cfg.volAvgKey, C.violet, 1)
      break
    }
    case 'macd': {
      const hist = chart.addSeries(HistogramSeries, {}, paneIndex)
      hist.setData(
        rows
          .filter((r) => num(r.macd_hist) != null)
          .map((r) => ({
            time: time(r),
            value: r.macd_hist as number,
            color: (r.macd_hist as number) >= 0 ? 'rgba(133,153,0,0.6)' : 'rgba(220,50,47,0.6)',
          })),
      )
      addLine('macd', C.blue)
      addLine('macd_signal', C.orange)
      break
    }
    case 'rsi': {
      const rsi = chart.addSeries(LineSeries, lineOpts(C.violet), paneIndex)
      rsi.setData(lineData('rsi_14'))
      // Soft fill across the 30–70 band, plus dashed 30/50/70 guides.
      rsi.attachPrimitive(new PriceBandPrimitive(30, 70, 'rgba(108,113,196,0.11)'))
      for (const [price, color] of [[70, C.red], [50, C.base1], [30, C.green]] as const) {
        guide(rsi, price, color, String(price))
      }
      break
    }
    case 'obv':
      addLine('obv', C.cyan)
      break
    case 'kdj': {
      // Alternating green/red regime bands (K≥D bullish vs K<D bearish),
      // behind the K/D/J lines, plus dashed 80/20 overbought-oversold guides.
      const k = addLine('kdj_k', C.blue)
      addLine('kdj_d', C.orange)
      addLine('kdj_j', C.magenta)
      const regime = rows
        .filter((r) => num(r.kdj_k) != null && num(r.kdj_d) != null)
        .map((r) => ({ time: time(r), bull: (r.kdj_k as number) >= (r.kdj_d as number) }))
      k.attachPrimitive(new RegimeBandsPrimitive(regime))
      for (const price of [80, 20]) guide(k, price, C.base1, String(price))
      break
    }
    case 'roc': {
      const roc = chart.addSeries(LineSeries, lineOpts(C.yellow), paneIndex)
      roc.setData(lineData(cfg.rocKey ?? 'roc_12'))
      guide(roc, 0, C.base1)
      break
    }
    case 'cci': {
      const cci = chart.addSeries(LineSeries, lineOpts(C.violet), paneIndex)
      cci.setData(lineData('cci_20'))
      for (const [price, color] of [[100, C.red], [0, C.base1], [-100, C.green]] as const) {
        guide(cci, price, color, price === 0 ? '' : String(price))
      }
      break
    }
  }
}

function applyRange(chart: IChartApi, rows: Bar[], cfg: TfConfig, key: RangeKey) {
  const ts = chart.timeScale()
  const bars = cfg.rangeBars[key]
  if (!bars || rows.length < 2) {
    ts.fitContent()
    return
  }
  const fromIdx = Math.max(0, rows.length - bars)
  ts.setVisibleRange({
    from: rows[fromIdx][cfg.timeKey] as Time,
    to: rows[rows.length - 1][cfg.timeKey] as Time,
  })
}

export function TaCharts({ ticker }: { ticker: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const stored = sessionStorage.getItem('chartsTimeframe')
    return stored === 'daily' || stored === 'monthly' ? stored : 'weekly'
  })
  const [rows, setRows] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>(CONFIG[timeframe].defaultRange)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  const cfg = CONFIG[timeframe]

  const handleTimeframe = (tf: Timeframe) => {
    setTimeframe(tf)
    setRange(CONFIG[tf].defaultRange)
    sessionStorage.setItem('chartsTimeframe', tf)
  }

  // Fetch full history when the ticker or timeframe changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // Drop stale rows so the chart-build effect never runs the new timeframe's
    // config against the previous timeframe's data (mismatched keys → crash).
    setRows([])
    fetch(cfg.endpoint(ticker))
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch chart data')
        return res.json()
      })
      .then((data: { data: Bar[] }) => {
        if (cancelled) return
        setRows(data.data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker, timeframe, cfg])

  // Build the multi-pane chart whenever data changes.
  useEffect(() => {
    if (!containerRef.current || rows.length === 0) return
    // Guard the transient where timeframe flipped but rows still hold the other
    // timeframe's data (its keys differ): skip until the matching fetch lands.
    if (rows[0][cfg.timeKey] == null) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 1180,
      layout: {
        background: { color: C.base3 },
        textColor: C.base00,
        fontFamily: 'inherit',
        panes: { separatorColor: C.base1, separatorHoverColor: C.base2, enableResize: true },
      },
      grid: {
        vertLines: { color: 'rgba(147,161,161,0.18)' },
        horzLines: { color: 'rgba(147,161,161,0.18)' },
      },
      rightPriceScale: { borderColor: C.base1 },
      timeScale: { borderColor: C.base1, rightOffset: 4 },
      crosshair: { mode: 0 },
    })
    chartRef.current = chart

    const time = (r: Bar) => r[cfg.timeKey] as Time
    const lineData = (key: string) =>
      rows.filter((r) => num(r[key]) != null).map((r) => ({ time: time(r), value: r[key] as number }))

    // Pane 0: candles + moving averages
    const candle = chart.addSeries(
      CandlestickSeries,
      {
        // Hollow candle style: up candles have a transparent (hollow) body
        // with a colored border; down candles stay filled.
        upColor: 'rgba(0, 0, 0, 0)',
        downColor: C.red,
        borderUpColor: C.green,
        borderDownColor: C.red,
        wickUpColor: C.green,
        wickDownColor: C.red,
      },
      0,
    )
    candle.setData(
      rows.map((r) => ({
        time: time(r),
        open: r.open as number,
        high: r.high as number,
        low: r.low as number,
        close: r.close as number,
      })),
    )
    for (const m of cfg.mas) {
      const opts = m.dashed ? { ...lineOpts(m.color), lineStyle: LineStyle.Dashed } : lineOpts(m.color)
      chart.addSeries(LineSeries, opts, 0).setData(lineData(m.key))
    }

    // Indicator panes (1..N)
    cfg.panes.forEach((kind, i) => buildIndicatorPane(kind, chart, i + 1, rows, cfg))

    // Pane proportions: candles tallest, indicators compact.
    const panes = chart.panes()
    const stretch = [PRICE_STRETCH, ...cfg.panes.map((k) => PANE_STRETCH[k])]
    panes.forEach((p, i) => p.setStretchFactor(stretch[i] ?? 1))

    // Per-pane legends: a top-left watermark per pane, refreshed on hover.
    // Default to the most recent bar when the crosshair isn't over a bar.
    const lastRow = rows[rows.length - 1]
    const watermarks = legendLines(lastRow, ticker, cfg).map((lines, i) =>
      i < panes.length
        ? createTextWatermark(panes[i], { horzAlign: 'left', vertAlign: 'top', lines })
        : null,
    )

    const rowByTime = new Map(rows.map((r) => [String(r[cfg.timeKey]), r]))
    const updateLegend = (r: Bar) => {
      const all = legendLines(r, ticker, cfg)
      watermarks.forEach((w, i) => w?.applyOptions({ lines: all[i] }))
    }
    chart.subscribeCrosshairMove((param) => {
      const r = (param.time != null && rowByTime.get(String(param.time))) || lastRow
      updateLegend(r)
    })

    applyRange(chart, rows, cfg, range)

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
    // `range` intentionally excluded: range changes are applied by the effect below
    // without rebuilding the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ticker, timeframe])

  // Re-apply the visible window when the range buttons change.
  useEffect(() => {
    if (chartRef.current && rows.length) applyRange(chartRef.current, rows, cfg, range)
  }, [range, rows, cfg])

  const timeframes: [Timeframe, string][] = [
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
  ]
  const tfButton = (tf: Timeframe, label: string, i: number) => (
    <button
      key={tf}
      onClick={() => handleTimeframe(tf)}
      className={`px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
        i > 0 ? 'border-l border-sol-base1/30' : ''
      } ${
        timeframe === tf
          ? 'bg-sol-blue text-white'
          : 'bg-sol-base2 text-sol-base00 hover:bg-sol-base1/20'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <span className="text-sm text-sol-base1">Timeframe:</span>
          <div className="inline-flex rounded-lg overflow-hidden shadow-sm">
            {timeframes.map(([tf, label], i) => tfButton(tf, label, i))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-sol-base1">Range:</span>
          <div className="inline-flex rounded-lg overflow-hidden shadow-sm">
            {cfg.ranges.map((r, i) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                  i > 0 ? 'border-l border-sol-base1/30' : ''
                } ${
                  range === r
                    ? 'bg-sol-blue text-white'
                    : 'bg-sol-base2 text-sol-base00 hover:bg-sol-base1/20'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="flex items-center justify-center h-64 text-sol-base1">Loading {ticker}…</div>}
      {error && <div className="flex items-center justify-center h-64 text-sol-red">Error: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="flex items-center justify-center h-64 text-sol-base1">No {timeframe} data for {ticker}.</div>
      )}

      <div
        ref={containerRef}
        className={`w-full rounded-lg border border-sol-base1/30 overflow-hidden ${
          loading || error || rows.length === 0 ? 'hidden' : ''
        }`}
      />
    </div>
  )
}
