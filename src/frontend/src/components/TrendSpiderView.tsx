import { useState, useEffect, useCallback } from 'react'

interface TrendSpiderPost {
  text: string
  media: string[]
  t: string
}

interface TrendSpiderResponse {
  posts: TrendSpiderPost[]
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

export function TrendSpiderView() {
  const [posts, setPosts] = useState<TrendSpiderPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/market/trendspider-posts')
      .then((res) => res.json())
      .then((data: TrendSpiderResponse) => {
        setPosts(data.posts)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const closeLightbox = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setLightboxUrl(null)
  }, [])

  useEffect(() => {
    if (lightboxUrl) {
      document.addEventListener('keydown', closeLightbox)
      return () => document.removeEventListener('keydown', closeLightbox)
    }
  }, [lightboxUrl, closeLightbox])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sol-base1">Loading...</div>
  }
  if (error) {
    return <div className="flex items-center justify-center h-64 text-sol-red">Error: {error}</div>
  }
  if (posts.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sol-base1">
        No Trend Spider posts available yet.
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col items-center gap-4">
        {posts.map((post, index) => (
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
                    <a
                      href={urlMatch[1]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sol-base1 text-sm mt-3 block hover:underline"
                    >
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
    </>
  )
}
