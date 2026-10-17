import { useEffect, useState, useMemo } from 'react'
import { MarketCapChart } from './MarketCapChart'

interface DataPoint {
  timestamp: string
  market_cap: number
}

interface Changes {
  '1d': number | null
  '7d': number | null
  '30d': number | null
  '90d': number | null
  ytd: number | null
}

interface TickerViewProps {
  ticker: string
}

type TimeRange = 'YTD' | '1Y' | '3Y'

const MARKET_CAP_LABELS: Record<string, string> = {
  CRCL: 'USDC',
}

export function TickerView({ ticker }: TickerViewProps) {
  const [allData, setAllData] = useState<DataPoint[]>([])
  const [changes, setChanges] = useState<Changes | null>(null)
  const [latestMarketCap, setLatestMarketCap] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>('YTD')

  // Filter data based on selected time range
  const chartData = useMemo(() => {
    if (allData.length === 0) return []

    const now = new Date(allData[allData.length - 1].timestamp)
    let cutoffDate: Date

    if (timeRange === 'YTD') {
      cutoffDate = new Date(now.getFullYear(), 0, 1) // Jan 1 of current year
    } else {
      const yearsAgo = timeRange === '1Y' ? 1 : 3
      cutoffDate = new Date(now)
      cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsAgo)
    }

    return allData.filter((d) => new Date(d.timestamp) >= cutoffDate)
  }, [allData, timeRange])

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)

      try {
        const [marketCapRes, changesRes] = await Promise.all([
          fetch(`/api/tickers/${ticker.toLowerCase()}/market-cap`),
          fetch(`/api/tickers/${ticker.toLowerCase()}/changes`),
        ])

        if (!marketCapRes.ok || !changesRes.ok) {
          throw new Error('Failed to fetch data')
        }

        const marketCapData = await marketCapRes.json()
        const changesData = await changesRes.json()

        setAllData(marketCapData.data)
        setChanges(changesData.changes)
        // Use the last data point from chart data for consistency
        const data = marketCapData.data
        if (data.length > 0) {
          setLatestMarketCap(data[data.length - 1].market_cap)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [ticker])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sol-base00">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sol-down">Error: {error}</div>
      </div>
    )
  }

  const formatChange = (value: number | null) => {
    if (value === null) return 'N/A'
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}%`
  }

  const getChangeColor = (value: number | null) => {
    if (value === null) return 'text-sol-base00'
    return value >= 0 ? 'text-sol-up' : 'text-sol-down'
  }

  const formatMarketCap = (value: number | null) => {
    if (value === null) return 'N/A'
    return `$${(value / 1e9).toFixed(2)}B`
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-baseline gap-4">
        <h2 className="text-2xl font-bold tracking-[-0.01em] text-sol-base02">{MARKET_CAP_LABELS[ticker] ?? ticker}</h2>
        <span className="text-lg text-sol-base00">
          Market Cap:{' '}
          <a
            href="https://coinmarketcap.com/currencies/usd-coin/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sol-link hover:text-sol-cyan transition-colors duration-200"
          >
            {formatMarketCap(latestMarketCap)}
          </a>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-sol-base01">Range:</span>
        <div className="mp-segment">
          {(['YTD', '1Y', '3Y'] as const).map((r) => (
            <button key={r} onClick={() => setTimeRange(r)} aria-pressed={timeRange === r}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <MarketCapChart data={chartData} title={`${MARKET_CAP_LABELS[ticker] ?? ticker} Market Cap (${timeRange})`} timeRange={timeRange} />

      <div className="mp-card overflow-hidden max-w-md mx-auto">
        <table className="w-full">
          <thead className="border-b border-[var(--line-strong)]">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-sol-base01">
                Period
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-sol-base01">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {changes && (
              <>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base01">1 Day</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['1d'])}`}>
                    {formatChange(changes['1d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base01">7 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['7d'])}`}>
                    {formatChange(changes['7d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base01">30 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['30d'])}`}>
                    {formatChange(changes['30d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base01">90 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['90d'])}`}>
                    {formatChange(changes['90d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base01">YTD</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes.ytd)}`}>
                    {formatChange(changes.ytd)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
