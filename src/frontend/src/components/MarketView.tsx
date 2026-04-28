import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface SummaryResponse {
  date: string
  content: string | null
}

type SourceTab = 'trading-view' | 'cfzh' | 'x'

const SOURCE_CONFIG: Record<SourceTab, { label: string; endpoint: string; noDataMessage: string }> = {
  'trading-view': {
    label: 'Trading View',
    endpoint: 'http://localhost:8000/api/market/ndx-summary',
    noDataMessage: 'No Trading View summary generated for',
  },
  cfzh: {
    label: 'CFZH',
    endpoint: 'http://localhost:8000/api/market/cfzh-summary',
    noDataMessage: 'No CFZH forum summary generated for',
  },
  x: {
    label: 'X',
    endpoint: 'http://localhost:8000/api/market/x-summary',
    noDataMessage: 'No X market news summary generated for',
  },
}

export function MarketView() {
  const [activeSource, setActiveSource] = useState<SourceTab>('trading-view')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(SOURCE_CONFIG[activeSource].endpoint)
      .then((res) => res.json())
      .then((data) => {
        setSummary(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [activeSource])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          Loading...
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-64 text-red-500">
          Error: {error}
        </div>
      )
    }

    if (!summary?.content) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          {SOURCE_CONFIG[activeSource].noDataMessage} {summary?.date} yet.
        </div>
      )
    }

    return (
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary.content}</ReactMarkdown>
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(Object.keys(SOURCE_CONFIG) as SourceTab[]).map((source) => (
          <button
            key={source}
            onClick={() => setActiveSource(source)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeSource === source
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {SOURCE_CONFIG[source].label}
          </button>
        ))}
      </div>
      {renderContent()}
    </div>
  )
}
