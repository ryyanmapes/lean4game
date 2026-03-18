import * as React from 'react'
import { useEffect, useState, useRef, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameIdContext } from '../app'
import { WorldLevelIdContext } from '../components/infoview/context'
import { LeanRpcClient } from './leanRpcClient'
import { proofStateToCanvas } from './leanToCanvas'
import { VisualCanvas } from './VisualCanvas'
import type { CanvasState, PropositionTheorem, VisualTactic } from './types'
import type { EqualityHyp } from './TransformationView'
import { parseEqualityHyp } from './TransformationView'
import type { ProofState } from '../components/infoview/rpc_api'
import './visual.css'

const SUPPORTED_VISUAL_TACTICS = new Set(['symm'])

function extractTheoremStatementBody(statement: string): string {
  let body = statement
  let depth = 0
  for (let i = 0; i < statement.length; i++) {
    if (statement[i] === '(') depth++
    else if (statement[i] === ')') depth--
    else if (depth === 0 && statement.slice(i, i + 2) === ': ') {
      body = statement.slice(i + 2)
      break
    }
  }
  return body
    .replace(/â†’/g, '→')
    .replace(/â†/g, '←')
    .replace(/â†”/g, '↔')
    .replace(/\bMyNat\./g, '')
    .replace(/\bNat\./g, '')
    .trim()
}

function normalizeTheoremStatement(statement: string): string {
  return statement
    .replace(/Ã¢â€ â€™/g, 'â†’')
    .replace(/Ã¢â€ Â/g, 'â†')
    .replace(/Ã¢â€ â€/g, 'â†”')
    .replace(/\bMyNat\./g, '')
    .replace(/\bNat\./g, '')
    .trim()
}

function splitLeadingBinder(statement: string): { binder: string; rest: string } | null {
  const trimmed = statement.trim()
  if (!trimmed.startsWith('(')) return null

  let depth = 0
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++
    else if (trimmed[i] === ')') {
      depth--
      if (depth === 0) {
        return {
          binder: trimmed.slice(1, i).trim(),
          rest: trimmed.slice(i + 1).trim(),
        }
      }
    }
  }

  return null
}

function stripOuterParens(statement: string): string {
  let current = statement.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0
    let wrapsWhole = true
    for (let i = 0; i < current.length; i++) {
      if (current[i] === '(') depth++
      else if (current[i] === ')') {
        depth--
        if (depth === 0 && i < current.length - 1) {
          wrapsWhole = false
          break
        }
      }
    }
    if (!wrapsWhole) break
    current = current.slice(1, -1).trim()
  }
  return current
}

function hasTopLevelImplication(statement: string): boolean {
  statement = stripOuterParens(statement)
  let depth = 0
  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0) {
      if (statement.slice(i, i + 1) === '→') return true
      if (statement.slice(i, i + 2) === '->') return true
      if (statement.slice(i, i + 2) === '=>') return true
      if (statement.slice(i, i + 3) === '\\to') return true
      if (statement.slice(i, i + 8) === '\\implies') return true
    }
  }
  return false
}

function isPropositionBinderType(type: string): boolean {
  const normalized = stripOuterParens(type.trim())
  return normalized.includes(' = ')
    || normalized.includes(' ≠ ')
    || normalized.includes('∧')
    || normalized.includes('∨')
    || normalized.startsWith('¬')
    || normalized === 'False'
    || normalized === 'True'
    || hasTopLevelImplication(normalized)
}

function buildPropositionTheorem(statement: string): string {
  let rest = normalizeTheoremStatement(statement)
  const premises: string[] = []

  while (true) {
    const split = splitLeadingBinder(rest)
    if (!split) break
    const colonIdx = split.binder.lastIndexOf(':')
    const binderType = colonIdx === -1 ? '' : split.binder.slice(colonIdx + 1).trim()
    if (binderType && isPropositionBinderType(binderType)) premises.push(binderType)
    rest = split.rest
  }

  if (rest.startsWith(':')) rest = rest.slice(1).trim()
  return premises.length > 0 ? `${premises.join(' → ')} → ${rest}` : rest
}

/** Parse an NNG4 theorem statement like " (a d : ℕ) : a + MyNat.succ d = MyNat.succ (a + d)"
 *  by stripping the argument prefix and normalizing Lean notation for the arithmetic parser. */
