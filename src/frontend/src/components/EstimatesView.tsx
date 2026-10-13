import { Fragment, useEffect, useRef, useState } from 'react'
import { TickerSearch } from './TickerSearch'

interface Year {
  fiscal_year: number
  period_end: string
  reported: boolean
  eps: number | null
  eps_low: number | null
  eps_high: number | null
  eps_analysts: number | null
  eps_growth_pct: number | null
  revenue: number | null
  revenue_growth_pct: number | null
  pe: number | null
  as_of: string
}

interface CrossCheckRow {
  fiscal_year: number
  stockanalysis_eps: number
  seekingalpha_eps: number
  gap_pct: number
  flag: boolean
}

interface Rating {
  date: string
  action: string
  analyst: string
  rating_from: string | null
  rating_to: string | null
  target_from: number | null
  target_to: number | null
}

interface QuarterSummary {
  quarter: string
  actions: Record<string, number>
  target_raises: number
  target_cuts: number
}

interface BrokerState {
  analyst: string
  rating: string | null
  target: number | null
  previous_target: number | null
  date: string
}

interface Estimate {
  ticker: string
  company: string | null
  fetched_at: string
  price: number
  target_mean: number | null
  target_gap_pct: number | null
  recommendation: number | null
  years: Year[]
  cross_check: { threshold_pct: number; years: CrossCheckRow[] }
  ratings: Rating[]
  ratings_summary: { by_quarter: QuarterSummary[]; latest_by_analyst: BrokerState[] }
  in_portfolio: boolean
  // Set by withLive when the TradingView scanner returned a current price.
  live?: LivePrice
}

interface LivePrice {
  price: number
  delay: string
  formal_symbol: string
}

interface LivePrices {
  prices: Record<string, LivePrice>
  error: string | null
}

interface EstimatesResponse {
  tickers: Estimate[]
  unreadable: string[]
}

// Below this many analysts a "consensus" is a handful of models (matches
// THIN_COVERAGE_ANALYSTS in stock_picker's fetch_estimates.py).
const THIN_COVERAGE = 3
// The weekly job refreshes holdings every Sunday; older than this means it missed.
const STALE_DAYS = 8
const FORWARD_YEARS = 3
const LOG_PREVIEW_ROWS = 8
const SELECTED_KEY = 'estimatesSelected'

const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' }
const SOL = { reported: '#93a1a1', estimate: '#268bd2', axis: '#eee8d5' }

