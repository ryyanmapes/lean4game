import * as React from 'react'

/**
 * Keep a card label and formula readable at narrow widths. If the browser has
 * to wrap immediately before or after the colon, commit to the cleaner two-line
 * layout and omit the orphaned punctuation.
 */
export function StatementCardLine({
  name,
  proposition,
}: {
  name: React.ReactNode
  proposition: React.ReactNode
}) {
  const lineRef = React.useRef<HTMLDivElement>(null)
  const [colonLineBreak, setColonLineBreak] = React.useState(false)

  React.useLayoutEffect(() => {
    const line = lineRef.current
    if (!line || colonLineBreak) return

    const detectBreak = () => {
      const nameEl = line.querySelector<HTMLElement>('.hyp-name')
      const colonEl = line.querySelector<HTMLElement>('.hyp-colon')
      const propositionEl = line.querySelector<HTMLElement>('.proposition')
      if (!nameEl || !colonEl || !propositionEl) return
      const nameTop = nameEl.getBoundingClientRect().top
      const colonTop = colonEl.getBoundingClientRect().top
      const propositionTop = propositionEl.getBoundingClientRect().top
      if (Math.abs(colonTop - nameTop) > 2 || Math.abs(propositionTop - nameTop) > 2) {
        setColonLineBreak(true)
      }
    }

    detectBreak()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(detectBreak)
    observer?.observe(line)
    return () => observer?.disconnect()
  }, [colonLineBreak])

  return (
    <div ref={lineRef} className={`statement-card-main${colonLineBreak ? ' colon-line-break' : ''}`}>
      <span className="hyp-name">{name}</span>
      <span className="hyp-colon">:</span>
      <span className="proposition">{proposition}</span>
    </div>
  )
}
