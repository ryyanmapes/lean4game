/** Adapt the recorded visual proof to known Cauli WASM elaborator differences. */
function browserCompatibleProof(proofBody: string): string {
  return proofBody.split('\n').map(line => {
    const addZeroMatch = line.match(
      /^(\s*)drag_rw_(lhs|rhs)(?:_at)? \[(←\s*)?MyNat\.add_zero\](?: \[[\d,\s]*\])?\s*$/u,
    )
    if (addZeroMatch) {
      const [, indentation, side, reverse = ''] = addZeroMatch
      // The Cauli snapshot's custom matcher reduces overloaded addition to
      // `MyNat.add`, then mistakenly treats it as unary while following a
      // nested visual path. Core `rw` under the selected equality side keeps
      // this action formally checked and reaches the intended `b + 0`.
      return `${indentation}conv => ${side}; rw [${reverse}MyNat.add_zero]`
    }
    const match = line.match(/^(\s*)drag_rw_(lhs|rhs) \[(.+)\]\s*$/u)
    if (!match) return line
    const [, indentation, , rule] = match
    const trimmedRule = rule.trim()
    if (trimmedRule === 'MyNat.add_succ') {
      // The focused matcher in the Cauli build fails to instantiate the
      // successor branch's exposed free variable. Core rw handles it correctly.
      return `${indentation}rw [MyNat.add_succ]`
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
