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
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Error: {error}</div>
      </div>
    )
  }

  const formatChange = (value: number | null) => {
    if (value === null) return 'N/A'
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}%`
  }

  const getChangeColor = (value: number | null) => {
    if (value === null) return 'text-gray-500'
    return value >= 0 ? 'text-green-600' : 'text-red-600'
  }

  const formatMarketCap = (value: number | null) => {
    if (value === null) return 'N/A'
    return `$${(value / 1e9).toFixed(2)}B`
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-baseline gap-4">
        <h2 className="text-2xl font-semibold text-gray-800">{ticker}</h2>
        <span className="text-lg text-gray-600">
          Market Cap:{' '}
          <a
            href="https://coinmarketcap.com/currencies/usd-coin/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            {formatMarketCap(latestMarketCap)}
          </a>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Range:</span>
        <div className="inline-flex rounded-md shadow-sm">
          <button
            onClick={() => setTimeRange('YTD')}
            className={`px-3 py-1 text-sm font-medium rounded-l-md border ${
              timeRange === 'YTD'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            YTD
          </button>
          <button
            onClick={() => setTimeRange('1Y')}
            className={`px-3 py-1 text-sm font-medium border-t border-r border-b ${
              timeRange === '1Y'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            1Y
          </button>
          <button
            onClick={() => setTimeRange('3Y')}
            className={`px-3 py-1 text-sm font-medium rounded-r-md border-t border-r border-b ${
              timeRange === '3Y'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            3Y
          </button>
        </div>
      </div>

      <MarketCapChart data={chartData} title={`${ticker} Market Cap (${timeRange})`} />

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-w-md mx-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                Period
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {changes && (
              <>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-800">1 Day</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['1d'])}`}>
                    {formatChange(changes['1d'])}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-800">7 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['7d'])}`}>
                    {formatChange(changes['7d'])}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-800">30 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['30d'])}`}>
                    {formatChange(changes['30d'])}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-800">90 Days</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeColor(changes['90d'])}`}>
                    {formatChange(changes['90d'])}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-800">YTD</td>
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
