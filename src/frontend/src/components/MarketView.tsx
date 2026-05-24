import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface SummaryResponse {
  date: string
  content: string | null
}

interface TrendSpiderPost {
  text: string
  media: string[]
  t: string
}

interface TrendSpiderResponse {
  posts: TrendSpiderPost[]
}

interface AiNewsArticle {
  title: string
  category: string
  snippet: string
  url?: string
  rank?: number
}

interface AiNewsResponse {
  date: string | null
  is_stale: boolean
  articles: AiNewsArticle[]
}

type SourceTab = 'trading-view' | 'cfzh' | 'x' | 'trendspider' | 'ai-news'

const SOURCE_TABS: SourceTab[] = ['trading-view', 'x', 'cfzh', 'trendspider', 'ai-news']

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
  trendspider: 'Trend Spider',
  'ai-news': 'AI News',
}

export function MarketView() {
  const [activeSource, setActiveSource] = useState<SourceTab>(() => {
    return (sessionStorage.getItem('marketNewsTab') as SourceTab) || 'trading-view'
  })
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [trendSpiderPosts, setTrendSpiderPosts] = useState<TrendSpiderPost[]>([])
  const [aiNews, setAiNews] = useState<AiNewsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const handleSelectSource = (source: SourceTab) => {
    setActiveSource(source)
    sessionStorage.setItem('marketNewsTab', source)
  }

  const closeLightbox = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setLightboxUrl(null)
  }, [])

  useEffect(() => {
    if (lightboxUrl) {
      document.addEventListener('keydown', closeLightbox)
      return () => document.removeEventListener('keydown', closeLightbox)
    }
  }, [lightboxUrl, closeLightbox])

  useEffect(() => {
    setLoading(true)
    setError(null)

    if (activeSource === 'trendspider') {
      fetch('/api/market/trendspider-posts')
        .then((res) => res.json())
        .then((data: TrendSpiderResponse) => {
          setTrendSpiderPosts(data.posts)
          setLoading(false)
        })
        .catch((err) => {
          setError(err.message)
          setLoading(false)
        })
    } else if (activeSource === 'ai-news') {
      fetch('/api/market/ai-news-brief')
        .then((res) => res.json())
        .then((data: AiNewsResponse) => {
          setAiNews(data)
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

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const renderTrendSpiderContent = () => {
    if (trendSpiderPosts.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-sol-base1">
          No Trend Spider posts available yet.
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center gap-4">
        {trendSpiderPosts.map((post, index) => (
          <div
            key={index}
            className="w-full max-w-xl bg-sol-base3 rounded-xl border border-sol-base2 shadow-sm overflow-hidden"
          >
            {post.media.length > 0 && (
              <div className="flex flex-col">
                {post.media.map((url, imgIndex) => (
                  <img
                    key={imgIndex}
                    src={url}
                    alt=""
                    className="w-full object-cover cursor-zoom-in"
                    onClick={() => setLightboxUrl(url)}
                  />
                ))}
              </div>
            )}
            <div className="px-5 py-4">
              <p className="text-sol-base01 whitespace-pre-wrap text-base leading-relaxed">
                {post.text.replace(/\s*https?:\/\/\S+\s*$/, '')}
              </p>
              {(() => {
                const urlMatch = post.text.match(/\s*(https?:\/\/\S+)\s*$/)
                const time = formatTime(post.t)
                if (urlMatch) {
                  return (
                    <a href={urlMatch[1]} target="_blank" rel="noopener noreferrer" className="text-sol-base1 text-sm mt-3 block hover:underline">
                      {time}
                    </a>
                  )
                }
                return <p className="text-sol-base1 text-sm mt-3">{time}</p>
              })()}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderAiNewsContent = () => {
    if (!aiNews || aiNews.articles.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-sol-base1">
          No AI news brief available yet.
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center gap-4">
        {aiNews.is_stale && (
          <div className="w-full max-w-xl rounded-lg border border-sol-yellow/40 bg-sol-yellow/10 px-4 py-3 text-sm text-sol-yellow">
            Today's AI news brief has not been generated yet — showing brief from {aiNews.date}.
          </div>
        )}
        {aiNews.articles.map((article, index) => {
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
            <h3 className="text-sol-base01 font-semibold text-lg leading-snug">{article.title}</h3>
          )
          return (
            <div
              key={index}
              className="w-full max-w-xl bg-sol-base3 rounded-xl border border-sol-base2 shadow-sm px-5 py-4"
            >
              {article.category && (
                <span className="inline-block rounded-full bg-sol-base2 text-sol-base01 text-xs px-2 py-0.5 mb-2">
                  {article.category}
                </span>
              )}
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
    )
  }

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

    if (activeSource === 'trendspider') {
      return renderTrendSpiderContent()
    }

    if (activeSource === 'ai-news') {
      return renderAiNewsContent()
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

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
