import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChinaNewsResponse {
  region: string
  date: string | null
  is_today: boolean
  content: string | null
}

type Region = 'china' | 'hk'

const REGION_TABS: Region[] = ['china', 'hk']

const REGION_LABELS: Record<Region, string> = {
  china: 'China',
  hk: 'Hong Kong',
}

export function ChinaNewsView() {
  const [activeRegion, setActiveRegion] = useState<Region>(() => {
    const stored = sessionStorage.getItem('chinaNewsTab') as Region
    return stored && REGION_TABS.includes(stored) ? stored : 'china'
  })
  const [data, setData] = useState<ChinaNewsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleSelectRegion = (region: Region) => {
    setActiveRegion(region)
    sessionStorage.setItem('chinaNewsTab', region)
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/market/china-news?region=${activeRegion}`)
      .then((res) => res.json())
      .then((d: ChinaNewsResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [activeRegion])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64 text-sol-base1">
          Loading...
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-64 text-sol-red">
          Error: {error}
        </div>
      )
    }

    if (!data?.content) {
      return (
        <div className="flex items-center justify-center h-64 text-sol-base1">
          No {REGION_LABELS[activeRegion]} market news summary available yet.
        </div>
      )
    }

    return (
      <>
        {!data.is_today && (
          <div className="mb-6 px-4 py-3 rounded-lg border border-sol-yellow/40 bg-sol-yellow/10 text-sol-base01 text-sm">
            ⚠️ Today's {REGION_LABELS[activeRegion]} market news isn't generated yet. Showing the
            latest available summary from <strong>{data.date}</strong>.
          </div>
        )}
        <div className="prose prose-base max-w-none prose-headings:text-sol-base01 prose-p:text-sol-base00 prose-a:text-sol-blue prose-strong:text-sol-base01 prose-code:text-sol-cyan prose-code:bg-sol-base2 prose-code:px-1 prose-code:rounded">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
        </div>
      </>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="flex gap-1 mb-6 border-b border-sol-base1/30">
        {REGION_TABS.map((region) => (
          <button
            key={region}
            onClick={() => handleSelectRegion(region)}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              activeRegion === region
                ? 'text-sol-blue border-b-2 border-sol-blue'
                : 'text-sol-base00 hover:text-sol-base01 hover:bg-sol-blue/20 rounded-t cursor-pointer'
            }`}
          >
            {REGION_LABELS[region]}
          </button>
        ))}
      </div>
      {renderContent()}
    </div>
  )
}
