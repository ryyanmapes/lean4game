import * as React from 'react'

interface ProofStep {
  playTactic: string
  leanTactic: string | null
}

interface ProofPanelProps {
  proofSteps: ProofStep[]
  onClose: () => void
}

function simplifyLeanTactic(leanTactic: string | null): string | null {
  if (!leanTactic) return leanTactic
  let simplified = leanTactic.trim()
  while (simplified.startsWith('case ')) {
    const rest = simplified.slice(5)
    const separator = rest.indexOf('=>')
    if (separator === -1) break
    simplified = rest.slice(separator + 2).trim()
  }
  return simplified
}

export function ProofPanel({ proofSteps, onClose }: ProofPanelProps) {
  const leanProof = proofSteps
    .map(s => s.leanTactic ?? `-- ? (${s.playTactic})`)
    .join('\n')

  function handleCopy() {
    navigator.clipboard.writeText(leanProof).catch(() => {})
  }

  return (
    <div className="proof-panel-overlay" onClick={onClose}>
      <div className="proof-panel" onClick={e => e.stopPropagation()}>
        <div className="proof-panel-header">
          <span className="proof-panel-title">Lean Proof</span>
          <button className="proof-panel-copy" onClick={handleCopy} title="Copy Lean proof">
            Copy
          </button>
          <button className="proof-panel-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="proof-panel-body">
          <table className="proof-steps-table">
            <thead>
              <tr>
                <th>Play step</th>
                <th></th>
                <th>Lean tactic</th>
              </tr>
            </thead>
            <tbody>
              {proofSteps.map((step, i) => (
                <tr key={i}>
                  <td className="play-tactic">{step.playTactic}</td>
                  <td className="arrow-cell">→</td>
                  <td className={`lean-tactic${!step.leanTactic ? ' unknown' : ''}`}>
                    {simplifyLeanTactic(step.leanTactic) ?? `? (${step.playTactic})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
