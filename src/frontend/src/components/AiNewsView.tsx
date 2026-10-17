import { useState, useEffect } from 'react'
import { StatusMessage } from './StatusMessage'
import { Chevron } from './Chevron'

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
      <StatusMessage kind="loading" />
    )
  }

  if (error) {
    return (
      <StatusMessage kind="error">Error: {error}</StatusMessage>
    )
  }

  if (!data || data.briefs.length === 0) {
    return (
      <StatusMessage kind="empty">No AI news briefs available yet.</StatusMessage>
    )
  }

  return (
    <div className="max-w-3xl">
      {!data.today_available && (
        <div className="mp-notice mb-6">
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
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg font-bold text-sol-base02 hover:bg-sol-base2/60 transition-colors cursor-pointer"
              >
                <Chevron open={isOpen} />
                <span>{formatDateHeading(brief.date)}</span>
                <span className="text-[0.75rem] font-bold text-sol-base01 bg-sol-base2 rounded-full px-2 py-0.5">
                  {brief.articles.length}
                </span>
              </button>

              {isOpen && (
                <div className="flex flex-col gap-3 mt-2 mb-6">
                  {brief.articles.map((article, index) => {
                    const titleNode = article.url ? (
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-lg leading-snug text-sol-base02 hover:text-sol-link hover:underline underline-offset-4 decoration-1"
                      >
                        {article.title}
                      </a>
                    ) : (
                      <h3 className="font-bold text-lg leading-snug">
                        {article.title}
                      </h3>
                    )
                    return (
                      <div
                        key={index}
                        lang="zh-CN"
                        className="reading-text mp-card px-6 py-5"
                      >
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {article.category && (
                            <span className="inline-block rounded-full bg-sol-cyan/10 text-[#1d6f69] text-xs font-bold px-2.5 py-0.5 tracking-wide">
                              {article.category.replace(/_/g, ' ')}
                            </span>
                          )}
                          {article.account && (
                            <span className="inline-block text-sol-base00 text-xs px-1 py-0.5">
                              {ACCOUNT_LABELS[article.account] ?? article.account}
                            </span>
                          )}
                        </div>
                        <div className="mb-2">{titleNode}</div>
                        {article.snippet && (
                          <p className="whitespace-pre-wrap">
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
