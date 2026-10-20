import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface Proposal {
  n: number
  label: string
  note_label: string | null  // the vault note section the skill logs it under
  note_url: string | null    // that section in the notes-search web UI
}

export interface LogJob {
  job_id: string
  run_id: string
  only: number[]
  started: string
  state: 'running' | 'done' | 'failed' | 'lost'
  output: string
  error: string
}

const POLL_MS = 5000

const formatTime = (iso: string) => iso.slice(11, 16)

// One link per note section the job's proposals were logged under.
const noteLinks = (proposals: Proposal[], only: number[]) => {
  const links = new Map<string, string>()
  for (const p of proposals) {
    if (only.includes(p.n) && p.note_url && p.note_label) links.set(p.note_url, p.note_label)
  }
  return [...links].map(([url, label]) => ({ url, label }))
}

// A signal-digest run's proposed log entries with a checkbox each (all checked
// by default) and a button that applies the checked ones through
// stock_picker's /portfolio-brief skill in a headless `claude -p` session.
// While that job runs the panel polls its status; the agent's final reply is
// shown when it finishes.
export function ProposedLog({ runId, proposals, initialJob }: {
  runId: string
  proposals: Proposal[]
  initialJob: LogJob | null
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(proposals.map((p) => p.n)))
  const [job, setJob] = useState<LogJob | null>(initialJob)
  const [submitting, setSubmitting] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const endpoint = `/api/market/signal-digests/${encodeURIComponent(runId)}/log-proposals`
  const running = job?.state === 'running'
  // A running job's checkboxes show what it was started with.
  const checked = running ? new Set(job.only) : selected
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      setNow(Date.now())
      fetch(endpoint)
        .then((res) => res.json())
        .then((status: LogJob | null) => status && setJob(status))
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, endpoint])

  const toggle = (n: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  const submit = () => {
    setSubmitting(true)
    setRequestError(null)
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ only: [...selected].sort((a, b) => a - b) }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`)
        setJob(body as LogJob)
      })
      .catch((err) => setRequestError(err.message))
      .finally(() => setSubmitting(false))
  }

  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] bg-sol-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-sol-base02">Proposed log</h2>
        <button
          onClick={submit}
          disabled={selected.size === 0 || running || submitting}
          className="px-3 py-1 rounded-full border border-[var(--line-strong)] font-bold text-[0.8rem] text-sol-link hover:bg-sol-blue/10 transition-colors disabled:opacity-40 disabled:cursor-default cursor-pointer"
        >
          {running ? 'Logging…' : `Log ${selected.size} selected with /portfolio-brief`}
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {proposals.map((p) => (
          <li key={p.n}>
            <label className="flex items-start gap-2 cursor-pointer text-sol-base01">
              <input
                type="checkbox"
                checked={checked.has(p.n)}
                onChange={() => toggle(p.n)}
                disabled={running}
                className="mt-1 shrink-0 accent-[var(--color-sol-blue)]"
              />
              <span>
                <span className="tabular-nums text-sol-base00">{p.n}.</span> {p.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {requestError && <p className="mt-2 text-sm text-sol-down">Could not start: {requestError}</p>}
      {job && (
        <div className="mt-3 border-t border-[var(--line)] pt-2 text-sm">
          <p className={job.state === 'done' ? 'text-sol-up' : job.state === 'running' ? 'text-sol-base00' : 'text-sol-down'}>
            {job.state === 'running' && <span className="mp-spinner inline-block align-middle mr-2" />}
            {{
              running: 'Running',
              done: 'Logged',
              failed: 'Failed',
              lost: 'Stopped without a result',
            }[job.state]}{' '}
            — proposals {job.only.join(', ')}, started {formatTime(job.started)}
            {running && `, ${Math.max(0, Math.floor((now - Date.parse(job.started)) / 60000))} min so far`}
          </p>
          {job.output && (
            <div className="mt-1 prose prose-sm summary-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.output}</ReactMarkdown>
            </div>
          )}
          {job.state === 'done' && noteLinks(proposals, job.only).length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-sol-base00">Open in notes:</span>
              {noteLinks(proposals, job.only).map(({ url, label }) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-sol-link hover:underline">
                  {label} ↗
                </a>
              ))}
            </p>
          )}
          {job.error && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-sol-base01">{job.error}</pre>
          )}
        </div>
      )}
    </section>
  )
}
