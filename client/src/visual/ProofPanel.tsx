import * as React from 'react'

interface ProofStep {
  command: string
  playTactic: string
  leanTactic: string | null
}

interface ProofPanelProps {
  proofSteps: ProofStep[]
  leanProofScript?: string
  onClose: () => void
}

/** Strip all `case X =>` prefixes from a lean tactic string. */
function stripCasePrefixes(tactic: string | null): string | null {
  if (!tactic) return tactic
  let s = tactic.trim()
  while (s.startsWith('case ') || s.startsWith('focus_case ') || s.startsWith("case' ")) {
    const prefixLen = s.startsWith('focus_case ') ? 11 : s.startsWith("case' ") ? 6 : 5
    const inner = s.slice(prefixLen)
    const sep = inner.indexOf('=>')
    if (sep === -1) break
    s = inner.slice(sep + 2).trim()
  }
  return s || null
}

/** Extract case path labels from a case-wrapped command string. */
function getCasePath(command: string): string[] {
  const path: string[] = []
  let rest = command.trim()
  while (rest.startsWith('case ') || rest.startsWith('focus_case ') || rest.startsWith("case' ")) {
    const prefixLen = rest.startsWith('focus_case ') ? 11 : rest.startsWith("case' ") ? 6 : 5
    const inner = rest.slice(prefixLen)
    const sep = inner.indexOf('=>')
    if (sep === -1) break
    const label = inner.slice(0, sep).trim()
    const next = inner.slice(sep + 2).trim()
    if (!label || !next) break
    path.push(label)
    rest = next
  }
  return path
}

/** Return the lean tactic with its case path prepended, e.g. "case succ => rw [add_succ]". */
function leanTacticDisplay(step: ProofStep): string | null {
  const leaf = stripCasePrefixes(step.leanTactic)
  if (!leaf) return null
  const casePath = getCasePath(step.command)
  return casePath.reduceRight((inner, c) => `case ${c} => ${inner}`, leaf)
}

export function ProofPanel({ proofSteps, leanProofScript, onClose }: ProofPanelProps) {
  const leanProof = leanProofScript
    ?? proofSteps.map(s => s.leanTactic ?? `-- ? (${s.playTactic})`).join('\n')

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
              {proofSteps.map((step, i) => {
                const display = leanTacticDisplay(step)
                return (
                  <tr key={i}>
                    <td className="play-tactic">{step.playTactic}</td>
                    <td className="arrow-cell">→</td>
                    <td className={`lean-tactic${!display ? ' unknown' : ''}`}>
                      {display ?? `? (${step.playTactic})`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
