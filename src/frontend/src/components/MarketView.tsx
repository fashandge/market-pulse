import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SignalDigestDay, type SignalDigestRun } from './SignalDigestDay'
import { EventsView } from './EventsView'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { Chevron } from './Chevron'

interface SummaryResponse {
  date: string
  content: string | null
  runs?: SignalDigestRun[]  // signal digests: every run that day, newest first
}

interface DailySummariesResponse {
  summaries: SummaryResponse[]
}

type SourceTab = 'trading-view' | 'cfzh' | 'x' | 'general' | 'events'

const SOURCE_TABS: SourceTab[] = ['trading-view', 'x', 'cfzh', 'general', 'events']

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
  events: 'Calendar',
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
    // The Calendar tab fetches its own data (EventsView).
    if (activeSource === 'events') return
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
    if (activeSource === 'events') {
      return <EventsView />
    }

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

    const multiDay = MULTI_DAY_SOURCES[activeSource]
    if (multiDay) {
      if (dailySummaries.length === 0 || dailySummaries.every((s) => !s.content && !s.runs?.length)) {
        return (
          <StatusMessage kind="empty">{multiDay.emptyMessage}</StatusMessage>
        )
      }
      return (
        <div className="flex flex-col gap-3">
          {dailySummaries.map((s, i) => (
            <details
              key={s.date}
              open={i === 0}
              className="mp-fold"
            >
              <summary>
                <Chevron />
                {s.date}
                {s.runs && (
                  <span className="text-sm font-normal text-sol-base00">
                    {s.runs.length} {s.runs.length === 1 ? 'run' : 'runs'}
                  </span>
                )}
              </summary>
              <div className="px-5 py-4">
                {s.runs?.length ? (
                  <SignalDigestDay runs={s.runs} />
                ) : s.content ? (
                  <div
                    lang={activeSource === 'cfzh' ? 'zh-CN' : undefined}
                    className="prose prose-base summary-prose"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sol-base00">No summary for {s.date}.</p>
                )}
              </div>
            </details>
          ))}
        </div>
      )
    }

    if (!summary?.content) {
      return (
        <StatusMessage kind="empty">{SOURCE_CONFIG[activeSource].noDataMessage} {summary?.date} yet.</StatusMessage>
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
      <Tabs
        tabs={SOURCE_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))}
        active={activeSource}
        onSelect={handleSelectSource}
      />
      {renderContent()}
    </div>
  )
}
