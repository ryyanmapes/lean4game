import * as React from 'react'
import { useEffect, useState, useRef, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameIdContext } from '../app'
import { WorldLevelIdContext } from '../components/infoview/context'
import { useAppSelector, useAppDispatch } from '../hooks'
import { selectCompleted, levelCompleted } from '../state/progress'
import { LeanRpcClient } from './leanRpcClient'
import { proofStateToCanvas } from './leanToCanvas'
import { VisualCanvas } from './VisualCanvas'
import { VisualHeader } from './VisualHeader'
import type { CanvasState, PropositionTheorem, VisualTactic } from './types'
import type { EqualityHyp } from './TransformationView'
import { parseEqualityHyp } from './TransformationView'
import { buildEqualityTheoremDisplay, buildPropositionTheoremDisplay } from './quantifiedStatement'
import type { ProofState } from '../components/infoview/rpc_api'
import { getDataBaseUrl } from '../utils/url'
import './visual.css'

const SUPPORTED_VISUAL_TACTICS = new Set(['symm', 'induction', 'cases', 'revert'])
// No retries: each retry opens a new WebSocket, which causes the relay to kill
// the still-elaborating exclusive Lean process and restart from scratch.
const INITIAL_PROOF_MAX_ATTEMPTS = 1
const INITIAL_PROOF_RETRY_DELAY_MS = 2000
// NNG4 with lake env lean --server can take several minutes to cold-start,
// especially when build artifacts are on OneDrive. 10 minutes is conservative.
const INITIAL_PROOF_ATTEMPT_TIMEOUT_MS = 600000
const LEVEL_DATA_MAX_ATTEMPTS = 5
const LEVEL_DATA_RETRY_DELAY_MS = 1000

function delay(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      value => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      error => {
        window.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

async function fetchJsonWithRetry<T>(
  url: string,
  attempts = LEVEL_DATA_MAX_ATTEMPTS,
  retryDelayMs = LEVEL_DATA_RETRY_DELAY_MS,
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json() as T
    } catch {
      // Keep retrying below.
    }

    if (attempt < attempts - 1) {
      await delay(retryDelayMs * (attempt + 1))
    }
  }

  return null
}

/** Parse an NNG4 theorem statement like " (a d : ℕ) : a + MyNat.succ d = MyNat.succ (a + d)"
 *  by stripping the argument prefix and normalizing Lean notation for the arithmetic parser. */
