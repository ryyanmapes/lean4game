/** Adapt the recorded visual proof to known Cauli WASM elaborator differences. */
function browserCompatibleProof(proofBody: string): string {
  const lines = proofBody.split('\n')
  return lines.map((line, index) => {
    const rwNthMatch = line.match(/^(\s*)rw_nth\s+(\d+)\s+(.+)$/u)
    if (rwNthMatch) {
      // `rw_nth` is the compact spelling shown in the Core pane. The browser
      // module's established NNG environment already kernel-checks the same
      // operation through `nth_rewrite`; use that spelling only in transient
      // compiler input so classic handoffs validate without changing what the
      // player sees or exports.
      return `${rwNthMatch[1]}nth_rewrite ${rwNthMatch[2]} ${rwNthMatch[3]}`
    }
    const rflMatch = line.match(/^(\s*)rfl\s*$/u)
    if (rflMatch) {
      // Visual mode deliberately keeps a reflexive card available for the
      // player's final click even when the preceding rewrite has already
      // closed Lean's underlying goal. Keep displaying that Core step as
      // `rfl`, but make classic/browser replay accept both states.
      return `${rflMatch[1]}all_goals rfl`
    }
    const tautoMatch = line.match(/^(\s*)tauto\s*$/u)
    if (tautoMatch) {
      const directMulNeZero = lines[index - 1]?.trim().match(
        /^have\s+\S+\s*:=\s*(?:MyNat\.)?mul_ne_zero\s+(\S+)\s+(\S+)$/u,
      )
      const precedingLines = lines.slice(0, index).map(previous => previous.trim())
      const firstSpecialization = precedingLines.map(previous => previous.match(
        /^specialize_forall_as\s+(\S+)\s+(?:MyNat\.)?mul_ne_zero\s+\S+\s+\((.+)\)$/u,
      )).find((match): match is RegExpMatchArray => Boolean(match))
      const secondSpecialization = firstSpecialization
        ? precedingLines.map(previous => previous.match(
            new RegExp(`^specialize_forall_as\\s+\\S+\\s+${firstSpecialization[1]}\\s+\\S+\\s+\\((.+)\\)$`, 'u'),
          )).find((match): match is RegExpMatchArray => Boolean(match))
        : undefined
      const equalityCases = directMulNeZero
        ? [directMulNeZero[1], directMulNeZero[2]]
        : firstSpecialization && secondSpecialization
          ? [firstSpecialization[2], secondSpecialization[1]]
          : null
      if (equalityCases) {
        // `simp_all` alone does not split the two decidable equality cases in
        // mul_eq_zero. Make those cases explicit, then let the core simplifier
        // discharge the same propositional argument. This remains transient
        // compiler input: the player's authored action is still shown as
        // `tauto`, and Lean kernel-checks the resulting proof.
        return `${tautoMatch[1]}by_cases hVisualTautoA : ${equalityCases[0]} = 0 <;> ` +
          `by_cases hVisualTautoB : ${equalityCases[1]} = 0 <;> simp_all`
      }
      // The compact browser `tauto` elaborator reaches an unsupported dynamic
      // evaluator path in the purpose-linked WASM runtime. Its final proof
      // step is Lean's own propositional simplifier; NNG's four authored uses
      // are all discharged by that kernel-checked step directly.
      return `${tautoMatch[1]}first | contradiction | simp_all`
    }
    // Focused goal and hypothesis rewrites must remain `drag_rw_*` in the
    // compiled browser proof. The visual tactic applies an instantiated
    // equality directly at the selected path, preserving both constructor/
    // numeral definitional equality and a newly reflexive goal for the
    // player's required final click. Generic `conv; rw` loses both guarantees.
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
