import { useState, useEffect } from 'react'
import { Chevron } from './Chevron'
import { StatusMessage } from './StatusMessage'

const TV_WEEKLY_CHART_ID = '3Y50znV2'  // TradingView saved layout "weekly" (my-charts)
// The backend serves the overview from a background-refreshed snapshot, so a
// poll costs it no network I/O — and polling keeps it in its fast refresh
// cadence, which is what makes the numbers track the tape while the tab is open.
const LIVE_REFRESH_MS = 5000
const BAR_MAX = 7
// Text colours for gains/losses: --color-sol-up/--color-sol-down in index.css,
// as hex so the alpha-suffixed tints below (`${UP}1f`) can be built from them.
const UP = '#46701a'
const DOWN = '#a8362b'
const INK = 'var(--color-sol-base02)'
const INK_2 = 'var(--color-sol-base01)'
const MUTED = 'var(--color-sol-base00)'

interface Ticker {
  symbol: string
  price: string
  change_pct: string
  change_abs: string
  volume: string
  avg_volume: string
  formal_symbol: string
  // "" when the quote is real-time; else how far behind the exchange serves it
  // to this TradingView account ("15m", "10m", "EOD"). An entitlement, not
  // something the backend can fetch its way around.
  delay?: string
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
  age_seconds?: number
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

function fmtPct(val: number | null): string {
  if (val === null) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

function delayNote(delay: string): string {
  return delay === 'EOD' ? 'End-of-day quote' : `Delayed ${delay}`
}

function volRatio(ticker: Ticker): number | null {
  if (!ticker.volume || !ticker.avg_volume) return null
  const vol = parseVolume(ticker.volume)
  const avg = parseVolume(ticker.avg_volume)
  if (avg === 0) return null
  return vol / avg
}

function MagnitudeBar({ chg }: { chg: number }) {
  const isUp = chg >= 0
  const pctRaw = Math.min(Math.abs(chg) / BAR_MAX, 1)
  const pct = Math.max(0.04, Math.pow(pctRaw, 0.55))
  const halfW = pct * 50
  const softColor = isUp ? 'rgba(90,138,53,0.18)' : 'rgba(181,58,44,0.18)'
  const barColor = isUp ? '#7CA84A' : '#C7503F'
  const fill = isUp
    ? `linear-gradient(90deg, ${softColor}, ${barColor})`
    : `linear-gradient(270deg, ${softColor}, ${barColor})`

  return (
    <div style={{ position: 'relative', width: '100%', height: 18, display: 'flex', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: '100%', height: 4, background: 'rgba(7,54,66,0.08)', borderRadius: 2 }}>
        {/* Center axis */}
        <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'rgba(7,54,66,0.22)' }} />
        {/* Bar */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: isUp ? '50%' : `${50 - halfW}%`,
          width: `${halfW}%`,
          borderRadius: 2,
          background: fill,
        }} />
      </div>
    </div>
  )
}

