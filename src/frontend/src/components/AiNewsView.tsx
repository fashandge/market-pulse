import { useState, useEffect } from 'react'

interface AiNewsArticle {
  title: string
  category: string
  snippet: string
  url?: string
  rank?: number
  account?: string
}

interface DayBrief {
  date: string
  articles: AiNewsArticle[]
}

interface AiNewsBriefsResponse {
  today_available: boolean
  briefs: DayBrief[]
}

const ACCOUNT_LABELS: Record<string, string> = {
  'xin-zhi-yuan': '新智元',
  jiqizhixin: '机器之心',
  'liang-zi-wei': '量子位',
}

function formatDateHeading(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function AiNewsView() {
  const [data, setData] = useState<AiNewsBriefsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/market/ai-news-briefs')
      .then((res) => res.json())
      .then((resp: AiNewsBriefsResponse) => {
        setData(resp)
        const initial: Record<string, boolean> = {}
        resp.briefs.forEach((b, i) => {
          initial[b.date] = i === 0
        })
        setExpanded(initial)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const toggle = (date: string) => {
    setExpanded((prev) => ({ ...prev, [date]: !prev[date] }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sol-base1">Loading...</div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-sol-red">Error: {error}</div>
    )
  }

  if (!data || data.briefs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sol-base1">
        No AI news briefs available yet.
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {!data.today_available && (
        <div className="rounded-lg border border-sol-yellow/40 bg-sol-yellow/10 px-4 py-3 text-sm text-sol-yellow mb-6">
          Today's AI news brief has not been generated yet.
        </div>
      )}

      <div className="space-y-3">
        {data.briefs.map((brief) => {
          const isOpen = expanded[brief.date] ?? false
          return (
            <div key={brief.date}>
              <button
                onClick={() => toggle(brief.date)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-sol-base01 hover:bg-sol-base2/50 transition-all duration-200"
              >
                <span
                  className={`transform transition-transform duration-200 text-xs ${isOpen ? 'rotate-90' : ''}`}
                >
                  ▶
                </span>
                <span>{formatDateHeading(brief.date)}</span>
                <span className="text-sol-base1 font-normal ml-1">
                  ({brief.articles.length})
                </span>
              </button>

              {isOpen && (
                <div className="flex flex-col items-center gap-4 mt-2 mb-4">
                  {brief.articles.map((article, index) => {
                    const titleNode = article.url ? (
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sol-base01 font-semibold text-lg leading-snug hover:underline"
                      >
                        {article.title}
                      </a>
                    ) : (
                      <h3 className="text-sol-base01 font-semibold text-lg leading-snug">
                        {article.title}
                      </h3>
                    )
                    return (
                      <div
                        key={index}
                        className="w-full max-w-xl bg-sol-base3 rounded-xl border border-sol-base2 shadow-sm px-5 py-4"
                      >
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {article.category && (
                            <span className="inline-block rounded-full bg-sol-base2 text-sol-base01 text-xs px-2 py-0.5">
                              {article.category}
                            </span>
                          )}
                          {article.account && (
                            <span className="inline-block text-sol-base1 text-[11px] px-1.5 py-0.5">
                              {ACCOUNT_LABELS[article.account] ?? article.account}
                            </span>
                          )}
                        </div>
                        <div className="mb-2">{titleNode}</div>
                        {article.snippet && (
                          <p className="text-sol-base00 whitespace-pre-wrap text-sm leading-relaxed">
                            {article.snippet}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
