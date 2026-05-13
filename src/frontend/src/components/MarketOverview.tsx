import { useState, useEffect } from 'react'

const TV_CHART_ID = '5JanKmS6'

interface Ticker {
  symbol: string
  price: string
  change_pct: string
  change_abs: string
  volume: string
  avg_volume: string
  formal_symbol: string
}

interface Group {
  name: string
  avg_change: number | null
  avg_note?: string
  avg_vol_ratio?: number
  tickers: Ticker[]
}

interface Section {
  name: string
  groups: Group[]
}

interface OverviewResponse {
  sections: Section[]
  updated_at: string
}

function parseVolume(v: string): number {
  if (!v) return 0
  const s = v.trim()
  const num = parseFloat(s)
  if (isNaN(num)) return 0
  if (s.endsWith('T')) return num * 1e12
  if (s.endsWith('B')) return num * 1e9
  if (s.endsWith('M')) return num * 1e6
  if (s.endsWith('K')) return num * 1e3
  return num
}

function formatPrice(raw: string): string {
  if (!raw || raw === '—') return raw
  const suffix = raw.replace(/[\d,.\-\s]/g, '')
  const numStr = raw.replace(/[^0-9.\-]/g, '')
  const num = parseFloat(numStr)
  if (isNaN(num)) return raw
  const decimals = num >= 1000 ? 0 : 2
  const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
  return suffix ? `${formatted}${suffix}` : formatted
}

function ChangeDisplay({ value }: { value: string | number | null }) {
  if (value === null || value === '—') return <span className="text-sol-base1">—</span>
  const str = typeof value === 'number' ? `${value >= 0 ? '+' : ''}${value}%` : String(value)
  const isUp = !str.startsWith('-')
  return <span className={isUp ? 'text-sol-green' : 'text-sol-red'}>{str}</span>
}

function TickerRow({ ticker }: { ticker: Ticker }) {
  const [showTip, setShowTip] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const hasTip = ticker.volume || ticker.avg_volume || ticker.change_abs
  const highVol = ticker.volume && ticker.avg_volume && parseVolume(ticker.volume) > parseVolume(ticker.avg_volume)

  return (
    <div
      className="grid items-center py-0.5 px-1.5 rounded hover:bg-sol-blue/7 cursor-default"
      style={{ gridTemplateColumns: '78px 66px 82px' }}
      onMouseEnter={(e) => { setMousePos({ x: e.clientX, y: e.clientY }); setShowTip(true) }}
      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setShowTip(false)}
    >
      <a
        href={`https://www.tradingview.com/chart/${TV_CHART_ID}/?symbol=${encodeURIComponent(ticker.formal_symbol)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[1.035rem] font-semibold text-sol-base01 hover:text-sol-blue"
        onClick={(e) => e.stopPropagation()}
      >
        {ticker.symbol}
      </a>
      <span className={`text-right ${highVol ? 'font-extrabold' : 'font-semibold'}`}>
        <ChangeDisplay value={ticker.change_pct} />
      </span>
      <span className="text-right text-sol-base00">{formatPrice(ticker.price)}</span>
      {hasTip && showTip && (
        <div
          className="fixed bg-sol-base3 text-sol-base01 border border-sol-base1/30 px-2 py-1 rounded text-[0.9rem] whitespace-nowrap z-50 shadow-lg pointer-events-none"
          style={{ left: mousePos.x + 12, top: mousePos.y - 28 }}
        >
          {ticker.change_abs && <><span className={ticker.change_abs.startsWith('-') ? 'text-sol-red' : 'text-sol-green'}>{!ticker.change_abs.startsWith('-') && !ticker.change_abs.startsWith('+') ? '+' : ''}{ticker.change_abs}</span></>}
          {ticker.change_abs && ticker.volume && <>&nbsp;&nbsp;</>}
          {ticker.volume && (() => {
            const volHigh = ticker.avg_volume && parseVolume(ticker.volume) > parseVolume(ticker.avg_volume)
            return <>Vol: <span className={volHigh ? 'font-bold text-sol-blue' : ''}>{ticker.volume}</span></>
          })()}
          {ticker.volume && ticker.avg_volume && <>&nbsp;&nbsp;Avg: {ticker.avg_volume}</>}
          {!ticker.volume && ticker.avg_volume && <>Avg Vol: {ticker.avg_volume}</>}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group }: { group: Group }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="bg-sol-base2 border border-sol-base1/15 rounded-lg overflow-visible">
      <div
        className="flex items-center justify-between py-1.5 px-2.5 cursor-pointer select-none hover:bg-sol-base1/8 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="text-[0.7rem] text-sol-base1 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span className="text-[1rem] font-bold uppercase tracking-wide text-sol-base01">
            {group.name}
          </span>
        </div>
        {group.avg_change !== null && (
          <div className="text-right">
            <span className="text-[1rem] font-bold relative group/avg">
              <ChangeDisplay value={group.avg_change} />
              {group.avg_note && (
                <>
                  <sup className="text-[0.6rem] text-sol-base1 ml-0.5">*</sup>
                  <span className="hidden group-hover/avg:block absolute -top-7 right-0 bg-sol-base3 text-sol-base01 border border-sol-base1/30 px-2 py-1 rounded text-[0.8rem] whitespace-nowrap z-10 shadow-lg font-normal normal-case tracking-normal">
                    {group.avg_note}
                  </span>
                </>
              )}
            </span>
            {group.avg_vol_ratio != null && (
              <div className={`text-[0.75rem] relative group/volratio ${group.avg_vol_ratio > 1 ? 'font-bold text-sol-blue' : 'text-sol-base1'}`}>
                {group.avg_vol_ratio.toFixed(2)}x vol
                {group.avg_note && (
                  <>
                    <sup className="text-[0.5rem] text-sol-base1 ml-0.5">*</sup>
                    <span className="hidden group-hover/volratio:block absolute -top-7 right-0 bg-sol-base3 text-sol-base01 border border-sol-base1/30 px-2 py-1 rounded text-[0.8rem] whitespace-nowrap z-10 shadow-lg font-normal">
                      {group.avg_note}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div className="px-1 pb-1.5">
          {group.tickers.map((t) => (
            <TickerRow key={t.symbol} ticker={t} />
          ))}
        </div>
      )}
    </div>
  )
}

export function MarketOverview() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = (force = false) => {
    const url = force
      ? 'http://localhost:8000/api/market/overview?force=1'
      : 'http://localhost:8000/api/market/overview'
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchData(true).finally(() => setRefreshing(false))
  }

  if (loading) {
    return <div className="text-sol-base1 p-4">Loading market overview...</div>
  }
  if (error) {
    return <div className="text-sol-red p-4">Error: {error}</div>
  }
  if (!data) return null

  return (
    <div>
      <div className="text-sm text-sol-base1 mb-4 flex items-center gap-2">
        <span>Last updated: {data.updated_at}</span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-sol-base1 hover:text-sol-blue transition-colors disabled:opacity-50"
          title="Force refresh"
        >
          <svg
            className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
      </div>
      {data.sections.map((section, idx) => (
        <div key={section.name} className={idx > 0 ? 'mt-6' : 'mb-2'}>
          {idx > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-sol-base1/40 to-transparent" />
            </div>
          )}
          <div className="text-[1.1rem] font-bold text-sol-blue uppercase tracking-wide mb-2.5">
            {section.name}
          </div>
          <div className="grid gap-2.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {section.groups.map((group) => (
              <GroupCard key={group.name} group={group} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