function parseTheoremStatement(
  statement: string,
  displayName: string,
  thmName: string,
): (EqualityHyp & { forallFooter?: string }) | null {
  const theoremDisplay = buildEqualityTheoremDisplay(statement)
  let body = theoremDisplay.mainText
  body = body
    .replace(/\bsucc\s+(\d+)\b/g, 'succ($1)')
    .replace(/\bsucc\s+\(/g, 'succ(')
    .replace(/\bsucc\s+([a-zA-Z]\w*)/g, 'succ($1)')
  const parsed = parseEqualityHyp(body, displayName, thmName)
  return parsed ? { ...parsed, forallFooter: theoremDisplay.forallFooter } : null
}

function withVisualOnlyTactics(
  tactics: Array<{ name: string; displayName: string; locked: boolean; hidden: boolean }>,
) {
  const revertUnlocked = tactics.some(tactic =>
    tactic.name === 'induction' && !tactic.locked && !tactic.hidden,
  )
  const nextTactics = tactics.map(tactic =>
    tactic.name === 'revert'
      ? { ...tactic, locked: !revertUnlocked, hidden: false }
      : tactic,
  )
  const alreadyPresent = nextTactics.some(tactic => tactic.name === 'revert')

  if (!alreadyPresent) {
    const revertEntry = {
      name: 'revert',
      displayName: 'revert',
      hidden: false,
      locked: !revertUnlocked,
    }
    const inductionIndex = nextTactics.findIndex(tactic => tactic.name === 'induction')
    if (inductionIndex >= 0) nextTactics.splice(inductionIndex + 1, 0, revertEntry)
    else nextTactics.push(revertEntry)
  }

  return nextTactics
}

export function VisualProofPage() {
  const gameId = useContext(GameIdContext)
  const { worldId, levelId } = useContext(WorldLevelIdContext)
  const navigate = useNavigate()
  const handleNextLevel = useCallback(() => {
    navigate(`/${gameId}/world/${worldId}/level/${levelId + 1}/visual`)
  }, [navigate, gameId, worldId, levelId])
  const handlePreviousLevel = useCallback(() => {
    navigate(`/${gameId}/world/${worldId}/level/${levelId - 1}/visual`)
  }, [navigate, gameId, worldId, levelId])
  const handleWorldMap = useCallback(() => {
    navigate(`/${gameId}/visual`)
  }, [navigate, gameId])
  const dispatch = useAppDispatch()
  const previouslyCompleted = useAppSelector(selectCompleted(gameId, worldId, levelId))
  const handleLevelCompleted = useCallback(() => {
    if (levelId > 0) {
      dispatch(levelCompleted({ game: gameId, world: worldId, level: levelId }))
    }
  }, [dispatch, gameId, worldId, levelId])
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSlow, setLoadingSlow] = useState(false)
  const [levelTitle, setLevelTitle] = useState<string | null>(null)
  const [worldTitle, setWorldTitle] = useState<string | null>(null)
  const [worldSize, setWorldSize] = useState<number | null>(null)
  const [theoremEqualityHyps, setTheoremEqualityHyps] = useState<EqualityHyp[]>([])
  const [propositionTheorems, setPropositionTheorems] = useState<PropositionTheorem[]>([])
  const [visualTactics, setVisualTactics] = useState<VisualTactic[]>([])

  // Keep the client alive for the lifetime of the page
  const clientRef = useRef<LeanRpcClient | null>(null)

  useEffect(() => {
    // Reset so VisualCanvas unmounts and remounts fresh for the new level
    setCanvasState(null)
    setError(null)
    setLoadingSlow(false)
    if (!worldId || !levelId) return

    const slowTimer = window.setTimeout(() => setLoadingSlow(true), 30000)
    let active = true
    clientRef.current?.close()
    clientRef.current = null

    void (async () => {
      let lastError: unknown = null

      for (let attempt = 0; attempt < INITIAL_PROOF_MAX_ATTEMPTS && active; attempt++) {
        const client = new LeanRpcClient(gameId, worldId, levelId)

        try {
          const proof = await withTimeout(
            client.getProofState(),
            INITIAL_PROOF_ATTEMPT_TIMEOUT_MS,
            'Initial proof request timed out',
          )
          if (!active) {
            client.close()
            return
          }
          clientRef.current = client
          setCanvasState(proofStateToCanvas(proof))
          return
        } catch (err) {
          lastError = err
          client.close()

          if (attempt < INITIAL_PROOF_MAX_ATTEMPTS - 1 && active) {
            await delay(INITIAL_PROOF_RETRY_DELAY_MS * (attempt + 1))
          }
        }
      }

      if (active) {
        setError(lastError instanceof Error ? lastError.message : 'Connection failed')
      }
    })()

    return () => {
      active = false
      window.clearTimeout(slowTimer)
      clientRef.current?.close()
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
    setLevelTitle(null)
    setWorldTitle(null)
    setWorldSize(null)
    if (!worldId || !levelId) return
    let active = true
    const baseUrl = getDataBaseUrl().replace(/\/$/, '')

    Promise.all([
      fetchJsonWithRetry<{
        title?: string | null
        lemmas?: Array<{ name: string; displayName: string; category?: string; locked: boolean; hidden: boolean; disabled?: boolean; world?: string | null; level?: number | null; declIndex?: number | null }>
        tactics?: Array<{ name: string; displayName: string; locked: boolean; hidden: boolean }>
      }>(`${baseUrl}/${gameId}/level__${worldId}__${levelId}.json`),
      fetchJsonWithRetry<{ worlds?: { edges?: string[][]; nodes?: { [key: string]: { title?: string } } }; worldSize?: { [key: string]: number } }>(`${baseUrl}/${gameId}/game.json`),
    ]).then(async ([levelData, gameData]) => {
        if (!active || !levelData) return
        if (levelData.title) setLevelTitle(levelData.title)
        if (gameData?.worldSize?.[worldId]) setWorldSize(gameData.worldSize[worldId])
        const rawWorldTitle = gameData?.worlds?.nodes?.[worldId]?.title
        if (rawWorldTitle) setWorldTitle(rawWorldTitle.replace(/\s*World\s*$/i, '').trim())
        const lemmas: Array<{ name: string; displayName: string; category?: string; locked: boolean; hidden: boolean; disabled?: boolean; world?: string | null; level?: number | null; declIndex?: number | null }> =
          levelData.lemmas ?? []
        const tactics: Array<{ name: string; displayName: string; locked: boolean; hidden: boolean }> =
          levelData.tactics ?? []

        // Compute topological world rank from game graph edges (Kahn's BFS).
        const edges = gameData?.worlds?.edges ?? []
        const nodes = new Set([
          ...Object.keys(gameData?.worlds?.nodes ?? {}),
          ...edges.flatMap(([a, b]: string[]) => [a, b]),
        ])
        const inDegree: Record<string, number> = {}
        const adj: Record<string, string[]> = {}
        nodes.forEach((n: string) => { inDegree[n] = 0; adj[n] = [] })
        edges.forEach(([a, b]: string[]) => { adj[a].push(b); inDegree[b]++ })
        const queue = [...nodes].filter((n: string) => inDegree[n] === 0).sort()
        const worldRank: Record<string, number> = {}
        let r = 0
        while (queue.length) {
          const n = queue.shift()!
          worldRank[n] = r++
          adj[n].sort().forEach((m: string) => { if (--inDegree[m] === 0) queue.push(m) })
        }

        const tacticsWithVisualUnlocks = withVisualOnlyTactics(tactics)

        // Category order matches the NNG4 inventory tab order: first occurrence of each
        // category in the alphabetically-sorted lemma list (same logic as inventorySubtabOptionsAtom).
        const categoryOrder: Record<string, number> = {}
        lemmas.forEach(t => {
          if (t.category !== undefined && !(t.category in categoryOrder))
            categoryOrder[t.category] = Object.keys(categoryOrder).length
        })

        const available = lemmas
          .filter(t => !t.locked && !t.hidden && !t.disabled)
          .sort((x, y) =>
            (categoryOrder[x.category ?? ''] ?? Infinity) - (categoryOrder[y.category ?? ''] ?? Infinity)
            || (worldRank[x.world ?? ''] ?? Infinity) - (worldRank[y.world ?? ''] ?? Infinity)
            || (x.level ?? Infinity) - (y.level ?? Infinity)
            || (x.declIndex ?? Infinity) - (y.declIndex ?? Infinity)
            || x.displayName.localeCompare(y.displayName)
          )
        const availableTactics = tacticsWithVisualUnlocks
          .filter(t => !t.locked && !t.hidden && SUPPORTED_VISUAL_TACTICS.has(t.name))
          .map(tactic => ({
            id: tactic.name,
            name: tactic.name,
            label: tactic.displayName || tactic.name,
          }))

        setVisualTactics(availableTactics)

        const results = await Promise.allSettled(
          available.map(thm =>
            fetchJsonWithRetry<{
              statement?: string
              theoremKind?: 'equality' | 'proposition'
            }>(`${baseUrl}/${gameId}/doc__Theorem__${thm.name}.json`)
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
          if (theoremKind === 'proposition') {
            const theoremDisplay = buildPropositionTheoremDisplay(statement)
            propositionHyps.push({
              id: thm.name,
              theoremName: thm.name,
              label: thm.displayName || thm.name,
              proposition: theoremDisplay.mainText,
              forallFooter: theoremDisplay.forallFooter,
              forallSpecification: theoremDisplay.forallSpecification,
            })
            continue
          }
          if (theoremKind !== 'equality') continue
          const parsed = parseTheoremStatement(statement, thm.displayName || thm.name, thm.name)
          if (parsed) hyps.push({ ...parsed, category: thm.category })
        }
        setTheoremEqualityHyps(hyps)
        setPropositionTheorems(propositionHyps)
      })
      .catch(() => { /* level fetch failed — no theorems */ })

    return () => { active = false }
  }, [gameId, worldId, levelId])

  if (error) {
    return <div className="visual-loading" style={{ color: 'var(--visual-error-text)' }}>Error: {error}</div>
  }

  if (!canvasState) {
    return (
      <div className="visual-loading">
        <VisualHeader
          worldId={worldId}
          worldTitle={worldTitle ?? undefined}
          levelId={levelId}
          levelTitle={levelTitle}
          hasPrev={levelId > 1}
          hasNext={worldSize == null || levelId < worldSize}
          isCompleted={false}
          previouslyCompleted={previouslyCompleted ?? false}
          onPrev={levelId > 1 ? handlePreviousLevel : () => {}}
          onNext={handleNextLevel}
          onWorldMap={handleWorldMap}
        />
        <div className="visual-loading-anim">
          <div className="hop-mask">
            <div className="hop-dots" />
          </div>
          <div className="hop-left-cover" />
          <div className="hop-ball-wrapper">
            <div className="hop-ball" />
          </div>
        </div>
        <p className="visual-loading-text">Connecting to Lean…</p>
        {loadingSlow && (
          <p className="visual-loading-slow">
            Still loading — Lean may take a few minutes to start up for large games.
          </p>
        )}
      </div>
    )
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
      onPreviousLevel={levelId > 1 ? handlePreviousLevel : undefined}
      onWorldMap={handleWorldMap}
      levelTitle={levelTitle}
      worldTitle={worldTitle}
      worldSize={worldSize}
      previouslyCompleted={previouslyCompleted}
      onLevelCompleted={handleLevelCompleted}
    />
  )
}

export default VisualProofPage
