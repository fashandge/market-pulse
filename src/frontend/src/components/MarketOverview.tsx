import { useState, useEffect } from 'react'

const TV_CHART_ID = '5JanKmS6'
const BAR_MAX = 7

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

function fmtPct(val: number | null): string {
  if (val === null) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
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
      <div style={{ position: 'relative', width: '100%', height: 4, background: 'rgba(45,42,36,0.08)', borderRadius: 2 }}>
        {/* Center axis */}
        <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'rgba(45,42,36,0.22)' }} />
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
  const hasTip = ticker.volume || ticker.avg_volume || ticker.change_abs
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
        gridTemplateColumns: '70px 1fr 56px 64px',
        alignItems: 'center',
        gap: 10,
        padding: `5px 0 5px ${highVol ? 8 : 0}px`,
        marginLeft: highVol ? -8 : 0,
        borderLeft: highVol ? `2px solid ${chgVal >= 0 ? '#5A8A35' : '#B53A2C'}` : 'none',
        background: highVol ? `linear-gradient(90deg, ${chgVal >= 0 ? '#5A8A35' : '#B53A2C'}1f, transparent 55%)` : 'transparent',
        fontVariantNumeric: 'tabular-nums',
        cursor: 'default',
        transition: 'background 0.15s',
      }}
    >
      {/* Symbol + vol chip */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
        <a
          href={`https://www.tradingview.com/chart/${TV_CHART_ID}/?symbol=${encodeURIComponent(ticker.formal_symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12.5, fontWeight: highVol ? 700 : 600,
            color: '#2D2A24', letterSpacing: '0.02em',
            textDecoration: 'none',
          }}
          className="hover:!text-sol-blue"
        >
          {ticker.symbol}
        </a>
        {highVol && ratio != null && (() => {
          const chipColor = chgVal >= 0 ? '#5A8A35' : '#B53A2C'
          return (
          <span style={{
            fontSize: 9.5, fontWeight: 700, color: chipColor,
            background: `${chipColor}22`, padding: '1px 5px',
            borderRadius: 4, whiteSpace: 'nowrap', lineHeight: 1.2,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {ratio < 1.1 ? ratio.toFixed(2) : ratio.toFixed(1)}×
          </span>
          )
        })()}
      </div>

      {/* Magnitude bar */}
      <MagnitudeBar chg={chgVal} />

      {/* Change % */}
      <div style={{
        fontSize: 12, fontWeight: highVol ? 700 : 600,
        color: chgVal >= 0 ? '#5A8A35' : '#B53A2C',
        textAlign: 'right', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {ticker.change_pct}
      </div>

      {/* Price */}
      <div style={{
        fontSize: 11.5, textAlign: 'right',
        color: highVol ? '#2D2A24' : '#5B5547',
        fontWeight: highVol ? 600 : 400,
      }}>
        {formatPrice(ticker.price)}
      </div>

      {/* Tooltip */}
      {hasTip && showTip && (
        <div style={{
          position: 'fixed',
          left: mousePos.x + 12, top: mousePos.y - 30,
          background: '#FDF6E3', color: '#2D2A24',
          border: '1px solid rgba(45,42,36,0.25)',
          padding: '6px 10px', borderRadius: 6,
          fontSize: 11, whiteSpace: 'nowrap',
          zIndex: 1000, pointerEvents: 'none',
          boxShadow: '0 6px 20px rgba(45,42,36,0.18)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {ticker.volume && <>Vol <span style={{
            color: highVol ? (chgVal >= 0 ? '#5A8A35' : '#B53A2C') : 'inherit',
            fontWeight: highVol ? 700 : 400,
          }}>{ticker.volume}</span></>}
          {ticker.volume && ticker.avg_volume && <span style={{ color: '#8A8478', margin: '0 6px' }}>·</span>}
          {ticker.avg_volume && <>Avg {ticker.avg_volume}</>}
          {ratio != null && (
            <span style={{
              marginLeft: 8,
              color: highVol ? (chgVal >= 0 ? '#5A8A35' : '#B53A2C') : '#8A8478',
              fontWeight: highVol ? 700 : 500,
            }}>
              → {ratio.toFixed(2)}×
            </span>
          )}
          {ticker.change_abs && (
            <>
              <span style={{ color: '#8A8478', margin: '0 6px' }}>·</span>
              <span style={{ color: ticker.change_abs.startsWith('-') ? '#B53A2C' : '#5A8A35' }}>
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
    <div style={{
      background: '#EEE8D5',
      border: 'none',
      boxShadow: '0 1px 0 rgba(45,42,36,0.04), 0 4px 14px -8px rgba(45,42,36,0.10)',
      borderRadius: 14,
      padding: '14px 16px 8px',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '0 0 10px', marginBottom: 4,
          borderBottom: '1px solid rgba(45,42,36,0.07)',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontSize: 8, color: '#8A8478',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s',
            display: 'inline-block',
          }}>▶</span>
          <div style={{
            fontSize: 11.5, letterSpacing: '0.14em',
            textTransform: 'uppercase' as const,
            fontWeight: 700, color: '#2D2A24',
          }}>{group.name}</div>
        </div>
        {group.avg_change !== null && (
          <div style={{ textAlign: 'right' }}>
            <div className="relative group/avg" style={{ display: 'inline-block' }}>
              <span style={{
                fontSize: 12.5, fontWeight: 700,
                color: groupUp ? '#5A8A35' : '#B53A2C',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtPct(group.avg_change)}
              </span>
              {group.avg_note && (
                <>
                  <sup style={{ fontSize: '0.6rem', color: '#8A8478', marginLeft: 2 }}>*</sup>
                  <span className="hidden group-hover/avg:block absolute -top-7 right-0 bg-sol-base3 text-sol-base01 border border-sol-base1/30 px-2 py-1 rounded text-[0.8rem] whitespace-nowrap z-10 shadow-lg font-normal normal-case tracking-normal">
                    {group.avg_note}
                  </span>
                </>
              )}
            </div>
            {group.avg_vol_ratio != null && (
              <div className="relative group/volratio">
                <span style={{
                  fontSize: 9.5,
                  color: group.avg_vol_ratio > 1 ? (groupUp ? '#5A8A35' : '#B53A2C') : '#8A8478',
                  fontWeight: group.avg_vol_ratio > 1 ? 700 : 500,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                }}>
                  {group.avg_vol_ratio.toFixed(2)}× vol
                </span>
                {group.avg_note && (
                  <>
                    <sup style={{ fontSize: '0.5rem', color: '#8A8478', marginLeft: 2 }}>*</sup>
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
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 22,
      }}>
        <span style={{ fontSize: 11, color: '#8A8478', letterSpacing: '0.04em' }}>
          {data.updated_at}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: 'transparent', border: 'none',
            color: '#8A8478', padding: '4px 6px', fontSize: 11,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit',
            opacity: refreshing ? 0.5 : 0.7,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = refreshing ? '0.5' : '0.7' }}
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: refreshing ? 'mb-spin 0.9s linear infinite' : 'none' }}
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
        <div key={section.name} style={{ marginTop: idx === 0 ? 0 : 28 }}>
          <div style={{
            fontSize: 12.5, letterSpacing: '0.14em',
            textTransform: 'uppercase' as const,
            color: '#5B5547', fontWeight: 700,
            marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {section.name}
            <div style={{ flex: 1, height: 1, background: 'rgba(45,42,36,0.07)' }} />
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

      <style>{`
        @keyframes mb-spin { from {transform:rotate(0)} to {transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}
