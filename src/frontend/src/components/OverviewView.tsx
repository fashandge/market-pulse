import { useState } from 'react'
import { MarketOverview } from './MarketOverview'
import { TickerSearch } from './TickerSearch'
import { TaCharts } from './TaCharts'
import { PnfChart } from './PnfChart'
import { TrendSpiderView } from './TrendSpiderView'

type OverviewTab = 'overview' | 'charts' | 'pnf' | 'trendspider'
const TABS: { id: OverviewTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'pnf', label: 'P&F' },
  { id: 'trendspider', label: 'Trend Spider' },
]

export function OverviewView() {
  const [activeTab, setActiveTab] = useState<OverviewTab>(() => {
    const stored = sessionStorage.getItem('overviewTab')
    return TABS.some((t) => t.id === stored) ? (stored as OverviewTab) : 'overview'
  })
  const [chartTicker, setChartTicker] = useState<string>(
    () => sessionStorage.getItem('chartsTicker') || 'QQQ',
  )

  const handleSelectTab = (tab: OverviewTab) => {
    setActiveTab(tab)
    sessionStorage.setItem('overviewTab', tab)
  }

  const handleSelectTicker = (symbol: string) => {
    setChartTicker(symbol)
    sessionStorage.setItem('chartsTicker', symbol)
  }

  return (
    <div className={activeTab === 'charts' || activeTab === 'pnf' ? 'max-w-6xl' : ''}>
      <div className="flex gap-1 mb-6 border-b border-sol-base1/30">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSelectTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? 'text-sol-blue border-b-2 border-sol-blue'
                : 'text-sol-base00 hover:text-sol-base01 hover:bg-sol-blue/20 rounded-t cursor-pointer'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <MarketOverview />}

      {activeTab === 'charts' && (
        <div className="space-y-4">
          <TickerSearch onSelect={handleSelectTicker} selected={chartTicker} />
          {chartTicker ? (
            <TaCharts ticker={chartTicker} />
          ) : (
            <div className="flex items-center justify-center h-64 text-sol-base1">
              Search for a ticker to view its charts.
            </div>
          )}
        </div>
      )}

      {activeTab === 'pnf' && (
        <div className="space-y-4">
          <TickerSearch onSelect={handleSelectTicker} selected={chartTicker} />
          {chartTicker ? (
            <PnfChart ticker={chartTicker} />
          ) : (
            <div className="flex items-center justify-center h-64 text-sol-base1">
              Search for a ticker to view its Point &amp; Figure chart.
            </div>
          )}
        </div>
      )}

      {activeTab === 'trendspider' && <TrendSpiderView />}
    </div>
  )
}
