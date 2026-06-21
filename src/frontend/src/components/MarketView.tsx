import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface SummaryResponse {
  date: string
  content: string | null
}

interface CfzhSummariesResponse {
  summaries: SummaryResponse[]
}

type SourceTab = 'trading-view' | 'cfzh' | 'x'

const SOURCE_TABS: SourceTab[] = ['trading-view', 'x', 'cfzh']

const SOURCE_CONFIG: Record<string, { label: string; endpoint: string; noDataMessage: string }> = {
  'trading-view': {
    label: 'Trading View',
    endpoint: '/api/market/ndx-summary',
    noDataMessage: 'No Trading View summary generated for',
  },
  cfzh: {
    label: 'CFZH',
    endpoint: '/api/market/cfzh-summary',
    noDataMessage: 'No CFZH forum summary generated for',
  },
  x: {
    label: 'X',
    endpoint: '/api/market/x-summary',
    noDataMessage: 'No X market news summary generated for',
  },
}

const TAB_LABELS: Record<SourceTab, string> = {
  'trading-view': 'Trading View',
  x: 'X',
  cfzh: 'CFZH',
}

export function MarketView() {
  const [activeSource, setActiveSource] = useState<SourceTab>(() => {
    const stored = sessionStorage.getItem('marketNewsTab') as SourceTab
    return stored && SOURCE_TABS.includes(stored) ? stored : 'trading-view'
  })
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [cfzhSummaries, setCfzhSummaries] = useState<SummaryResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleSelectSource = (source: SourceTab) => {
    setActiveSource(source)
    sessionStorage.setItem('marketNewsTab', source)
  }

  useEffect(() => {
    setLoading(true)
    setError(null)

    if (activeSource === 'cfzh') {
      fetch('/api/market/cfzh-summaries')
        .then((res) => res.json())
        .then((data: CfzhSummariesResponse) => {
          setCfzhSummaries(data.summaries)
          setLoading(false)
        })
        .catch((err) => {
          setError(err.message)
          setLoading(false)
        })
    } else {
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
    }
  }, [activeSource])

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

    if (activeSource === 'cfzh') {
      if (cfzhSummaries.length === 0 || cfzhSummaries.every((s) => !s.content)) {
        return (
          <div className="flex items-center justify-center h-64 text-sol-base1">
            No CFZH forum summaries available yet.
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-3">
          {cfzhSummaries.map((s, i) => (
            <details
              key={s.date}
              open={i === 0}
              className="border border-sol-base2 rounded-lg overflow-hidden"
            >
              <summary className="px-4 py-3 bg-sol-base3 cursor-pointer font-medium text-sol-base01 hover:bg-sol-base2/50 select-none">
                {s.date}
              </summary>
              <div className="px-4 py-3">
                {s.content ? (
                  <div className="prose prose-base max-w-none prose-headings:text-sol-base01 prose-p:text-sol-base00 prose-a:text-sol-blue prose-strong:text-sol-base01 prose-code:text-sol-cyan prose-code:bg-sol-base2 prose-code:px-1 prose-code:rounded">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sol-base1">No summary for {s.date}.</p>
                )}
              </div>
            </details>
          ))}
        </div>
      )
    }

    if (!summary?.content) {
      return (
        <div className="flex items-center justify-center h-64 text-sol-base1">
          {SOURCE_CONFIG[activeSource].noDataMessage} {summary?.date} yet.
        </div>
      )
    }

    return (
      <div className="prose prose-base max-w-none prose-headings:text-sol-base01 prose-p:text-sol-base00 prose-a:text-sol-blue prose-strong:text-sol-base01 prose-code:text-sol-cyan prose-code:bg-sol-base2 prose-code:px-1 prose-code:rounded">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary.content}</ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="flex gap-1 mb-6 border-b border-sol-base1/30">
        {SOURCE_TABS.map((source) => (
          <button
            key={source}
            onClick={() => handleSelectSource(source)}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              activeSource === source
                ? 'text-sol-blue border-b-2 border-sol-blue'
                : 'text-sol-base00 hover:text-sol-base01 hover:bg-sol-blue/20 rounded-t cursor-pointer'
            }`}
          >
            {TAB_LABELS[source]}
          </button>
        ))}
      </div>
      {renderContent()}
    </div>
  )
}
