import * as React from 'react'

/** Keep the colon attached to its label if a narrow card wraps the formula. */
export function StatementCardLine({
  name,
  proposition,
}: {
  name: React.ReactNode
  proposition: React.ReactNode
}) {
  return (
    <div className="statement-card-main">
      <span className="statement-card-label">
        <span className="hyp-name">{name}</span>
        <span className="hyp-colon">:</span>
      </span>
      <span className="proposition">{proposition}</span>
    </div>
  )
}