function parseTheoremStatement(statement: string, displayName: string, thmName: string): EqualityHyp | null {
  // 1. Strip "(args : Type) :" prefix — find the first ": " at parenthesis depth 0
  let body = extractTheoremStatementBody(statement)
  body = body
    .replace(/\bsucc\s+(\d+)\b/g, 'succ($1)')
    .replace(/\bsucc\s+\(/g, 'succ(')
    .replace(/\bsucc\s+([a-zA-Z]\w*)/g, 'succ($1)')
  return parseEqualityHyp(body, displayName, thmName)
}

export function VisualProofPage() {
  const gameId = useContext(GameIdContext)
  const { worldId, levelId } = useContext(WorldLevelIdContext)
  const navigate = useNavigate()
  const handleNextLevel = useCallback(() => {
    navigate(`/${gameId}/world/${worldId}/level/${levelId + 1}/visual`)
  }, [navigate, gameId, worldId, levelId])
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [theoremEqualityHyps, setTheoremEqualityHyps] = useState<EqualityHyp[]>([])
  const [propositionTheorems, setPropositionTheorems] = useState<PropositionTheorem[]>([])
  const [visualTactics, setVisualTactics] = useState<VisualTactic[]>([])

  // Keep the client alive for the lifetime of the page
  const clientRef = useRef<LeanRpcClient | null>(null)

  useEffect(() => {
    // Reset so VisualCanvas unmounts and remounts fresh for the new level
    setCanvasState(null)
    setError(null)
    if (!worldId || !levelId) return
    let active = true
    const client = new LeanRpcClient(gameId, worldId, levelId)
    clientRef.current = client
    client.getProofState()
      .then(proof => { if (active) setCanvasState(proofStateToCanvas(proof)) })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Connection failed') })
    return () => {
      active = false
      client.close()
      clientRef.current = null
    }
  }, [gameId, worldId, levelId])

  // Callback passed to VisualCanvas: sends an updated proof body to Lean and
  // returns the new ProofState, or null on Lean error.
  const handleInteraction = useCallback(async (proofBody: string): Promise<ProofState | null> => {
    return clientRef.current?.sendProofUpdate(proofBody) ?? null
  }, [])

  // Fetch the level JSON directly to get the lemma list (InventoryPanel is not mounted
  // on this standalone route, so the jotai atom would always be empty).
  useEffect(() => {
    setTheoremEqualityHyps([])
    setPropositionTheorems([])
    setVisualTactics([])
    if (!worldId || !levelId) return
    let active = true
    const baseUrl = window.location.origin + '/data'

    fetch(`${baseUrl}/${gameId}/level__${worldId}__${levelId}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(async (levelData) => {
        if (!active || !levelData) return
        const lemmas: Array<{ name: string; displayName: string; locked: boolean; hidden: boolean }> =
          levelData.lemmas ?? []
        const tactics: Array<{ name: string; displayName: string; locked: boolean; hidden: boolean }> =
          levelData.tactics ?? []
        const available = lemmas.filter(t => !t.locked && !t.hidden)
        const availableTactics = tactics
          .filter(t => !t.locked && !t.hidden && SUPPORTED_VISUAL_TACTICS.has(t.name))
          .map(tactic => ({
            id: tactic.name,
            name: tactic.name,
            label: tactic.displayName || tactic.name,
          }))

        setVisualTactics(availableTactics)

        const results = await Promise.allSettled(
          available.map(thm =>
            fetch(`${baseUrl}/${gameId}/doc__Theorem__${thm.name}.json`)
              .then(r => r.ok ? r.json() : null)
              .then(doc => ({
                thm,
                statement: doc?.statement as string | undefined,
                theoremKind: doc?.theoremKind as 'equality' | 'proposition' | undefined,
              }))
              .catch(() => ({ thm, statement: undefined, theoremKind: undefined }))
          )
        )

        if (!active) return
        const hyps: EqualityHyp[] = []
        const propositionHyps: PropositionTheorem[] = []
        for (const result of results) {
          if (result.status !== 'fulfilled') continue
          const { thm, statement, theoremKind } = result.value
          if (!statement) continue
          const body = extractTheoremStatementBody(statement)
          if (theoremKind === 'proposition') {
            propositionHyps.push({
              id: thm.name,
              theoremName: thm.name,
              label: thm.displayName || thm.name,
              proposition: buildPropositionTheorem(statement),
            })
            continue
          }
          if (theoremKind !== 'equality') continue
          const parsed = parseTheoremStatement(statement, thm.displayName || thm.name, thm.name)
          if (parsed) hyps.push(parsed)
        }
        setTheoremEqualityHyps(hyps)
        setPropositionTheorems(propositionHyps)
      })
      .catch(() => { /* level fetch failed — no theorems */ })

    return () => { active = false }
  }, [gameId, worldId, levelId])

  if (error) {
    return <div className="visual-loading" style={{ color: '#f87171' }}>Error: {error}</div>
  }

  if (!canvasState) {
    return <div className="visual-loading">Connecting to Lean…</div>
  }

  return (
    <VisualCanvas
      initialState={canvasState}
      theoremEqualityHyps={theoremEqualityHyps}
      propositionTheorems={propositionTheorems}
      visualTactics={visualTactics}
      worldId={worldId}
      levelId={levelId}
      onInteraction={handleInteraction}
      onNextLevel={handleNextLevel}
    />
  )
}

export default VisualProofPage
