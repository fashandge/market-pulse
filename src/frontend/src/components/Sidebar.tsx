import { useState } from 'react'

interface SidebarProps {
  selectedTab: string
  onSelectTab: (tab: string) => void
}

export function Sidebar({ selectedTab, onSelectTab }: SidebarProps) {
  const [tickersExpanded, setTickersExpanded] = useState(true)

  const tickers = ['CRCL']

  return (
    <div className="w-52 min-h-screen bg-sol-base2 border-r border-sol-base1/30 p-4">
      <h1 className="text-lg font-semibold mb-4 text-sol-base01">Market Pulse</h1>

      <nav className="space-y-1">
        <button
          onClick={() => onSelectTab('market')}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            selectedTab === 'market'
              ? 'bg-sol-blue/15 text-sol-blue'
              : 'text-sol-base00 hover:bg-sol-base3'
          }`}
        >
          Market News
        </button>

        <div>
          <button
            onClick={() => setTickersExpanded(!tickersExpanded)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-sol-base00 hover:bg-sol-base3 rounded-lg transition-all duration-200"
          >
            <span>Tickers</span>
            <span className={`transform transition-transform duration-200 ${tickersExpanded ? 'rotate-90' : ''}`}>
              ▶
            </span>
          </button>

          {tickersExpanded && (
            <div className="ml-3 mt-1 space-y-1">
              {tickers.map((ticker) => (
                <button
                  key={ticker}
                  onClick={() => onSelectTab(ticker)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    selectedTab === ticker
                      ? 'bg-sol-blue/15 text-sol-blue font-medium'
                      : 'text-sol-base00 hover:bg-sol-base3'
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
