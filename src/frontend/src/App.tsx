import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TickerView } from './components/TickerView'

function App() {
  const [selectedTab, setSelectedTab] = useState('CRCL')

  const renderContent = () => {
    if (selectedTab === 'market') {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          Market overview coming soon...
        </div>
      )
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
