import { useState } from 'react'

interface SidebarProps {
  selectedTab: string
  onSelectTab: (tab: string) => void
}

export function Sidebar({ selectedTab, onSelectTab }: SidebarProps) {
  const [tickersExpanded, setTickersExpanded] = useState(true)

  const tickers = ['CRCL']

  return (
    <div className="w-52 min-h-screen bg-gray-50 border-r border-gray-200 p-4">
      <h1 className="text-lg font-semibold mb-4 text-gray-800">Market Pulse</h1>

      <nav className="space-y-1">
        <button
          onClick={() => onSelectTab('market')}
          className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            selectedTab === 'market'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Market News
        </button>

        <div>
          <button
            onClick={() => setTickersExpanded(!tickersExpanded)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md"
          >
            <span>Tickers</span>
            <span className={`transform transition-transform ${tickersExpanded ? 'rotate-90' : ''}`}>
              ▶
            </span>
          </button>

          {tickersExpanded && (
            <div className="ml-3 mt-1 space-y-1">
              {tickers.map((ticker) => (
                <button
                  key={ticker}
                  onClick={() => onSelectTab(ticker)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedTab === ticker
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {ticker}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
    </div>
  )
}