function TickerRow({ ticker }: { ticker: Ticker }) {
  const [showTip, setShowTip] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const hasTip = ticker.volume || ticker.avg_volume || ticker.change_abs || ticker.delay
  const ratio = volRatio(ticker)
  const highVol = ratio != null && ratio > 1

  const chgStr = ticker.change_pct
  const chgNum = parseFloat(chgStr?.replace(/[+%]/g, '') || '0')
  const isNeg = chgStr?.startsWith('-')
  const chgVal = isNeg ? -Math.abs(chgNum) : chgNum

  return (
    <div
      onMouseEnter={(e) => { setMousePos({ x: e.clientX, y: e.clientY }); setShowTip(true) }}
      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setShowTip(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr 56px 64px',
        alignItems: 'center',
        gap: 10,
        padding: `5px 0 5px ${highVol ? 8 : 0}px`,
        marginLeft: highVol ? -8 : 0,
        borderLeft: highVol ? `2px solid ${chgVal >= 0 ? UP : DOWN}` : 'none',
        background: highVol ? `linear-gradient(90deg, ${chgVal >= 0 ? UP : DOWN}1f, transparent 55%)` : undefined,
        fontVariantNumeric: 'tabular-nums',
        cursor: 'default',
        borderRadius: highVol ? '0 6px 6px 0' : 6,
        transition: 'background 0.15s',
      }}
      className={highVol ? undefined : 'hover:bg-sol-base2/60'}
    >
      {/* Symbol + vol chip */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
        <a
          href={`https://www.tradingview.com/chart/${TV_WEEKLY_CHART_ID}/?symbol=${encodeURIComponent(ticker.formal_symbol)}&interval=W`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 14.5, fontWeight: highVol ? 700 : 600,
            color: INK, letterSpacing: '0.02em',
            textDecoration: 'none',
          }}
          className="hover:!text-sol-blue"
        >
          {ticker.symbol}
        </a>
        {highVol && ratio != null && !ticker.delay && (() => {
          const chipColor = chgVal >= 0 ? UP : DOWN
          return (
          <span style={{
            fontSize: 11, fontWeight: 700, color: chipColor,
            background: `${chipColor}22`, padding: '1px 5px',
            borderRadius: 4, whiteSpace: 'nowrap', lineHeight: 1.2,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {ratio < 1.1 ? ratio.toFixed(2) : ratio.toFixed(1)}×
          </span>
          )
        })()}
        {ticker.delay && (
          <span style={{
            fontSize: 9, fontWeight: 600, color: MUTED,
            border: '1px solid rgba(7,54,66,0.18)',
            borderRadius: 3, padding: '0 3px', lineHeight: 1.35,
            whiteSpace: 'nowrap', letterSpacing: '0.02em',
          }}>
            {ticker.delay}
          </span>
        )}
      </div>

      {/* Magnitude bar */}
      <MagnitudeBar chg={chgVal} />

      {/* Change % */}
      <div style={{
        fontSize: 13.5, fontWeight: highVol ? 700 : 600,
        color: chgVal >= 0 ? UP : DOWN,
        textAlign: 'right', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {ticker.change_pct}
      </div>

      {/* Price */}
      <div style={{
        fontSize: 13, textAlign: 'right',
        color: highVol ? INK : INK_2,
        fontWeight: highVol ? 600 : 400,
      }}>
        {formatPrice(ticker.price)}
      </div>

      {/* Tooltip */}
      {hasTip && showTip && (
        <div style={{
          position: 'fixed',
          left: mousePos.x + 12, top: mousePos.y - 30,
          background: '#FDF6E3', color: INK,
          border: '1px solid var(--line-strong)',
          padding: '7px 11px', borderRadius: 8,
          fontSize: 12.5, whiteSpace: 'nowrap',
          zIndex: 1000, pointerEvents: 'none',
          boxShadow: '0 8px 24px -6px rgba(7,54,66,0.22)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {ticker.delay && (
            <>
              <span style={{ color: 'var(--color-sol-amber)', fontWeight: 600 }}>{delayNote(ticker.delay)}</span>
              {(ticker.volume || ticker.avg_volume || ticker.change_abs) && (
                <span style={{ color: MUTED, margin: '0 6px' }}>·</span>
              )}
            </>
          )}
          {ticker.volume && <>Vol <span style={{
            color: highVol ? (chgVal >= 0 ? UP : DOWN) : 'inherit',
            fontWeight: highVol ? 700 : 400,
          }}>{ticker.volume}</span></>}
          {ticker.volume && ticker.avg_volume && <span style={{ color: MUTED, margin: '0 6px' }}>·</span>}
          {ticker.avg_volume && <>Avg {ticker.avg_volume}</>}
          {ratio != null && (
            <span style={{
              marginLeft: 8,
              color: highVol ? (chgVal >= 0 ? UP : DOWN) : MUTED,
              fontWeight: highVol ? 700 : 500,
            }}>
              → {ratio.toFixed(2)}×
            </span>
          )}
          {ticker.change_abs && (
            <>
              <span style={{ color: MUTED, margin: '0 6px' }}>·</span>
              <span style={{ color: ticker.change_abs.startsWith('-') ? DOWN : UP }}>
                {!ticker.change_abs.startsWith('-') && !ticker.change_abs.startsWith('+') ? '+' : ''}{ticker.change_abs}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group }: { group: Group }) {
  const [expanded, setExpanded] = useState(true)
  const groupUp = group.avg_change !== null && group.avg_change >= 0

  return (
    <div className="mp-card" style={{ padding: '14px 16px 8px' }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '0 0 10px', marginBottom: 4,
          borderBottom: '1px solid var(--line)',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ alignSelf: 'center', display: 'inline-flex' }}><Chevron open={expanded} /></span>
          <div style={{
            fontSize: 12.5, letterSpacing: '0.12em',
            textTransform: 'uppercase' as const,
            fontWeight: 700, color: INK_2,
          }}>{group.name}</div>
        </div>
        {group.avg_change !== null && (
          <div style={{ textAlign: 'right' }}>
            <div className="relative group/avg" style={{ display: 'inline-block' }}>
              <span style={{
                fontSize: 14.5, fontWeight: 700,
                color: groupUp ? UP : DOWN,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtPct(group.avg_change)}
              </span>
              {group.avg_note && (
                <>
                  <sup style={{ fontSize: '0.68rem', color: MUTED, marginLeft: 2 }}>*</sup>
                  <span className="hidden group-hover/avg:block absolute -top-7 right-0 bg-sol-base3 text-sol-base01 border border-sol-base1/30 px-2 py-1 rounded-md text-[0.8rem] whitespace-nowrap z-10 shadow-md font-normal normal-case tracking-normal">
                    {group.avg_note}
                  </span>
                </>
              )}
            </div>
            {group.avg_vol_ratio != null && (
              <div className="relative group/volratio">
                <span style={{
                  fontSize: 11,
                  color: group.avg_vol_ratio > 1 ? (groupUp ? UP : DOWN) : MUTED,
                  fontWeight: group.avg_vol_ratio > 1 ? 700 : 500,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                }}>
                  {group.avg_vol_ratio.toFixed(2)}× vol
                </span>
                {group.avg_note && (
                  <>
                    <sup style={{ fontSize: '0.58rem', color: MUTED, marginLeft: 2 }}>*</sup>
                    <span className="hidden group-hover/volratio:block absolute -top-7 right-0 bg-sol-base3 text-sol-base01 border border-sol-base1/30 px-2 py-1 rounded-md text-[0.8rem] whitespace-nowrap z-10 shadow-md font-normal">
                      {group.avg_note}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {expanded && group.tickers.map((t) => (
        <TickerRow key={t.symbol} ticker={t} />
      ))}
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
      ? '/api/market/overview?force=1'
      : '/api/market/overview'
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((res) => {
        setData(res)
        setError(null)
      })
      // A failed poll must not blank a dashboard that is already rendering:
      // the error only surfaces while there is nothing to show.
      .catch((err) => setError(err.message))
  }

  // Poll while the tab is actually being looked at: a hidden tab neither needs
  // fresh numbers nor should keep the backend refreshing on its behalf.
  useEffect(() => {
    fetchData().finally(() => setLoading(false))
    const poll = () => {
      if (document.visibilityState === 'visible') fetchData()
    }
    const id = setInterval(poll, LIVE_REFRESH_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchData(true).finally(() => setRefreshing(false))
  }

  if (loading) {
    return <StatusMessage kind="loading">Loading market overview…</StatusMessage>
  }
  if (error && !data) {
    return <StatusMessage kind="error">Error: {error}</StatusMessage>
  }
  if (!data) return null

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 22,
      }}>
        <span style={{ fontSize: 13, color: INK_2, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{
            width: 7, height: 7, borderRadius: 9999,
            background: error ? DOWN : '#859900',
            boxShadow: `0 0 0 3px ${error ? DOWN : '#859900'}26`,
          }} />
          {error ? 'Reconnecting · last update' : 'Live · updated'} {data.updated_at}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--line-strong)] text-[0.8rem] font-bold text-sol-base01 hover:text-sol-base02 hover:bg-sol-base2/60 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: refreshing ? 'mp-spin 0.9s linear infinite' : 'none' }}
          >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Sections */}
      {data.sections.map((section, idx) => (
        <div key={section.name} style={{ marginTop: idx === 0 ? 0 : 34 }}>
          <div style={{
            fontSize: 13, letterSpacing: '0.16em',
            textTransform: 'uppercase' as const,
            color: INK, fontWeight: 700,
            marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {section.name}
            <div style={{ flex: 1, height: 1, background: 'var(--line-strong)' }} />
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            alignItems: 'start',
          }}>
            {section.groups.map((group) => (
              <GroupCard key={group.name} group={group} />
            ))}
          </div>
        </div>
      ))}

    </div>
  )
}