const signed = (v: number | null, digits = 0) => {
  if (v == null) return '—'
  const rounded = Number(v.toFixed(digits))
  return rounded === 0 ? '0%' : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}%`
}
const changeColor = (v: number | null) =>
  v == null || Math.round(v) === 0 ? 'text-sol-base00' : v > 0 ? 'text-sol-green' : 'text-sol-red'
const money = (v: number | null, digits = 2) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const billions = (v: number | null) => (v == null ? '—' : `$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`)
const isThin = (y: Year) => !y.reported && y.eps_analysts != null && y.eps_analysts < THIN_COVERAGE
const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
const dayMonth = (iso: string) => shortDate(iso).replace(/, \d{4}$/, '')
const monthYear = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000
const yearTitle = (y: Year) =>
  `Fiscal year ${y.fiscal_year}, ending ${monthYear(y.period_end)}` +
  (y.eps_analysts != null ? `; ${y.eps_analysts} analysts` : '')

// The cached price is finviz's at fetch time. Swap in the live one and
// recompute what derives from it, with the fetcher's rounding; consensus,
// targets and ratings stay as fetched.
function withLive(t: Estimate, live: LivePrice | undefined): Estimate {
  if (!live) return t
  const price = live.price
  return {
    ...t,
    price,
    live,
    target_gap_pct: t.target_mean == null ? null : Math.round((t.target_mean / price - 1) * 1000) / 10,
    years: t.years.map((y) => ({ ...y, pe: y.eps && y.eps > 0 ? Math.round((price / y.eps) * 10) / 10 : null })),
  }
}
const priceSource = (t: Estimate) =>
  t.live
    ? `Live from TradingView${t.live.delay ? `, ${t.live.delay} delayed` : ''}`
    : `finviz price when fetched, ${dateTime(t.fetched_at)}`

// Holdings stay in watchlist order; everything else is alphabetical.
function upsert(list: Estimate[], item: Estimate): Estimate[] {
  if (list.some((t) => t.ticker === item.ticker)) {
    return list.map((t) => (t.ticker === item.ticker ? item : t))
  }
  const holdings = list.filter((t) => t.in_portfolio)
  const others = list.filter((t) => !t.in_portfolio)
  return item.in_portfolio
    ? [...holdings, item, ...others]
    : [...holdings, ...[...others, item].sort((a, b) => a.ticker.localeCompare(b.ticker))]
}

// EPS per fiscal year as thin columns on a shared zero baseline: the two
// reported years in grey, estimates in blue, thinly covered estimates pale.
function EpsBars({ years }: { years: Year[] }) {
  const shown = years.filter((y) => y.eps != null).slice(0, 7)
  const W = 9, GAP = 2, H = 22
  const top = Math.max(0, ...shown.map((y) => y.eps as number))
  const bottom = Math.max(0, ...shown.map((y) => -(y.eps as number)))
  const span = top + bottom || 1
  const zero = (top / span) * H
  return (
    <svg width={7 * (W + GAP)} height={H + 1} role="img" aria-label="EPS by fiscal year" className="block">
      <line x1={0} x2={7 * (W + GAP)} y1={zero + 0.5} y2={zero + 0.5} stroke={SOL.axis} strokeWidth={1} />
      {shown.map((y, i) => {
        const eps = y.eps as number
        const h = Math.max(1, (Math.abs(eps) / span) * H)
        return (
          <rect
            key={y.fiscal_year}
            x={i * (W + GAP)}
            y={eps >= 0 ? zero - h : zero}
            width={W}
            height={h}
            rx={1.5}
            fill={y.reported ? SOL.reported : SOL.estimate}
            fillOpacity={isThin(y) ? 0.35 : 1}
          >
            <title>
              {`FY${y.fiscal_year} ${y.reported ? 'reported' : 'estimate'}: ${eps.toFixed(2)}` +
                (y.eps_analysts != null ? ` (${y.eps_analysts} analysts)` : '')}
            </title>
          </rect>
        )
      })}
    </svg>
  )
}

function YearCell({ year, value, className = '', first = false }: {
  year: Year | undefined
  value: string
  className?: string
  first?: boolean
}) {
  const edge = first ? 'border-l border-sol-base2' : ''
  if (!year) return <td className={`px-1.5 py-1.5 text-right text-sol-base1 ${edge}`}>—</td>
  return (
    <td
      className={`px-1.5 py-1.5 text-right font-semibold ${className} ${edge} ${isThin(year) ? 'opacity-50' : ''}`}
      style={NUM}
      title={yearTitle(year)}
    >
      {value}
    </td>
  )
}

// Alignment is part of each class string rather than appended at the call
// site: two text-align utilities on one element resolve by stylesheet order,
// not by the order they are written in.
const TH_BASE = 'px-1.5 py-1.5 font-semibold whitespace-nowrap'
const TH = `${TH_BASE} text-right`
const DETAIL_TH_BASE = 'px-2.5 py-1 font-semibold whitespace-nowrap border-b border-sol-base2'
const DETAIL_TH = `${DETAIL_TH_BASE} text-right`
const DETAIL_TH_L = `${DETAIL_TH_BASE} text-left`
const DETAIL_TD_BASE = 'px-2.5 py-1 whitespace-nowrap border-b border-sol-base2/70'
const DETAIL_TD = `${DETAIL_TD_BASE} text-right`
const DETAIL_TD_L = `${DETAIL_TD_BASE} text-left`

function ConsensusTable({ estimate }: { estimate: Estimate }) {
  const rows: [string, (y: Year) => React.ReactNode][] = [
    ['EPS', (y) => (y.eps == null ? '—' : y.eps.toFixed(2))],
    ['EPS growth', (y) => <span className={changeColor(y.eps_growth_pct)}>{signed(y.eps_growth_pct)}</span>],
    ['Low – high', (y) => (y.eps_low == null || y.eps_high == null ? '' : `${y.eps_low.toFixed(2)} – ${y.eps_high.toFixed(2)}`)],
    ['Analysts', (y) => y.eps_analysts ?? ''],
    ['Price ÷ EPS', (y) => (y.pe == null ? '—' : `${y.pe.toFixed(1)}×`)],
    ['Revenue', (y) => billions(y.revenue)],
    ['Revenue growth', (y) => <span className={changeColor(y.revenue_growth_pct)}>{signed(y.revenue_growth_pct)}</span>],
    ['Estimate dated', (y) => dayMonth(y.as_of)],
  ]
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[0.82rem]" style={NUM}>
        <thead>
          <tr>
            <th className={DETAIL_TH_L}>Fiscal year</th>
            {estimate.years.map((y) => (
              <th key={y.fiscal_year} className={`${DETAIL_TH} ${isThin(y) ? 'opacity-50' : ''}`}>
                <div>
                  FY{y.fiscal_year}{' '}
                  <span className="font-normal text-sol-base1">{y.reported ? 'reported' : 'est.'}</span>
                </div>
                <div className="font-normal text-[0.7rem] text-sol-base1">ends {monthYear(y.period_end)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, render]) => (
            <tr key={label}>
              <td className={`${DETAIL_TD_L} text-sol-base00`}>{label}</td>
              {estimate.years.map((y) => (
                <td key={y.fiscal_year} className={`${DETAIL_TD} ${isThin(y) ? 'opacity-50' : ''}`}>
                  {render(y)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RatingsDetail({ estimate }: { estimate: Estimate }) {
  const [showAll, setShowAll] = useState(false)
  const { by_quarter, latest_by_analyst } = estimate.ratings_summary
  if (estimate.ratings.length === 0) {
    return <p className="text-sol-base1 text-[0.85rem]">finviz lists no rating or target changes.</p>
  }
  const count = (q: QuarterSummary, ...actions: string[]) =>
    actions.reduce((n, a) => n + (q.actions[a] ?? 0), 0) || ''
  const log = showAll ? estimate.ratings : estimate.ratings.slice(0, LOG_PREVIEW_ROWS)
  const arrow = (from: string | null, to: string | null) => (from && to ? `${from} → ${to}` : to ?? '')
  const target = (v: number | null) => (v == null ? null : money(v, 0))
  const heading = 'font-semibold text-[0.85rem] mb-1'

  return (
    <div className="flex flex-wrap gap-x-10 gap-y-5 items-start">
      <div>
        <div className={heading}>Changes per quarter</div>
        <table className="border-collapse text-[0.82rem]" style={NUM}>
          <thead>
            <tr>
              {['Quarter', 'Upgrades', 'Downgrades', 'Initiated', 'Reiterated', 'Targets raised', 'Targets cut'].map((h, i) => (
                <th key={h} className={i === 0 ? DETAIL_TH_L : DETAIL_TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {by_quarter.map((q) => (
              <tr key={q.quarter}>
                <td className={DETAIL_TD_L}>{q.quarter.replace('Q', ' Q')}</td>
                <td className={`${DETAIL_TD} text-sol-green`}>{count(q, 'Upgrade')}</td>
                <td className={`${DETAIL_TD} text-sol-red`}>{count(q, 'Downgrade')}</td>
                <td className={DETAIL_TD}>{count(q, 'Initiated', 'Resumed')}</td>
                <td className={DETAIL_TD}>{count(q, 'Reiterated')}</td>
                <td className={`${DETAIL_TD} text-sol-green`}>{q.target_raises || ''}</td>
                <td className={`${DETAIL_TD} text-sol-red`}>{q.target_cuts || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className={heading}>Where each broker stands</div>
        <table className="border-collapse text-[0.82rem]" style={NUM}>
          <thead>
            <tr>
              {['Last change', 'Broker', 'Rating', 'Target', 'Previous'].map((h, i) => (
                <th key={h} className={i < 3 ? DETAIL_TH_L : DETAIL_TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {latest_by_analyst.map((b) => (
              <tr key={b.analyst}>
                <td className={`${DETAIL_TD_L} text-sol-base00`}>{shortDate(b.date)}</td>
                <td className={DETAIL_TD_L}>{b.analyst}</td>
                <td className={DETAIL_TD_L}>{b.rating ?? ''}</td>
                <td className={DETAIL_TD}>{target(b.target) ?? ''}</td>
                <td className={`${DETAIL_TD} text-sol-base1`}>{target(b.previous_target) ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className={heading}>
          Change log <span className="font-normal text-sol-base1">({estimate.ratings.length} rows)</span>
        </div>
        <table className="border-collapse text-[0.82rem]" style={NUM}>
          <thead>
            <tr>
              {['Date', 'Action', 'Broker', 'Rating', 'Target'].map((h) => (
                <th key={h} className={DETAIL_TH_L}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={i}>
                <td className={`${DETAIL_TD_L} text-sol-base00`}>{shortDate(r.date)}</td>
                <td
                  className={`${DETAIL_TD_L} ${
                    r.action === 'Upgrade' ? 'text-sol-green' : r.action === 'Downgrade' ? 'text-sol-red' : ''
                  }`}
                >
                  {r.action}
                </td>
                <td className={DETAIL_TD_L}>{r.analyst}</td>
                <td className={DETAIL_TD_L}>{arrow(r.rating_from, r.rating_to)}</td>
                <td className={DETAIL_TD_L}>{arrow(target(r.target_from), target(r.target_to))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {estimate.ratings.length > LOG_PREVIEW_ROWS && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-1.5 text-[0.82rem] text-sol-blue hover:underline cursor-pointer"
          >
            {showAll ? 'Show fewer' : `Show all ${estimate.ratings.length}`}
          </button>
        )}
      </div>
    </div>
  )
}

function Detail({ estimate, busy, onRefresh }: { estimate: Estimate; busy: boolean; onRefresh: () => void }) {
  const check = estimate.cross_check
  const flagged = check.years.filter((r) => r.flag)
  return (
    <div className="bg-sol-base3 rounded-xl border border-sol-base2 shadow-sm px-4 py-4 space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[1.15rem] font-bold">{estimate.ticker}</span>
        <span className="text-sol-base00">{estimate.company}</span>
        <span className="text-[0.88rem]" style={NUM}>
          <span title={priceSource(estimate)}>{money(estimate.price)}</span>{' '}
          <span className="text-sol-base1">{estimate.live ? (estimate.live.delay ? `${estimate.live.delay} delayed` : 'live') : 'at fetch'}</span>
          {' '}· mean target {money(estimate.target_mean, 0)}{' '}
          <span className={changeColor(estimate.target_gap_pct)}>({signed(estimate.target_gap_pct)})</span> · mean
          rating {estimate.recommendation?.toFixed(2) ?? '—'}
        </span>
        <span className="ml-auto text-[0.82rem] text-sol-base1">fetched {dateTime(estimate.fetched_at)}</span>
        <button
          onClick={onRefresh}
          disabled={busy}
          title="Fetch again from the sources. A cache under an hour old is returned as is."
          className="text-[0.82rem] text-sol-blue hover:underline cursor-pointer disabled:text-sol-base1 disabled:cursor-default disabled:no-underline"
        >
          {busy ? 'Fetching…' : 'Refresh'}
        </button>
      </div>
      <section>
        <div className="font-semibold mb-1.5">
          Consensus by fiscal year{' '}
          <span className="font-normal text-[0.82rem] text-sol-base1">
            Seeking Alpha; EPS is normalized (non-GAAP)
          </span>
        </div>
        <ConsensusTable estimate={estimate} />
        <p className={`mt-2 text-[0.82rem] ${flagged.length ? 'text-sol-yellow' : 'text-sol-base00'}`}>
          {check.years.length === 0
            ? 'stockanalysis.com publishes no forecast year that overlaps these.'
            : flagged.length === 0
              ? `stockanalysis.com agrees within ${check.threshold_pct}% for ${check.years.map((r) => `FY${r.fiscal_year}`).join(' and ')}.`
              : 'stockanalysis.com differs: ' +
                flagged
                  .map((r) => `FY${r.fiscal_year} ${r.stockanalysis_eps.toFixed(2)} there against ${r.seekingalpha_eps.toFixed(2)} here (${signed(r.gap_pct, 1)})`)
                  .join('; ') +
                '. One source has not caught up with recent revisions.'}
        </p>
      </section>
      <section>
        <div className="font-semibold mb-1.5">
          Rating and price-target changes <span className="font-normal text-[0.82rem] text-sol-base1">finviz</span>
        </div>
        {/* Keyed so "Show all" resets when another ticker is selected. */}
        <RatingsDetail key={estimate.ticker} estimate={estimate} />
      </section>
    </div>
  )
}

export function EstimatesView() {
  const [data, setData] = useState<EstimatesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(SELECTED_KEY))
  const [busy, setBusy] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [live, setLive] = useState<LivePrices | null>(null)
  const [liveAt, setLiveAt] = useState<Date | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  // Current prices for every cached ticker, one scanner request on the
  // backend; on failure the cached prices stay on screen.
  const loadLive = () =>
    fetch('/api/market/estimates/prices')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((body: LivePrices) => {
        setLive(body)
        setLiveAt(new Date())
      })
      .catch((err) => setLive({ prices: {}, error: err.message }))

  useEffect(() => {
    loadLive()
    fetch('/api/market/estimates')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  const select = (ticker: string) => {
    setSelected(ticker)
    sessionStorage.setItem(SELECTED_KEY, ticker)
  }
  // After the detail panel has rendered for the newly selected ticker.
  const revealDetail = () =>
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)

  // Ask the backend for one ticker: it fetches from the sources and caches,
  // or returns the cache when that is under an hour old.
  const request = (ticker: string, reveal: boolean) => {
    setBusy(ticker)
    setFetchError(null)
    fetch(`/api/market/estimates/${encodeURIComponent(ticker)}`, { method: 'POST' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`)
        return body as Estimate
      })
      .then((estimate) => {
        setData((prev) => prev && { ...prev, tickers: upsert(prev.tickers, estimate) })
        select(estimate.ticker)
        if (reveal) revealDetail()
        loadLive()
      })
      .catch((err) => setFetchError(`${ticker}: ${err.message}`))
      .finally(() => setBusy(null))
  }

  // A cached ticker just opens; anything else is fetched first.
  const handleSearch = (symbol: string) => {
    if (data?.tickers.some((t) => t.ticker === symbol)) {
      setFetchError(null)
      select(symbol)
      revealDetail()
    } else {
      request(symbol, true)
    }
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-sol-red">Error: {error}</div>
  }
  if (!data) {
    return <div className="flex items-center justify-center h-64 text-sol-base1">Loading...</div>
  }

  const tickers = data.tickers.map((t) => withLive(t, live?.prices[t.ticker]))
  const current = tickers.find((t) => t.ticker === selected) ?? tickers[0]
  const firstOther = tickers.findIndex((t) => !t.in_portfolio)
  const priceNote = !live
    ? 'Updating prices from TradingView…'
    : live.error
      ? `Live prices unavailable (${live.error}); showing the prices from each fetch.`
      : `Price, target gap and price ÷ EPS use TradingView prices from ${liveAt?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}; the consensus and targets are as of each fetch.`
  const COLUMNS = 7 + 2 * FORWARD_YEARS

  return (
    <div className="max-w-[88rem] text-sol-base01 space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-full max-w-md">
          <TickerSearch onSelect={handleSearch} />
        </div>
        <span className={`text-[0.85rem] ${fetchError ? 'text-sol-red' : 'text-sol-base00'}`}>
          {busy
            ? `Fetching ${busy} from Seeking Alpha, stockanalysis.com and finviz…`
            : fetchError ?? 'Search any US stock: a ticker not listed below is fetched and added.'}
        </span>
      </div>

      {tickers.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sol-base1">
          No estimates cached yet. Search for a ticker above to fetch its estimates.
        </div>
      ) : (
        <>
          <div>
            <div className="overflow-x-auto bg-sol-base3 rounded-xl border border-sol-base2 shadow-sm">
              <table className="border-collapse w-full text-[0.88rem]">
                <thead className="text-[0.76rem] text-sol-base00">
                  <tr className="border-b border-sol-base2">
                    <th className={`${TH_BASE} text-left pl-4`} rowSpan={2}>Ticker</th>
                    <th className={TH} rowSpan={2}>Price</th>
                    <th className={TH} rowSpan={2} title="Mean analyst price target against the current price">
                      Target<br />vs price
                    </th>
                    <th className={TH} rowSpan={2} title="Mean analyst rating: 1 = strong buy, 5 = sell">Rating</th>
                    <th className={`${TH_BASE} text-left`} rowSpan={2}>EPS<br />by year</th>
                    <th className={`${TH} border-l border-sol-base2`} rowSpan={2}>1st year<br />ends</th>
                    <th className={`${TH_BASE} text-center border-l border-sol-base2`} colSpan={FORWARD_YEARS}>
                      EPS growth, next {FORWARD_YEARS} years
                    </th>
                    <th className={`${TH_BASE} text-center border-l border-sol-base2`} colSpan={FORWARD_YEARS}>
                      Price ÷ EPS
                    </th>
                    <th className={`${TH} pr-4 border-l border-sol-base2`} rowSpan={2}>Fetched</th>
                  </tr>
                  <tr className="border-b border-sol-base2">
                    {['1st', '2nd', '3rd', '1st', '2nd', '3rd'].map((label, i) => (
                      <th key={i} className={`${TH} font-normal ${i % FORWARD_YEARS === 0 ? 'border-l border-sol-base2' : ''}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickers.map((t, index) => {
                    const forward = t.years.filter((y) => !y.reported).slice(0, FORWARD_YEARS)
                    const flagged = t.cross_check.years.some((r) => r.flag)
                    const stale = ageDays(t.fetched_at) > STALE_DAYS
                    const isSelected = current?.ticker === t.ticker
                    return (
                      <Fragment key={t.ticker}>
                        {index === firstOther && (
                          <tr>
                            <td colSpan={COLUMNS} className="px-4 pt-3 pb-1 text-[0.74rem] font-semibold text-sol-base1 uppercase tracking-wide border-b border-sol-base2">
                              Not in the portfolio
                            </td>
                          </tr>
                        )}
                        <tr
                          onClick={() => select(t.ticker)}
                          className={`cursor-pointer border-b border-sol-base2/70 hover:bg-sol-blue/10 ${isSelected ? 'bg-sol-blue/15' : ''}`}
                        >
                          <td
                            className={`pl-3 pr-2 py-1.5 font-bold whitespace-nowrap border-l-4 ${isSelected ? 'border-sol-blue' : 'border-transparent'}`}
                            title={t.company ?? undefined}
                          >
                            {t.ticker}
                          </td>
                          <td
                            className={`px-1.5 py-1.5 text-right ${t.live ? '' : 'text-sol-base1'}`}
                            style={NUM}
                            title={priceSource(t)}
                          >
                            {money(t.price)}
                          </td>
                          <td
                            className={`px-1.5 py-1.5 text-right font-semibold ${changeColor(t.target_gap_pct)}`}
                            style={NUM}
                            title={`Mean analyst price target ${money(t.target_mean, 0)}`}
                          >
                            {signed(t.target_gap_pct)}
                          </td>
                          <td className="px-1.5 py-1.5 text-right" style={NUM} title="1 = strong buy, 5 = sell">
                            {t.recommendation?.toFixed(2) ?? '—'}
                          </td>
                          <td className="px-1.5 py-1"><EpsBars years={t.years} /></td>
                          <td className="px-1.5 py-1.5 text-right text-sol-base00 whitespace-nowrap border-l border-sol-base2">
                            {forward[0] ? monthYear(forward[0].period_end) : '—'}
                          </td>
                          {Array.from({ length: FORWARD_YEARS }, (_, i) => (
                            <YearCell
                              key={`g${i}`}
                              first={i === 0}
                              year={forward[i]}
                              value={signed(forward[i]?.eps_growth_pct ?? null)}
                              className={changeColor(forward[i]?.eps_growth_pct ?? null)}
                            />
                          ))}
                          {Array.from({ length: FORWARD_YEARS }, (_, i) => {
                            const pe = forward[i]?.pe
                            return (
                              <YearCell key={`p${i}`} first={i === 0} year={forward[i]} value={pe == null ? '—' : `${pe.toFixed(1)}×`} />
                            )
                          })}
                          <td className="pl-2 pr-3 py-1.5 text-right whitespace-nowrap text-[0.8rem] border-l border-sol-base2">
                            {flagged && (
                              <span
                                className="mr-1.5 text-sol-yellow"
                                title="stockanalysis.com shows a different EPS consensus; select the row for the figures"
                              >
                                ●
                              </span>
                            )}
                            <span
                              className={stale ? 'text-sol-yellow font-semibold' : 'text-sol-base00'}
                              title={stale ? `More than ${STALE_DAYS} days old` : undefined}
                            >
                              {dayMonth(t.fetched_at)}
                            </span>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {current && (
            <div ref={detailRef} className="scroll-mt-4">
              <Detail
                estimate={current}
                busy={busy === current.ticker}
                onRefresh={() => request(current.ticker, false)}
              />
            </div>
          )}
        </>
      )}

      <p className={`text-[0.8rem] max-w-[110ch] ${live?.error ? 'text-sol-yellow' : 'text-sol-base00'}`}>
        {priceNote}
      </p>
      <p className="text-[0.8rem] text-sol-base00 max-w-[110ch]">
        Select a row for its detail. The 1st, 2nd and 3rd columns are consecutive fiscal years starting with the one
        that ends in the month shown, which differs by company. EPS bars: grey is reported, blue is the analyst
        consensus; pale bars and dimmed figures rest on fewer than {THIN_COVERAGE} analysts. Rating runs from 1
        (strong buy) to 5 (sell). A yellow dot marks a ticker where stockanalysis.com shows a different EPS
        consensus.
      </p>
      <p className="text-[0.8rem] text-sol-base1 max-w-[110ch]">
        Sources: Seeking Alpha consensus (normalized EPS, revenue), finviz (mean target, ratings, and the price
        when TradingView has none), TradingView (live price), stockanalysis.com as a cross-check. Holdings refresh every Sunday; other tickers are as old as their
        fetch date.
        {data.unreadable.length > 0 && ` Unreadable cache files: ${data.unreadable.join(', ')}.`}
      </p>
    </div>
  )
}
