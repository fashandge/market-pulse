import { useState } from 'react'
import { MarketOverview } from './MarketOverview'
import { TickerSearch } from './TickerSearch'
import { TaCharts } from './TaCharts'
import { PnfChart } from './PnfChart'
import { TrendSpiderView } from './TrendSpiderView'
import { BreadthCharts } from './BreadthCharts'
import { CreditCharts } from './CreditCharts'
import { EstimatesView } from './EstimatesView'
import { Tabs } from './Tabs'
import { StatusMessage } from './StatusMessage'

type OverviewTab = 'overview' | 'charts' | 'pnf' | 'trendspider' | 'breadth' | 'credit' | 'estimates'
const TABS: { id: OverviewTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'pnf', label: 'P&F' },
  { id: 'trendspider', label: 'Trend Spider' },
  { id: 'breadth', label: 'Breadth' },
  { id: 'credit', label: 'Credit' },
  { id: 'estimates', label: 'Estimates' },
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
      <Tabs tabs={TABS} active={activeTab} onSelect={handleSelectTab} />

      {activeTab === 'overview' && <MarketOverview />}

      {activeTab === 'charts' && (
        <div className="space-y-4">
          <TickerSearch onSelect={handleSelectTicker} selected={chartTicker} />
          {chartTicker ? (
            <TaCharts ticker={chartTicker} />
          ) : (
            <StatusMessage kind="empty">Search for a ticker to view its charts.</StatusMessage>
          )}
        </div>
      )}

      {activeTab === 'pnf' && (
        <div className="space-y-4">
          <TickerSearch onSelect={handleSelectTicker} selected={chartTicker} />
          {chartTicker ? (
            <PnfChart ticker={chartTicker} />
          ) : (
            <StatusMessage kind="empty">Search for a ticker to view its Point &amp; Figure chart.</StatusMessage>
          )}
        </div>
      )}

      {activeTab === 'trendspider' && <TrendSpiderView />}

      {activeTab === 'breadth' && <BreadthCharts />}

      {activeTab === 'credit' && <CreditCharts />}

      {activeTab === 'estimates' && <EstimatesView />}
    </div>
  )
}
