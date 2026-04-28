import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TickerView } from './components/TickerView'
import { MarketView } from './components/MarketView'

function App() {
  const [selectedTab, setSelectedTab] = useState('CRCL')

  const renderContent = () => {
    if (selectedTab === 'market') {
      return <MarketView />
    }

    return <TickerView ticker={selectedTab} />
  }

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar selectedTab={selectedTab} onSelectTab={setSelectedTab} />
      <main className="flex-1 p-6">{renderContent()}</main>
    </div>
  )
}

export default App
