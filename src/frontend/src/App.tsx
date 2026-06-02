import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TickerView } from './components/TickerView'
import { MarketView } from './components/MarketView'
import { MarketOverview } from './components/MarketOverview'
import { AiNewsView } from './components/AiNewsView'

function App() {
  const [selectedTab, setSelectedTab] = useState(() => {
    return sessionStorage.getItem('selectedTab') || 'overview'
  })

  const handleSelectTab = (tab: string) => {
    sessionStorage.setItem('selectedTab', tab)
    setSelectedTab(tab)
  }

  const renderContent = () => {
    if (selectedTab === 'overview') {
      return <MarketOverview />
    }
    if (selectedTab === 'market') {
      return <MarketView />
    }
    if (selectedTab === 'ai-news') {
      return <AiNewsView />
    }

    return <TickerView ticker={selectedTab} />
  }

  return (
    <div className="flex min-h-screen bg-sol-base3">
      <Sidebar selectedTab={selectedTab} onSelectTab={handleSelectTab} />
      <main className="flex-1 p-6">{renderContent()}</main>
    </div>
  )
}

export default App
