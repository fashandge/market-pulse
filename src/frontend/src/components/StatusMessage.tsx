import type { ReactNode } from 'react'

type Kind = 'loading' | 'empty' | 'error'

// Centered placeholder for a view that has nothing to render yet.
export function StatusMessage({ kind, children }: { kind: Kind; children?: ReactNode }) {
  return (
    <div className="mp-state" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' && <span className="mp-spinner" aria-hidden />}
      <span>{children ?? (kind === 'loading' ? 'Loading…' : null)}</span>
    </div>
  )
}
