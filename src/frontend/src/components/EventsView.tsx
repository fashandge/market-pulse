import { useEffect, useState } from 'react'
import { StatusMessage } from './StatusMessage'

type Category = 'macro' | 'special' | 'earnings'

interface CatalystEvent {
  category: Category
  date: string // YYYY-MM-DD
  time: string // optional, e.g. "08:30 ET"
  days_away: number
  critical: boolean // could move the whole market (SPY/QQQ) given the current backdrop
  catalyst: string
  why_it_matters: string
  first_seen: string // "YYYY-MM-DD HH:MM"
}

interface EventsResponse {
  today: string
  updated: string | null
  categories: Category[]
  events: CatalystEvent[]
}

const NEAR_TERM_DAYS = 14

// Each category gets its own Solarized accent so the three main groups read apart at a glance.
const CATEGORY_STYLE: Record<Category, { label: string; accent: string; text: string; tint: string }> = {
  macro: { label: 'Macro', accent: 'border-l-sol-blue', text: 'text-sol-link', tint: 'bg-sol-blue/10' },
  special: { label: 'Special events', accent: 'border-l-sol-magenta', text: 'text-sol-plum', tint: 'bg-sol-magenta/10' },
  earnings: { label: 'Earnings', accent: 'border-l-sol-green', text: 'text-sol-up', tint: 'bg-sol-green/10' },
}

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function relativeDay(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function CriticalBadge() {
  return (
    <span className="ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide bg-sol-red text-sol-base3">
      Critical
    </span>
  )
}

// The few market-moving events, listed above the groups so they can't be missed.
function CriticalStrip({ events }: { events: CatalystEvent[] }) {
  return (
    <div className="rounded-xl border border-sol-red/30 bg-sol-red/5 px-5 py-4">
      <h2 className="text-[0.8rem] font-bold uppercase tracking-[0.12em] text-sol-down">Critical ahead</h2>
      <ul className="mt-1.5 flex flex-col gap-1 text-sm">
        {events.map((e) => (
          <li key={`${e.date}-${e.catalyst}`} className="text-sol-base02">
            <span className="font-medium">{formatDay(e.date)}</span>
            <span className="text-sol-base00"> · {[e.time, relativeDay(e.days_away)].filter(Boolean).join(' · ')}</span>
            <span className="mx-2 text-sol-base00">—</span>
            <span className="font-semibold">{e.catalyst}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CategoryGroup({ category, events }: { category: Category; events: CatalystEvent[] }) {
  const style = CATEGORY_STYLE[category]
  return (
    <section className={`mp-card border-l-4 ${style.accent} overflow-hidden`}>
      <h3 className={`px-4 py-2 ${style.tint} ${style.text} text-[0.8rem] font-bold uppercase tracking-[0.12em]`}>
        {style.label}
        <span className="ml-2 font-normal normal-case tracking-normal text-sol-base00">{events.length}</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-36" />
            <col className="w-[40%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="text-left text-sol-base01 border-b border-[var(--line-strong)]">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Catalyst</th>
              <th className="px-4 py-2 font-medium">Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr
                key={`${e.date}-${e.catalyst}`}
                className={`border-b border-[var(--line)] last:border-0 align-top ${e.critical ? 'bg-sol-red/5' : ''}`}
              >
                <td className={`px-4 py-2.5 whitespace-nowrap ${e.critical ? 'shadow-[inset_3px_0_0_var(--color-sol-red)]' : ''}`}>
                  <div className={`font-medium ${e.days_away <= 1 ? 'text-sol-down' : 'text-sol-base02'}`}>
                    {formatDay(e.date)}
                  </div>
                  <div className="text-xs text-sol-base00">
                    {[e.time, relativeDay(e.days_away)].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-sol-base02">
                  <span className={e.critical ? 'font-semibold' : ''}>{e.catalyst}</span>
                  {e.critical && <CriticalBadge />}
                  {e.first_seen && (
                    <div className="text-xs text-sol-base00">first seen {formatDay(e.first_seen.slice(0, 10))}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-sol-base00">{e.why_it_matters}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EventsBlock({ title, events, categories }: { title: string; events: CatalystEvent[]; categories: Category[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-sol-base02">{title}</h2>
      {events.length === 0 ? (
        <p className="text-sol-base00">No events.</p>
      ) : (
        categories.map((c) => {
          const group = events.filter((e) => e.category === c)
          return group.length ? <CategoryGroup key={c} category={c} events={group} /> : null
        })
      )}
    </div>
  )
}

// Upcoming market catalysts from the news project's catalyst calendar: the next
// two weeks first, grouped macro → special events → earnings, then later events.
export function EventsView() {
  const [data, setData] = useState<EventsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/market/events')
      .then((res) => res.json())
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  if (error) {
    return <StatusMessage kind="error">Error: {error}</StatusMessage>
  }
  if (!data) {
    return <StatusMessage kind="loading" />
  }
  if (data.events.length === 0) {
    return <StatusMessage kind="empty">No upcoming events in the catalyst calendar.</StatusMessage>
  }

  const near = data.events.filter((e) => e.days_away < NEAR_TERM_DAYS)
  const later = data.events.filter((e) => e.days_away >= NEAR_TERM_DAYS)
  const critical = data.events.filter((e) => e.critical)

  return (
    <div className="flex flex-col gap-8">
      {data.updated && <p className="text-xs text-sol-base00 -mb-4">Calendar updated {data.updated}</p>}
      {critical.length > 0 && <CriticalStrip events={critical} />}
      <EventsBlock title="Next 14 days" events={near} categories={data.categories} />
      {later.length > 0 && <EventsBlock title="Later" events={later} categories={data.categories} />}
    </div>
  )
}
