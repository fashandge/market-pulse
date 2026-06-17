import { useEffect, useRef, useState } from 'react'

interface TickerResult {
  symbol: string
  name: string | null
}

interface TickerSearchProps {
  onSelect: (symbol: string) => void
  selected?: string
}

const RECENTS_KEY = 'recentTickers'
const RECENTS_MAX = 6

function loadRecents(): TickerResult[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function TickerSearch({ onSelect, selected }: TickerSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TickerResult[]>([])
  const [portfolio, setPortfolio] = useState<TickerResult[]>([])
  const [recents, setRecents] = useState<TickerResult[]>(loadRecents)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasQuery = query.trim().length > 0

  // Quick-picks shown when the box is empty: recently-searched tickers that are
  // not already in the portfolio (no duplicates), then the portfolio itself.
  const portfolioSymbols = new Set(portfolio.map((p) => p.symbol))
  const recentPicks = recents.filter((r) => !portfolioSymbols.has(r.symbol)).slice(0, RECENTS_MAX)
  // Flat list backing keyboard navigation (sections rendered separately below).
  const list = hasQuery ? results : [...recentPicks, ...portfolio]

  // Load portfolio quick-picks once.
  useEffect(() => {
    fetch('/api/tickers/portfolio')
      .then((res) => res.json())
      .then((data: { results: TickerResult[] }) => setPortfolio(data.results))
      .catch(() => setPortfolio([]))
  }, [])

  // Debounced search against the backend.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setActiveIndex(0)
      return
    }
    const handle = setTimeout(() => {
      fetch(`/api/tickers/search?q=${encodeURIComponent(q)}&limit=20`)
        .then((res) => res.json())
        .then((data: { results: TickerResult[] }) => {
          setResults(data.results)
          setActiveIndex(0)
        })
        .catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(handle)
  }, [query])

  // Close dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const rememberRecent = (item: TickerResult) => {
    setRecents((prev) => {
      const next = [item, ...prev.filter((r) => r.symbol !== item.symbol)].slice(0, 12)
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
      } catch {
        // ignore storage failures (private mode, quota)
      }
      return next
    })
  }

  const choose = (item: TickerResult) => {
    onSelect(item.symbol)
    rememberRecent(item)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || list.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, list.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (list[activeIndex]) choose(list[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const sectionHeader = (text: string) => (
    <li className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-sol-base1 bg-sol-base2/40 select-none">
      {text}
    </li>
  )

  // `globalIndex` keeps activeIndex/selection consistent across the two sections.
  const renderItem = (r: TickerResult, globalIndex: number) => (
    <li
      key={r.symbol}
      onMouseDown={(e) => {
        e.preventDefault()
        choose(r)
      }}
      onMouseEnter={() => setActiveIndex(globalIndex)}
      className={`px-4 py-2 cursor-pointer flex items-baseline gap-2 ${
        globalIndex === activeIndex ? 'bg-sol-blue/15' : 'hover:bg-sol-base2/60'
      }`}
    >
      <span className="font-semibold text-sol-base01">{r.symbol}</span>
      {r.name && <span className="text-xs text-sol-base1 truncate">{r.name}</span>}
    </li>
  )

  return (
    <div ref={containerRef} className="relative max-w-md">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={selected ? `Search ticker (current: ${selected})` : 'Search ticker (e.g. NVDA, BTC)…'}
        className="w-full px-4 py-2 text-sm bg-sol-base3 border border-sol-base1/40 rounded-lg text-sol-base01 placeholder-sol-base1 focus:outline-none focus:border-sol-blue focus:ring-1 focus:ring-sol-blue"
      />
      {open && list.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto bg-sol-base3 border border-sol-base1/40 rounded-lg shadow-lg">
          {hasQuery ? (
            list.map((r, i) => renderItem(r, i))
          ) : (
            <>
              {recentPicks.length > 0 && sectionHeader('Recently searched')}
              {recentPicks.map((r, i) => renderItem(r, i))}
              {portfolio.length > 0 && sectionHeader('Portfolio')}
              {portfolio.map((r, j) => renderItem(r, recentPicks.length + j))}
            </>
          )}
        </ul>
      )}
    </div>
  )
}
