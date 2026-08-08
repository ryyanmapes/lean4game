/** Adapt the recorded visual proof to known Cauli WASM elaborator differences. */
function browserCompatibleProof(proofBody: string): string {
  const lines = proofBody.split('\n')
  return lines.map((line, index) => {
    const tautoMatch = line.match(/^(\s*)tauto\s*$/u)
    if (tautoMatch) {
      if (lines[index - 1]?.trim() === 'have h2 := mul_ne_zero a b') {
        // `simp_all` alone does not split the two decidable equality cases in
        // mul_eq_zero. Make those cases explicit, then let the core simplifier
        // discharge the same propositional argument. This remains transient
        // compiler input: the player's authored action is still shown as
        // `tauto`, and Lean kernel-checks the resulting proof.
        return `${tautoMatch[1]}by_cases ha : a = 0 <;> by_cases hb : b = 0 <;> simp_all`
      }
      // The compact browser `tauto` elaborator reaches an unsupported dynamic
      // evaluator path in the purpose-linked WASM runtime. Its final proof
      // step is Lean's own propositional simplifier; NNG's four authored uses
      // are all discharged by that kernel-checked step directly.
      return `${tautoMatch[1]}simp_all`
    }
    const hypRewrite = line.match(
      /^(\s*)drag_rw_hyp_(lhs|rhs)(_at)?\s+([^\s]+)\s+\[(←\s*)?([^\]]+)\](?: \[([\d,\s]+)\])?\s*$/u,
    )
    if (hypRewrite) {
      const [, indentation, side, atSuffix = '', hypothesis, reverse = '', theorem, rawPath = ''] = hypRewrite
      const path = rawPath.split(',').map(step => step.trim()).filter(Boolean)
      if ((atSuffix.length > 0) !== (path.length > 0)) return line

      // Keep the player's explicitly chosen direction. The visual tactic's
      // historical direction fallback could turn `zero_add` backwards and
      // insert an extra `0 +` when the selected occurrence was nested.
      const normalizedTheorem = theorem.trim()
      const navigation = path.map(step => `; arg ${step}`).join('')
      return `${indentation}conv at ${hypothesis} => ${side}${navigation}; rw [${reverse}${normalizedTheorem}]`
    }
    const goalRewrite = line.match(
      /^(\s*)drag_rw_(lhs|rhs)(_at)? \[(←\s*)?([^\]]+)\](?: \[([\d,\s]+)\])?\s*$/u,
    )
    if (goalRewrite) {
      const [, indentation, side, atSuffix = '', reverse = '', theorem, rawPath = ''] = goalRewrite
      const path = rawPath.split(',').map(step => step.trim()).filter(Boolean)
      if ((atSuffix.length > 0) !== (path.length > 0)) return line

      // The purpose-linked Cauli matcher is unreliable for overloaded terms
      // and some reverse rewrites. Compile the same explicitly selected
      // side/path through Lean's core conv/rw machinery. The player's authored
      // drag_rw command remains unchanged in both proof logs.
      const normalizedTheorem = theorem.trim()
      const navigation = path.map(step => `; arg ${step}`).join('')
      return `${indentation}conv => ${side}${navigation}; rw [${reverse}${normalizedTheorem}]`
    }
    return line
  }).join('\n')
}

/**
 * Lean requires every `case ... =>` block to close its focused goals before
 * control returns to the surrounding tactic sequence. During interactive play
 * those goals are intentionally still open. Probe and temporarily admit them
 * at the end of their own case scope so elaboration can continue and report the
 * new, formally checked state. These lines exist only in the transient compiler
 * input; they are never added to the player's recorded proof.
 */
export function instrumentBrowserProof(proofBody: string): string {
  const lines = browserCompatibleProof(proofBody).split('\n')
  const output: string[] = []
  const caseIndents: number[] = []

  const closeCase = (caseIndent: number) => {
    const bodyIndent = ' '.repeat(caseIndent + 2)
    output.push(`${bodyIndent}all_goals browser_report_state`)
    output.push(`${bodyIndent}all_goals sorry`)
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length
    if (trimmed.length > 0) {
      while (caseIndents.length > 0 && indent <= caseIndents[caseIndents.length - 1]!) {
        closeCase(caseIndents.pop()!)
      }
    }
    output.push(line)
    if (/^case\s+.+\s+=>$/u.test(trimmed)) caseIndents.push(indent)
  }

  while (caseIndents.length > 0) closeCase(caseIndents.pop()!)
  return output.join('\n')
}
