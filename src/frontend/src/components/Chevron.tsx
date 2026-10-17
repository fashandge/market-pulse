// Disclosure chevron; rotates when `open` (or inside an open .mp-fold).
export function Chevron({ open }: { open?: boolean }) {
  return (
    <svg className="mp-chevron" data-open={open} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
