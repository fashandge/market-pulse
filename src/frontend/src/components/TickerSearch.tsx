import { useEffect, useRef, useState } from 'react'

interface TickerResult {
  symbol: string
  name: string | null
}

interface TickerSearchProps {
  onSelect: (symbol: string) => void
  selected?: string
}

export function TickerSearch({ onSelect, selected }: TickerSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TickerResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounced search against the backend.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
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

  const choose = (symbol: string) => {
    onSelect(symbol)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[activeIndex].symbol)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

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
        onKeyDown={onKeyDown}
        placeholder={selected ? `Search ticker (current: ${selected})` : 'Search ticker (e.g. NVDA, BTC)…'}
        className="w-full px-4 py-2 text-sm bg-sol-base3 border border-sol-base1/40 rounded-lg text-sol-base01 placeholder-sol-base1 focus:outline-none focus:border-sol-blue focus:ring-1 focus:ring-sol-blue"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto bg-sol-base3 border border-sol-base1/40 rounded-lg shadow-lg">
          {results.map((r, i) => (
            <li
              key={r.symbol}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(r.symbol)
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-4 py-2 cursor-pointer flex items-baseline gap-2 ${
                i === activeIndex ? 'bg-sol-blue/15' : 'hover:bg-sol-base2/60'
              }`}
            >
              <span className="font-semibold text-sol-base01">{r.symbol}</span>
              {r.name && <span className="text-xs text-sol-base1 truncate">{r.name}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
