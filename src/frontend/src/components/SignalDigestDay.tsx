import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Chevron } from './Chevron'
import { ProposedLog, type LogJob, type Proposal } from './ProposedLog'

export interface SignalDigestRun {
  run_id: string
  time: string
  verdict: string
  content: string
  proposals?: Proposal[]  // from proposed_log.json; replaces the report's "Proposed log" list
  log_job?: LogJob | null
}

// One day's signal-digest runs (newest first) inside the day's fold: each run
// folds on its own, only the latest starts open, and a toolbar folds or
// unfolds every run of the day at once.
export function SignalDigestDay({ runs }: { runs: SignalDigestRun[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(runs.slice(0, 1).map((r) => r.run_id)))
  const allOpen = runs.every((r) => open.has(r.run_id))
  const noneOpen = runs.every((r) => !open.has(r.run_id))

  const setRun = (id: string, isOpen: boolean) =>
    setOpen((prev) => {
      if (prev.has(id) === isOpen) return prev
      const next = new Set(prev)
      if (isOpen) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="flex flex-col gap-2">
      {runs.length > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            onClick={() => setOpen(new Set(runs.map((r) => r.run_id)))}
            disabled={allOpen}
            className="px-3 py-1 rounded-full border border-[var(--line-strong)] font-bold text-[0.8rem] text-sol-base01 hover:bg-sol-base2/60 hover:text-sol-base02 transition-colors disabled:opacity-40 disabled:cursor-default cursor-pointer"
          >
            Unfold all runs
          </button>
          <button
            onClick={() => setOpen(new Set())}
            disabled={noneOpen}
            className="px-3 py-1 rounded-full border border-[var(--line-strong)] font-bold text-[0.8rem] text-sol-base01 hover:bg-sol-base2/60 hover:text-sol-base02 transition-colors disabled:opacity-40 disabled:cursor-default cursor-pointer"
          >
            Fold all runs
          </button>
        </div>
      )}
      {runs.map((run, i) => {
        const isOpen = open.has(run.run_id)
        return (
          <details
            key={run.run_id}
            open={isOpen}
            onToggle={(e) => setRun(run.run_id, e.currentTarget.open)}
            className="border-l-[3px] border-sol-base2 open:border-sol-blue/60 rounded-r-lg"
          >
            <summary className="flex gap-3 items-center px-3 py-2 cursor-pointer select-none rounded-r-lg hover:bg-sol-base2/50 list-none [&::-webkit-details-marker]:hidden">
              <Chevron open={isOpen} />
              <span className="font-semibold text-sol-base02 tabular-nums shrink-0">{run.time}</span>
              {i === 0 && (
                <span className="text-[0.7rem] font-bold uppercase tracking-wider text-sol-link bg-sol-blue/10 rounded-full px-2 py-0.5 shrink-0">latest</span>
              )}
              {!isOpen && run.verdict && (
                <span className="text-sol-base01 truncate min-w-0">{run.verdict}</span>
              )}
            </summary>
            <div className="px-3 pt-1 pb-3">
              <div className="prose prose-base summary-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.content}</ReactMarkdown>
              </div>
              {run.proposals && run.proposals.length > 0 && (
                <ProposedLog runId={run.run_id} proposals={run.proposals} initialJob={run.log_job ?? null} />
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
