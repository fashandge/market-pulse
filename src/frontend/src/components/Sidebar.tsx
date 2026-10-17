import { useState, type ReactNode } from 'react'
import { Chevron } from './Chevron'

interface SidebarProps {
  selectedTab: string
  onSelectTab: (tab: string) => void
}

// 16px stroke icons, drawn in currentColor so they follow the item's state.
const ICONS: Record<string, ReactNode> = {
  overview: <path d="M2.5 13.5h11M4 11V7.5M8 11V3.5M12 11V6" />,
  market: <path d="M3 3.5h10M3 6.5h10M3 9.5h6.5M3 12.5h4.5" />,
  'china-news': <><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10 5.7 8S6.4 4.1 8 2.5Z" /></>,
  'ai-news': <path d="M8 2.5 9.4 6.6 13.5 8 9.4 9.4 8 13.5 6.6 9.4 2.5 8 6.6 6.6Z" />,
}

const GROUPS: { label: string; items: { id: string; label: string }[] }[] = [
  { label: 'Markets', items: [{ id: 'overview', label: 'Market Overview' }] },
  {
    label: 'News',
    items: [
      { id: 'market', label: 'Market News' },
      { id: 'china-news', label: 'China Market News' },
      { id: 'ai-news', label: 'AI News' },
    ],
  },
]

function NavItem({ active, onClick, icon, children }: {
  active: boolean
  onClick: () => void
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group relative w-full flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[0.9rem] text-left transition-colors duration-150 cursor-pointer ${
        active
          ? 'bg-sol-base3 text-sol-link font-bold shadow-[0_1px_2px_rgba(7,54,66,0.08),0_0_0_1px_var(--line)]'
          : 'text-sol-base01 hover:bg-sol-base2/70 hover:text-sol-base02'
      }`}
    >
      {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-sol-blue" />}
      {icon && (
        <svg
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className={`w-4 h-4 shrink-0 ${active ? '' : 'text-sol-base00 group-hover:text-sol-base01'}`}
        >
          {icon}
        </svg>
      )}
      <span className="truncate">{children}</span>
    </button>
  )
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 mb-1.5 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-sol-base00">
      {children}
    </div>
  )
}

export function Sidebar({ selectedTab, onSelectTab }: SidebarProps) {
  const [tickersExpanded, setTickersExpanded] = useState(true)

  const tickers = ['CRCL']

  return (
    <aside className="w-56 shrink-0 sticky top-0 h-screen overflow-y-auto bg-sol-rail border-r border-[var(--line)] px-3 py-5">
      <div className="flex items-center gap-2.5 px-2 mb-7">
        <span aria-hidden className="grid place-items-center w-8 h-8 rounded-[10px] bg-sol-blue/12 text-sol-blue">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
            <path d="M1.5 8.5h3l1.5-4 3 8 1.8-4.5h3.7" />
          </svg>
        </span>
        <h1 className="text-[1.05rem] font-bold tracking-[-0.01em] text-sol-base02">Market Pulse</h1>
      </div>

      <nav className="flex flex-col gap-6">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <GroupLabel>{group.label}</GroupLabel>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  active={selectedTab === item.id}
                  onClick={() => onSelectTab(item.id)}
                  icon={ICONS[item.id]}
                >
                  {item.label}
                </NavItem>
              ))}
            </div>
          </div>
        ))}

        <div>
          <button
            onClick={() => setTickersExpanded(!tickersExpanded)}
            aria-expanded={tickersExpanded}
            className="w-full flex items-center justify-between pr-2 cursor-pointer rounded-md"
          >
            <GroupLabel>Tickers</GroupLabel>
            <span className="mb-1.5"><Chevron open={tickersExpanded} /></span>
          </button>

          {tickersExpanded && (
            <div className="flex flex-col gap-0.5">
              {tickers.map((ticker) => (
                <NavItem key={ticker} active={selectedTab === ticker} onClick={() => onSelectTab(ticker)}>
                  <span className="font-mono text-[0.85rem] tracking-wide">{ticker}</span>
                </NavItem>
              ))}
            </div>
          )}
        </div>
      </nav>
    </aside>
  )
}
