import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  createTextWatermark,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type Time,
} from 'lightweight-charts'

interface WeeklyRow {
  week_start: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  vol_avg_4: number | null
  sma_5: number | null
  sma_10: number | null
  sma_40: number | null
  macd: number | null
  macd_signal: number | null
  macd_hist: number | null
  rsi_14: number | null
  obv: number | null
  roc_12: number | null
  kdj_k: number | null
  kdj_d: number | null
  kdj_j: number | null
}

type RangeKey = '1Y' | '2Y' | '5Y' | 'Max'
const RANGES: RangeKey[] = ['1Y', '2Y', '5Y', 'Max']
const RANGE_WEEKS: Record<Exclude<RangeKey, 'Max'>, number> = { '1Y': 52, '2Y': 104, '5Y': 260 }

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
}

const lineOpts = (color: string) => ({
  color,
  lineWidth: 2 as const,
  priceLineVisible: false,
  lastValueVisible: false,
})

// Per-pane legend rendered as a top-left text watermark; updated live on hover.
const TITLE_COLOR = 'rgba(88,110,117,0.55)'
const seg = (text: string, color: string) => ({
  text,
  color,
  fontSize: 12,
  fontFamily: 'inherit',
  fontStyle: '',
})

const f2 = (v: number | null) => (v == null ? '–' : v.toFixed(2))
const fVol = (v: number | null) => {
  if (v == null) return '–'
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(Math.round(v))
}

// Build the watermark lines for each pane from a single week's row.
const legendLines = (r: WeeklyRow, ticker: string) => [
  [
    seg(`${ticker} · Weekly  ·  ${r.week_start}`, TITLE_COLOR),
    seg(`O ${f2(r.open)}  H ${f2(r.high)}  L ${f2(r.low)}  C ${f2(r.close)}`, C.base01),
    seg(`SMA5 ${f2(r.sma_5)}`, C.blue),
    seg(`SMA10 ${f2(r.sma_10)}`, C.cyan),
    seg(`SMA40 ${f2(r.sma_40)}`, C.yellow),
  ],
  [
    seg('Volume + 4wk avg', TITLE_COLOR),
    seg(`Vol ${fVol(r.volume)}`, C.base01),
    seg(`4wk ${fVol(r.vol_avg_4)}`, C.violet),
  ],
  [
    seg('MACD (12,26,9)', TITLE_COLOR),
    seg(`MACD ${f2(r.macd)}`, C.blue),
    seg(`Signal ${f2(r.macd_signal)}`, C.orange),
    seg(`Hist ${f2(r.macd_hist)}`, C.base01),
  ],
  [seg('RSI 14', TITLE_COLOR), seg(`RSI ${f2(r.rsi_14)}`, C.violet)],
  [seg('OBV', TITLE_COLOR), seg(`OBV ${fVol(r.obv)}`, C.cyan)],
  [seg('ROC 12', TITLE_COLOR), seg(`ROC ${f2(r.roc_12)}`, C.yellow)],
  [
    seg('KDJ (9,3,3)', TITLE_COLOR),
    seg(`K ${f2(r.kdj_k)}`, C.blue),
    seg(`D ${f2(r.kdj_d)}`, C.orange),
    seg(`J ${f2(r.kdj_j)}`, C.magenta),
  ],
]

function applyRange(chart: IChartApi, rows: WeeklyRow[], key: RangeKey) {
  const ts = chart.timeScale()
  if (key === 'Max' || rows.length < 2) {
    ts.fitContent()
    return
  }
  const fromIdx = Math.max(0, rows.length - RANGE_WEEKS[key])
  ts.setVisibleRange({
    from: rows[fromIdx].week_start as Time,
    to: rows[rows.length - 1].week_start as Time,
  })
}

