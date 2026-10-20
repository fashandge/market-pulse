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
  isNew?: boolean // set client-side: first seen within the last 24 hours
}

interface EventsResponse {
  today: string
  updated: string | null
  categories: Category[]
  events: CatalystEvent[]
}

const NEAR_TERM_DAYS = 14
const DAY_MS = 86_400_000
const NEW_WITHIN_MS = DAY_MS

// Each category gets its own Solarized accent so the three main groups read apart at a glance.
const CATEGORY_STYLE: Record<Category, { label: string; accent: string; swatch: string; tint: string }> = {
  macro: { label: 'Macro', accent: 'border-l-sol-blue', swatch: 'bg-sol-blue', tint: 'bg-sol-blue/10' },
  special: { label: 'Special events', accent: 'border-l-sol-magenta', swatch: 'bg-sol-magenta', tint: 'bg-sol-magenta/10' },
  earnings: { label: 'Earnings', accent: 'border-l-sol-green', swatch: 'bg-sol-green', tint: 'bg-sol-green/15' },
}

// Mon–Fri get full columns; Sat and Sun share one narrow column, since markets are shut.
const WEEK_COLUMNS = 'grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,0.62fr)] gap-1'

// Calendar days are UTC-midnight milliseconds, so a DST change never shifts a cell.
function dayMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function formatDay(ms: number, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', ...options })
}

function mondayOf(ms: number): number {
  return ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS
}

// first_seen is LA wall-clock time; reading both it and LA "now" as if UTC compares them with no zone math.
function laNowMs(): number {
  return Date.parse(new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }).replace(' ', 'T') + 'Z')
}

function isNewEvent(e: CatalystEvent, nowMs: number): boolean {
  return e.first_seen !== '' && nowMs - Date.parse(e.first_seen.replace(' ', 'T') + ':00Z') <= NEW_WITHIN_MS
}

