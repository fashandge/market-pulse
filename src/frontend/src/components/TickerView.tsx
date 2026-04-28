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
        <div className="text-sol-base1">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sol-red">Error: {error}</div>
      </div>
    )
  }

  const formatChange = (value: number | null) => {
    if (value === null) return 'N/A'
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}%`
  }

  const getChangeColor = (value: number | null) => {
    if (value === null) return 'text-sol-base1'
    return value >= 0 ? 'text-sol-green' : 'text-sol-red'
  }

  const formatMarketCap = (value: number | null) => {
    if (value === null) return 'N/A'
    return `$${(value / 1e9).toFixed(2)}B`
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-baseline gap-4">
        <h2 className="text-2xl font-semibold text-sol-base01">{ticker}</h2>
        <span className="text-lg text-sol-base00">
          Market Cap:{' '}
          <a
            href="https://coinmarketcap.com/currencies/usd-coin/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sol-blue hover:text-sol-cyan transition-colors duration-200"
          >
            {formatMarketCap(latestMarketCap)}
          </a>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-sol-base1">Range:</span>
        <div className="inline-flex rounded-lg overflow-hidden shadow-sm">
          <button
            onClick={() => setTimeRange('YTD')}
            className={`px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
              timeRange === 'YTD'
                ? 'bg-sol-blue text-white'
                : 'bg-sol-base2 text-sol-base00 hover:bg-sol-base1/20'
            }`}
          >
            YTD
          </button>
          <button
            onClick={() => setTimeRange('1Y')}
            className={`px-4 py-1.5 text-sm font-medium border-l border-sol-base1/30 transition-all duration-200 ${
              timeRange === '1Y'
                ? 'bg-sol-blue text-white'
                : 'bg-sol-base2 text-sol-base00 hover:bg-sol-base1/20'
            }`}
          >
            1Y
          </button>
          <button
            onClick={() => setTimeRange('3Y')}
            className={`px-4 py-1.5 text-sm font-medium border-l border-sol-base1/30 transition-all duration-200 ${
              timeRange === '3Y'
                ? 'bg-sol-blue text-white'
                : 'bg-sol-base2 text-sol-base00 hover:bg-sol-base1/20'
            }`}
          >
            3Y
          </button>
        </div>
      </div>

      <MarketCapChart data={chartData} title={`${ticker} Market Cap (${timeRange})`} />

      <div className="bg-sol-base3 rounded-lg border border-sol-base1/30 overflow-hidden max-w-md mx-auto shadow-sm">
        <table className="w-full">
          <thead className="bg-sol-base2">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-sol-base01">
                Period
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-sol-base01">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sol-base1/20">
            {changes && (
              <>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base00">1 Day</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['1d'])}`}>
                    {formatChange(changes['1d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base00">7 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['7d'])}`}>
                    {formatChange(changes['7d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base00">30 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['30d'])}`}>
                    {formatChange(changes['30d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base00">90 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['90d'])}`}>
                    {formatChange(changes['90d'])}
                  </td>
                </tr>
                <tr className="hover:bg-sol-base2/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-sol-base00">YTD</td>
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
