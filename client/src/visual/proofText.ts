export interface ProofTextStep {
  command: string
  playTactic: string
  leanTactic: string | null
}

interface FocusedCommand {
  casePath: string[]
  tactic: string
}

interface ProofScriptBlock {
  items: ProofScriptItem[]
}

type ProofScriptItem =
  | { kind: 'tactic'; tactic: string }
  | { kind: 'case'; label: string; block: ProofScriptBlock }

export function isVisualOnlyPlayTactic(playTactic: string): boolean {
  return playTactic.startsWith('click_') || playTactic.startsWith('drag_')
}

export function parseFocusedCommand(command: string): FocusedCommand {
  const casePath: string[] = []
  let rest = command.trim()

  while (rest.startsWith('focus_case ') || rest.startsWith('case ') || rest.startsWith("case' ")) {
    const prefixLength = rest.startsWith('focus_case ')
      ? 11
      : rest.startsWith("case' ")
        ? 6
        : 5
    const inner = rest.slice(prefixLength)
    const separator = inner.indexOf('=>')
    if (separator === -1) break
    const label = inner.slice(0, separator).trim()
    const next = inner.slice(separator + 2).trim()
    if (!label || !next) break
    casePath.push(label)
    rest = next
  }

  return { casePath, tactic: rest }
}

export function stripCasePrefixes(tactic: string | null | undefined): string | null {
  if (!tactic) return null
  return parseFocusedCommand(tactic).tactic || null
}

function getOrCreateCaseItem(block: ProofScriptBlock, label: string): ProofScriptBlock {
  const existing = block.items.find(item => item.kind === 'case' && item.label === label)
  if (existing?.kind === 'case') return existing.block

  const nextBlock: ProofScriptBlock = { items: [] }
  block.items.push({ kind: 'case', label, block: nextBlock })
  return nextBlock
}

export function serializeProofCommands(commands: string[]): string {
  const root: ProofScriptBlock = { items: [] }

  for (const command of commands) {
    const { casePath, tactic } = parseFocusedCommand(command)
    if (!tactic) continue
    let block = root
    for (const label of casePath) block = getOrCreateCaseItem(block, label)
    block.items.push({ kind: 'tactic', tactic })
  }

  function render(block: ProofScriptBlock, indent: number): string[] {
    const pad = ' '.repeat(indent)
    const lines: string[] = []
    for (const item of block.items) {
      if (item.kind === 'tactic') lines.push(`${pad}${item.tactic}`)
      else {
        lines.push(`${pad}case ${item.label} =>`)
        lines.push(...render(item.block, indent + 2))
      }
    }
    return lines
  }

  return render(root, 0).join('\n')
}

/** A readable ordinary Lean equivalent for visual-only commands. */
export function coreTacticForVisualCommand(playTactic: string): string | null {
  const source = parseFocusedCommand(playTactic).tactic
  const rewrite = /^drag_rw_(?:lhs|rhs)(?:_at)? \[(←\s*)?([^\]]+)\](?: \[[^\]]*\])?$/u.exec(source)
  if (rewrite) return `rw [${rewrite[1] ?? ''}${rewrite[2]!.trim()}]`

  const hypRewrite = /^drag_rw_hyp_(?:lhs|rhs)(?:_at)?\s+(\S+)\s+\[(←\s*)?([^\]]+)\](?: \[[^\]]*\])?$/u.exec(source)
  if (hypRewrite) return `rw [${hypRewrite[2] ?? ''}${hypRewrite[3]!.trim()}] at ${hypRewrite[1]}`

  return null
}

function leafForMode(step: ProofTextStep, mode: 'lean' | 'play'): string {
  if (mode === 'play') return step.playTactic
  return stripCasePrefixes(step.leanTactic)
    ?? coreTacticForVisualCommand(step.playTactic)
    ?? (isVisualOnlyPlayTactic(step.playTactic) ? `? (${step.playTactic})` : step.playTactic)
}

export function buildStructuredProof(steps: ProofTextStep[], mode: 'lean' | 'play'): string {
  const commands = steps.map(step => {
    const { casePath } = parseFocusedCommand(step.command)
    return casePath.reduceRight((inner, label) => `case ${label} => ${inner}`, leafForMode(step, mode))
  })
  return serializeProofCommands(commands)
}

export function shortenQualifiedNames(text: string): string {
  return text.replace(/\b(?:[A-Z]\w*\.)+(\w+)\b/gu, '$1')
}

export function displayedProofLines(steps: ProofTextStep[], mode: 'lean' | 'play'): string[] {
  const proof = shortenQualifiedNames(buildStructuredProof(steps, mode))
  return proof ? proof.split('\n') : []
}