function relativeDay(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

type CalendarRow =
  | { kind: 'week'; monday: number; nearTerm: boolean }
  | { kind: 'quiet'; from: number; to: number }

// Every week overlapping the next 14 days, then only weeks holding an event;
// each run of eventless weeks after that collapses into one "quiet" row.
function calendarRows(today: number, eventDays: Set<number>, lastEventDay: number): CalendarRow[] {
  const horizon = today + NEAR_TERM_DAYS * DAY_MS
  const rows: CalendarRow[] = []
  let quietFrom: number | null = null
  for (let monday = mondayOf(today); monday <= lastEventDay; monday += 7 * DAY_MS) {
    const nearTerm = monday < horizon
    const busy = [0, 1, 2, 3, 4, 5, 6].some((i) => eventDays.has(monday + i * DAY_MS))
    if (!nearTerm && !busy) {
      quietFrom ??= monday
      continue
    }
    if (quietFrom !== null) {
      rows.push({ kind: 'quiet', from: quietFrom, to: monday - DAY_MS })
      quietFrom = null
    }
    rows.push({ kind: 'week', monday, nearTerm })
  }
  return rows
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 align-[1px] text-[10px] font-semibold uppercase tracking-wide text-sol-base3 ${tone}`}>
      {label}
    </span>
  )
}

const CriticalBadge = () => <Badge label="Critical" tone="bg-sol-red" />
const NewBadge = () => <Badge label="New" tone="bg-sol-yellow" />

// Events added to the calendar in the last 24 hours, so a fresh one can't hide among the many already there.
function NewStrip({ events }: { events: CatalystEvent[] }) {
  return (
    <div className="rounded-xl border border-sol-yellow/40 bg-sol-yellow/10 px-5 py-4">
      <h2 className="text-[0.8rem] font-bold uppercase tracking-[0.12em] text-sol-amber">
        New on the calendar · last 24 hours
      </h2>
      <ul className="mt-1.5 gap-x-8 text-sm md:columns-2">
        {events.map((e) => (
          <li key={`${e.date}-${e.catalyst}`} className="break-inside-avoid py-0.5 text-sol-base02">
            <span className="font-medium">{formatDay(dayMs(e.date))}</span>
            <span className="mx-2 text-sol-base00">—</span>
            <span className="font-semibold">{e.catalyst}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The few market-moving events, listed above the calendar so they can't be missed.
function CriticalStrip({ events }: { events: CatalystEvent[] }) {
  return (
    <div className="rounded-xl border border-sol-red/30 bg-sol-red/5 px-5 py-4">
      <h2 className="text-[0.8rem] font-bold uppercase tracking-[0.12em] text-sol-down">Critical ahead</h2>
      <ul className="mt-1.5 flex flex-col gap-1 text-sm">
        {events.map((e) => (
          <li key={`${e.date}-${e.catalyst}`} className="text-sol-base02">
            <span className="font-medium">{formatDay(dayMs(e.date))}</span>
            <span className="text-sol-base00"> · {[e.time, relativeDay(e.days_away)].filter(Boolean).join(' · ')}</span>
            <span className="mx-2 text-sol-base00">—</span>
            <span className="font-semibold">{e.catalyst}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface Tip {
  event: CatalystEvent
  anchor: DOMRect
}

// "Why it matters" for the hovered (or keyboard-focused) event, fixed to the viewport so the
// calendar's horizontal-scroll wrapper can't clip it; flips above the chip near the bottom edge.
function EventTooltip({ tip }: { tip: Tip }) {
  const { event: e, anchor } = tip
  const width = Math.min(360, window.innerWidth - 16)
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
  const above = anchor.bottom > window.innerHeight * 0.6
  const position = above ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }
  return (
    <div
      role="tooltip"
      style={{ left, width, ...position }}
      className={`fixed z-50 pointer-events-none rounded-lg border ${e.isNew ? 'border-sol-yellow' : 'border-[var(--line-strong)]'} border-l-4 ${
        e.critical ? 'border-l-sol-red' : CATEGORY_STYLE[e.category].accent
      } bg-sol-base3 px-3.5 py-2.5 text-sm shadow-[0_8px_24px_-6px_rgba(7,54,66,0.22)]`}
    >
      <div className="font-bold text-sol-base02">
        {e.critical && <CriticalBadge />}
        {e.isNew && <NewBadge />}
        {e.catalyst}
      </div>
      <div className="text-xs text-sol-base00">
        {[formatDay(dayMs(e.date)), e.time, relativeDay(e.days_away), CATEGORY_STYLE[e.category].label].filter(Boolean).join(' · ')}
      </div>
      <p className="mt-1.5 text-sol-base01">{e.why_it_matters}</p>
      {e.first_seen && (
        <div className={`mt-1 text-xs ${e.isNew ? 'font-bold text-sol-amber' : 'text-sol-base00'}`}>
          first seen {formatDay(dayMs(e.first_seen.slice(0, 10)))}, {e.first_seen.slice(11)}
        </div>
      )}
    </div>
  )
}

interface DayProps {
  day: number
  today: number
  events: CatalystEvent[]
  showMonth: boolean
  onTip: (tip: Tip | null) => void
}

function EventChip({ event: e, onTip }: { event: CatalystEvent; onTip: DayProps['onTip'] }) {
  const show = (el: HTMLElement) => onTip({ event: e, anchor: el.getBoundingClientRect() })
  const style = CATEGORY_STYLE[e.category]
  // A new event's solid yellow ring wins over the critical and hover rings.
  const ring = e.isNew
    ? 'ring-2 ring-sol-yellow'
    : e.critical ? 'ring-1 ring-sol-red/35' : 'hover:ring-1 hover:ring-[var(--line-strong)]'
  return (
    <button
      type="button"
      onMouseEnter={(ev) => show(ev.currentTarget)}
      onMouseLeave={() => onTip(null)}
      onFocus={(ev) => show(ev.currentTarget)}
      onBlur={() => onTip(null)}
      className={`mt-1 block w-full rounded-[5px] border-l-[3px] px-2 py-1 text-left text-sol-base02 ${
        e.critical ? 'border-l-sol-red bg-sol-red/10' : `${style.accent} ${style.tint}`
      } ${ring}`}
    >
      {e.time && <span className="block text-[0.68rem] text-sol-base00">{e.time}</span>}
      <span className="line-clamp-3 text-[0.8rem] font-bold leading-snug">
        {e.critical && <CriticalBadge />}
        {e.isNew && <NewBadge />}
        {e.catalyst}
      </span>
    </button>
  )
}

function DayCell({ day, today, events, showMonth, onTip, weekend = false, tall = false }: DayProps & { weekend?: boolean; tall?: boolean }) {
  const daysAway = (day - today) / DAY_MS
  const tone = events.length ? 'bg-sol-card' : weekend ? 'bg-sol-base2/55' : 'bg-sol-card/45'
  const frame = day === today ? 'border-2 border-sol-blue' : 'border border-[var(--line)]'
  const padding = weekend && !events.length ? 'px-2 py-0.5' : 'px-2 pt-1.5 pb-2'
  return (
    <div className={`min-w-0 rounded-lg ${tone} ${frame} ${padding} ${weekend ? 'flex-[1_0_auto]' : ''} ${tall && !weekend ? 'min-h-[3.6rem]' : ''} ${day < today ? 'opacity-45' : ''}`}>
      <div className="flex items-baseline gap-1.5 text-xs text-sol-base00">
        <span className={`font-bold ${weekend && !events.length ? 'text-[0.8rem]' : 'text-[0.95rem]'} ${day === today ? 'text-sol-link' : events.length ? 'text-sol-base02' : 'text-sol-base01'}`}>
          {formatDay(day, { day: 'numeric' })}
        </span>
        {(showMonth || formatDay(day, { day: 'numeric' }) === '1') && (
          <span className="text-[0.68rem] font-bold uppercase tracking-wide">{formatDay(day, { month: 'short' })}</span>
        )}
        {events.length > 0 && daysAway >= 0 && (
          <span className={`ml-auto text-[0.68rem] ${daysAway <= 1 ? 'font-bold text-sol-down' : ''}`}>
            {daysAway <= 1 ? relativeDay(daysAway) : `in ${daysAway}d`}
          </span>
        )}
      </div>
      {events.map((e) => (
        <EventChip key={e.catalyst} event={e} onTip={onTip} />
      ))}
    </div>
  )
}

function WeekRow({ monday, nearTerm, today, byDay, onTip }: {
  monday: number
  nearTerm: boolean
  today: number
  byDay: Map<number, CatalystEvent[]>
  onTip: DayProps['onTip']
}) {
  const cell = (i: number, weekend = false) => {
    const day = monday + i * DAY_MS
    return (
      <DayCell key={i} day={day} today={today} events={byDay.get(day) ?? []} showMonth={i === 0} onTip={onTip} weekend={weekend} tall={nearTerm} />
    )
  }
  return (
    <div className={WEEK_COLUMNS}>
      {[0, 1, 2, 3, 4].map((i) => cell(i))}
      <div className="flex min-w-0 flex-col gap-1">
        {cell(5, true)}
        {cell(6, true)}
      </div>
    </div>
  )
}

// A run of eventless weeks drawn as a torn strip: the calendar's axis break.
const TORN_EDGE = [
  'linear-gradient(135deg, var(--color-sol-base3) 25%, transparent 25%) -6px 0 / 12px 12px repeat-x',
  'linear-gradient(225deg, var(--color-sol-base3) 25%, transparent 25%) -6px 0 / 12px 12px repeat-x',
  'linear-gradient(315deg, var(--color-sol-base3) 25%, transparent 25%) 0 100% / 12px 12px repeat-x',
  'linear-gradient(45deg, var(--color-sol-base3) 25%, transparent 25%) 0 100% / 12px 12px repeat-x',
  'var(--color-sol-base2)',
].join(', ')

function QuietWeeks({ from, to }: { from: number; to: number }) {
  const weeks = Math.round((to - from + DAY_MS) / (7 * DAY_MS))
  const span = `${formatDay(from, { month: 'short', day: 'numeric' })} – ${formatDay(to, { month: 'short', day: 'numeric' })}`
  return (
    <div className="my-1.5 flex h-9 items-center justify-center text-xs text-sol-base00" style={{ background: TORN_EDGE }}>
      <span className="rounded-full border border-[var(--line-strong)] bg-sol-base3 px-3 py-0.5">
        {span} · {weeks} quiet week{weeks > 1 ? 's' : ''} skipped
      </span>
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-2.5 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.1em] text-sol-base00">
      <span className="flex-1 border-t-[1.5px] border-dashed border-[var(--line-strong)]" />
      {label}
      <span className="flex-1 border-t-[1.5px] border-dashed border-[var(--line-strong)]" />
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sol-base00">
      {Object.values(CATEGORY_STYLE).map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <i className={`inline-block h-2.5 w-2.5 rounded-sm ${s.swatch}`} />
          {s.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-sm bg-sol-red" />
        Critical
      </span>
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-sm ring-2 ring-sol-yellow" />
        New (first seen in the last 24 hours)
      </span>
      <span>· Hover an event for why it matters</span>
    </div>
  )
}

// Upcoming market catalysts from the news project's catalyst calendar, as a week grid:
// every day of the next two weeks, then only the weeks that hold an event.
export function EventsView() {
  const [data, setData] = useState<EventsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    fetch('/api/market/events')
      .then((res) => res.json())
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  // The tooltip is anchored to a viewport rect, so drop it rather than let it drift on scroll.
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [tip])

  if (error) {
    return <StatusMessage kind="error">Error: {error}</StatusMessage>
  }
  if (!data) {
    return <StatusMessage kind="loading" />
  }
  if (data.events.length === 0) {
    return <StatusMessage kind="empty">No upcoming events in the catalyst calendar.</StatusMessage>
  }

  const today = dayMs(data.today)
  const nowMs = laNowMs()
  const events = data.events.map((e) => ({ ...e, isNew: isNewEvent(e, nowMs) }))
  const byDay = new Map<number, CatalystEvent[]>()
  for (const e of events) {
    const day = dayMs(e.date)
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  const rows = calendarRows(today, new Set(byDay.keys()), dayMs(events[events.length - 1].date))
  const firstLaterRow = rows.findIndex((r) => r.kind === 'quiet' || !r.nearTerm)
  const critical = events.filter((e) => e.critical)
  const fresh = events.filter((e) => e.isNew)

  return (
    <div className="flex flex-col gap-6">
      {data.updated && <p className="text-xs text-sol-base00 -mb-2">Calendar updated {data.updated}</p>}
      {critical.length > 0 && <CriticalStrip events={critical} />}
      {fresh.length > 0 && <NewStrip events={fresh} />}
      <div className="flex flex-col gap-3">
        <Legend />
        <div className="overflow-x-auto">
          <div className="flex min-w-[820px] flex-col gap-1">
            <div className={`${WEEK_COLUMNS} px-1 text-xs font-bold uppercase tracking-[0.08em] text-sol-base00`}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat / Sun'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            {rows.map((row, i) => (
              <div key={row.kind === 'week' ? row.monday : `quiet-${row.from}`}>
                {i === firstLaterRow && <Divider label="Later · quiet weeks skipped" />}
                {row.kind === 'week' ? (
                  <WeekRow monday={row.monday} nearTerm={row.nearTerm} today={today} byDay={byDay} onTip={setTip} />
                ) : (
                  <QuietWeeks from={row.from} to={row.to} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {tip && <EventTooltip tip={tip} />}
    </div>
  )
}
