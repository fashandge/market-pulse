import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'

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
        <StatusMessage kind="loading" />
      )
    }

    if (error) {
      return (
        <StatusMessage kind="error">Error: {error}</StatusMessage>
      )
    }

    if (!data?.content) {
      return (
        <StatusMessage kind="empty">No {REGION_LABELS[activeRegion]} market news summary available yet.</StatusMessage>
      )
    }

    return (
      <>
        {!data.is_today && (
          <div className="mp-notice mb-6">
            Today's {REGION_LABELS[activeRegion]} market news isn't generated yet. Showing the
            latest available summary from <strong>{data.date}</strong>.
          </div>
        )}
        <div className="prose prose-base summary-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
        </div>
      </>
    )
  }

  return (
    <div className="max-w-3xl">
      <Tabs
        tabs={REGION_TABS.map((id) => ({ id, label: REGION_LABELS[id] }))}
        active={activeRegion}
        onSelect={handleSelectRegion}
      />
      {renderContent()}
    </div>
  )
}
