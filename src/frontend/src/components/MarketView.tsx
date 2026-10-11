import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SignalDigestDay, type SignalDigestRun } from './SignalDigestDay'

interface SummaryResponse {
  date: string
  content: string | null
  runs?: SignalDigestRun[]  // signal digests: every run that day, newest first
}

interface DailySummariesResponse {
  summaries: SummaryResponse[]
}

type SourceTab = 'trading-view' | 'cfzh' | 'x' | 'general' | 'x-today'

const SOURCE_TABS: SourceTab[] = ['trading-view', 'x', 'cfzh', 'general', 'x-today']

// Tabs that show the last few days' summaries as collapsible sections.
const MULTI_DAY_SOURCES: Partial<Record<SourceTab, { endpoint: string; emptyMessage: string }>> = {
  cfzh: {
    endpoint: '/api/market/cfzh-summaries',
    emptyMessage: 'No CFZH forum summaries available yet.',
  },
  general: {
    endpoint: '/api/market/signal-digests',
    emptyMessage: 'No signal digests in the last 4 days.',
  },
  'x-today': {
    endpoint: '/api/market/x-today-news',
    emptyMessage: 'No X Today news in the last 4 days.',
  },
}

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
  general: 'General',
  'x-today': 'X Today',
}

export function MarketView() {
  const [activeSource, setActiveSource] = useState<SourceTab>(() => {
    const stored = sessionStorage.getItem('marketNewsTab') as SourceTab
    return stored && SOURCE_TABS.includes(stored) ? stored : 'trading-view'
  })
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [dailySummaries, setDailySummaries] = useState<SummaryResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleSelectSource = (source: SourceTab) => {
    setActiveSource(source)
    sessionStorage.setItem('marketNewsTab', source)
  }

  useEffect(() => {
    setLoading(true)
    setError(null)

    const multiDay = MULTI_DAY_SOURCES[activeSource]
    if (multiDay) {
      setDailySummaries([])
      fetch(multiDay.endpoint)
        .then((res) => res.json())
        .then((data: DailySummariesResponse) => {
          setDailySummaries(data.summaries)
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

    const multiDay = MULTI_DAY_SOURCES[activeSource]
    if (multiDay) {
      if (dailySummaries.length === 0 || dailySummaries.every((s) => !s.content && !s.runs?.length)) {
        return (
          <div className="flex items-center justify-center h-64 text-sol-base1">
            {multiDay.emptyMessage}
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-3">
          {dailySummaries.map((s, i) => (
            <details
              key={s.date}
              open={i === 0}
              className="border border-sol-base2 rounded-lg overflow-hidden"
            >
              <summary className="px-4 py-3 bg-sol-base3 cursor-pointer font-medium text-sol-base01 hover:bg-sol-base2/50 select-none">
                {s.date}
                {s.runs && (
                  <span className="ml-2 text-sm font-normal text-sol-base1">
                    {s.runs.length} {s.runs.length === 1 ? 'run' : 'runs'}
                  </span>
                )}
              </summary>
              <div className="px-4 py-3">
                {s.runs?.length ? (
                  <SignalDigestDay runs={s.runs} />
                ) : s.content ? (
                  <div className="prose prose-base summary-prose">
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
      <div className="prose prose-base summary-prose">
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