export function WeeklyCharts({ ticker }: { ticker: string }) {
  const [rows, setRows] = useState<WeeklyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('1Y')
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  // Fetch full history when the ticker changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/tickers/${ticker.toLowerCase()}/weekly-chart`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch chart data')
        return res.json()
      })
      .then((data: { data: WeeklyRow[] }) => {
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
  }, [ticker])

  // Build the multi-pane chart whenever data changes.
  useEffect(() => {
    if (!containerRef.current || rows.length === 0) return

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

    const time = (r: WeeklyRow) => r.week_start as Time
    const lineData = (key: keyof WeeklyRow) =>
      rows
        .filter((r) => r[key] != null)
        .map((r) => ({ time: time(r), value: r[key] as number }))

    // Pane 0: candles + SMAs
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
      rows.map((r) => ({ time: time(r), open: r.open, high: r.high, low: r.low, close: r.close })),
    )
    chart.addSeries(LineSeries, lineOpts(C.blue), 0).setData(lineData('sma_5'))
    chart.addSeries(LineSeries, lineOpts(C.cyan), 0).setData(lineData('sma_10'))
    chart.addSeries(LineSeries, lineOpts(C.yellow), 0).setData(lineData('sma_40'))

    // Pane 1: volume + 4-week average
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' } }, 1)
    vol.setData(
      rows.map((r) => ({
        time: time(r),
        value: r.volume,
        color: r.close >= r.open ? 'rgba(133,153,0,0.5)' : 'rgba(220,50,47,0.5)',
      })),
    )
    chart.addSeries(LineSeries, { ...lineOpts(C.violet), lineWidth: 1 }, 1).setData(lineData('vol_avg_4'))

    // Pane 2: MACD
    const macdHist = chart.addSeries(HistogramSeries, {}, 2)
    macdHist.setData(
      rows
        .filter((r) => r.macd_hist != null)
        .map((r) => ({
          time: time(r),
          value: r.macd_hist as number,
          color: (r.macd_hist as number) >= 0 ? 'rgba(133,153,0,0.6)' : 'rgba(220,50,47,0.6)',
        })),
    )
    chart.addSeries(LineSeries, lineOpts(C.blue), 2).setData(lineData('macd'))
    chart.addSeries(LineSeries, lineOpts(C.orange), 2).setData(lineData('macd_signal'))

    // Pane 3: RSI with 30/50/70 guides
    const rsi = chart.addSeries(LineSeries, lineOpts(C.violet), 3)
    rsi.setData(lineData('rsi_14'))
    for (const [price, color] of [[70, C.red], [50, C.base1], [30, C.green]] as const) {
      rsi.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: String(price),
      })
    }

    // Pane 4: OBV
    chart.addSeries(LineSeries, lineOpts(C.cyan), 4).setData(lineData('obv'))

    // Pane 5: ROC with zero line
    const roc = chart.addSeries(LineSeries, lineOpts(C.yellow), 5)
    roc.setData(lineData('roc_12'))
    roc.createPriceLine({ price: 0, color: C.base1, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })

    // Pane 6: KDJ
    chart.addSeries(LineSeries, lineOpts(C.blue), 6).setData(lineData('kdj_k'))
    chart.addSeries(LineSeries, lineOpts(C.orange), 6).setData(lineData('kdj_d'))
    chart.addSeries(LineSeries, lineOpts(C.magenta), 6).setData(lineData('kdj_j'))

    // Pane proportions: candles tallest, indicators compact.
    const panes = chart.panes()
    const stretch = [3.2, 1, 1.2, 1, 1, 1, 1.2]
    panes.forEach((p, i) => p.setStretchFactor(stretch[i] ?? 1))

    // Per-pane legends: a top-left watermark per pane, refreshed on hover.
    // Default to the most recent week when the crosshair isn't over a bar.
    const lastRow = rows[rows.length - 1]
    const watermarks = legendLines(lastRow, ticker).map((lines, i) =>
      i < panes.length
        ? createTextWatermark(panes[i], { horzAlign: 'left', vertAlign: 'top', lines })
        : null,
    )

    const rowByTime = new Map(rows.map((r) => [r.week_start, r]))
    const updateLegend = (r: WeeklyRow) => {
      const all = legendLines(r, ticker)
      watermarks.forEach((w, i) => w?.applyOptions({ lines: all[i] }))
    }
    chart.subscribeCrosshairMove((param) => {
      const r = (param.time != null && rowByTime.get(String(param.time))) || lastRow
      updateLegend(r)
    })

    applyRange(chart, rows, range)

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
  }, [rows, ticker])

  // Re-apply the visible window when the range buttons change.
  useEffect(() => {
    if (chartRef.current && rows.length) applyRange(chartRef.current, rows, range)
  }, [range, rows])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-sol-base1">Range:</span>
        <div className="inline-flex rounded-lg overflow-hidden shadow-sm">
          {RANGES.map((r, i) => (
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

      {loading && <div className="flex items-center justify-center h-64 text-sol-base1">Loading {ticker}…</div>}
      {error && <div className="flex items-center justify-center h-64 text-sol-red">Error: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="flex items-center justify-center h-64 text-sol-base1">No weekly data for {ticker}.</div>
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
