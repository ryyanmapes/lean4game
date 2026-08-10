import * as React from 'react'
import { TaggedText_stripTags } from '@leanprover/infoview-api'
import { useEffect, useState, useCallback, useContext, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameIdContext } from '../app'
import { WorldLevelIdContext } from '../components/infoview/context'
import { useAppSelector, useAppDispatch } from '../hooks'
import { selectCompleted, levelCompleted } from '../state/progress'
import { createSolvingId, sendTelemetry } from '../utils/telemetry'
import { proofStateToCanvas } from './leanToCanvas'
import { VisualCanvas, VISUAL_PROOF_AUTOSAVE_VERSION } from './VisualCanvas'
import type { VisualProofResumeState } from './VisualCanvas'
import { VisualHeader } from './VisualHeader'
import { VisualLoadingScreen } from './VisualLoadingScreen'
import type { CanvasState, PropositionTheorem, VisualGoalInfo, VisualHypGoalInfo, VisualProofGraphInfo, VisualTactic, VisualTacticHypInfo, VisualTransformInfo } from './types'
import type { EqualityHyp } from './TransformationView'
import { parseEqualityHyp } from './TransformationView'
import { buildEqualityTheoremDisplay, buildPropositionTheoremDisplay } from './quantifiedStatement'
import { inferAtomicReductionForms } from './existsDisplay'
import type { ProofState } from '../components/infoview/rpc_api'
import { getDataBaseUrl } from '../utils/url'
import { useVisualRpcClient } from './VisualRpcProvider'
import { useLeanLoadingProgress } from './useLeanLoadingProgress'
import { useTelemetryConsentGate } from '../components/telemetry_consent'
import './visual.css'

const SUPPORTED_VISUAL_TACTICS = new Set(['symm', 'induction', 'cases', 'positivity', 'tauto'])
// No retries: each retry opens a new WebSocket, which causes the relay to kill
// the still-elaborating exclusive Lean process and restart from scratch.
const INITIAL_PROOF_MAX_ATTEMPTS = 1
const INITIAL_PROOF_RETRY_DELAY_MS = 2000
// NNG4 with lake env lean --server can take several minutes to cold-start,
// especially when build artifacts are on OneDrive. 10 minutes is conservative.
const INITIAL_PROOF_ATTEMPT_TIMEOUT_MS = 600000
const LEVEL_DATA_MAX_ATTEMPTS = 5
const LEVEL_DATA_RETRY_DELAY_MS = 1000
// Warm snapshot-backed transitions often finish within a frame or two. Avoid
// flashing the full loading animation for those fast paths.
const LOADING_CHROME_DELAY_MS = 200

interface StoredVisualProof {
  version: typeof VISUAL_PROOF_AUTOSAVE_VERSION
  gameId: string
  worldId: string
  levelId: number
  session: VisualProofResumeState
}

function visualProofStorageKey(gameId: string, worldId: string, levelId: number) {
  return `visual-proof-autosave/${gameId}/${worldId}/${levelId}`
}

function loadVisualProofAutosave(gameId: string, worldId: string, levelId: number): VisualProofResumeState | null {
  const key = visualProofStorageKey(gameId, worldId, levelId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredVisualProof>
    if (
      stored.version !== VISUAL_PROOF_AUTOSAVE_VERSION ||
      stored.gameId !== gameId ||
      stored.worldId !== worldId ||
      stored.levelId !== levelId ||
      stored.session?.version !== VISUAL_PROOF_AUTOSAVE_VERSION ||
      typeof stored.session.proofBody !== 'string' ||
      !Array.isArray(stored.session.proofSteps)
    ) {
      localStorage.removeItem(key)
      return null
    }
    return stored.session
  } catch {
    try { localStorage.removeItem(key) } catch {}
    return null
  }
}

function discardVisualProofAutosave(gameId: string, worldId: string, levelId: number) {
  try { localStorage.removeItem(visualProofStorageKey(gameId, worldId, levelId)) } catch {}
}

function delay(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms))
}

function visualDisplayLevelId(levelId: number, skippedLevels: number[]) {
  return levelId - skippedLevels.filter(skipped => skipped > 0 && skipped < levelId).length
}

function levelSucceedsIntro(worldId: string, levelId: number, edges: string[][]): boolean {
  if (worldId === 'Implication') return levelId > 6
  const successors = new Map<string, string[]>()
  for (const [source, target] of edges) {
    if (!source || !target) continue
    successors.set(source, [...(successors.get(source) ?? []), target])
  }
  const reachable = new Set<string>(['Implication'])
  const queue = ['Implication']
  while (queue.length > 0) {
    const source = queue.shift()!
    for (const target of successors.get(source) ?? []) {
      if (reachable.has(target)) continue
      reachable.add(target)
      queue.push(target)
    }
  }
  return reachable.has(worldId)
}

function moveInitialVariablesIntoGoal(canvas: CanvasState): {
  canvas: CanvasState
  prelude: string
} {
  const variableNames: string[] = []
  const streams = canvas.streams.map(stream => {
    const variables = stream.hyps.filter(card => !card.hyp.isAssumption && !card.isTheorem)
    if (variables.length === 0) return stream

    const variableIds = new Set(variables.map(card => card.id))
    const binders = variables.flatMap(card => {
      const type = TaggedText_stripTags(card.hyp.type).trim()
      return card.hyp.names.filter(Boolean).map(name => {
        variableNames.push(card.hyp.playName ?? name)
        return `(${name} : ${type})`
      })
    })
    const originalGoal = TaggedText_stripTags(stream.goal.type).trim()
    const quantifiedGoal = binders.reduceRight(
      (body, binder) => `∀ ${binder}, ${body}`,
      originalGoal,
    )

    return {
      ...stream,
      goal: {
        ...stream.goal,
        type: { text: quantifiedGoal },
        reductionForms: [],
        clickAction: {
          playTactic: 'click_goal',
          tooltip: 'Introduce variable',
          options: [],
        },
      },
      hyps: stream.hyps.filter(card => !variableIds.has(card.id)),
      equalityTree: undefined,
      existsInfo: undefined,
      reductionForms: [],
    }
  })

  return {
    canvas: { ...canvas, streams },
    prelude: variableNames.length > 0 ? `revert ${variableNames.join(' ')}` : '',
  }
}

function isPhonePortraitViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(max-width: 720px) and (orientation: portrait)').matches
    ?? (window.innerWidth <= 720 && window.innerHeight >= window.innerWidth)
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

function visualTacticActivation(name: string): VisualTactic['activation'] {
  return name === 'positivity' ? 'goal_click' : 'drag'
}

export function VisualProofPage() {
  const gameId = useContext(GameIdContext)
  const { worldId, levelId } = useContext(WorldLevelIdContext)
  const solvingId = React.useMemo(() => createSolvingId(), [gameId, worldId, levelId])
  const telemetryStartedAt = React.useMemo(() => Date.now(), [solvingId])
  const telemetrySequence = useRef(0)
  const navigate = useNavigate()
  const proofPreludeRef = useRef('')
  useEffect(() => {
    // The map uses this to return the player to the world they just left,
    // especially on phone layouts where only part of the graph is visible.
    window.sessionStorage.setItem(`visual-map-focus:${gameId}`, worldId)
  }, [gameId, worldId])
  const handleWorldMap = useCallback(() => {
    navigate(`/${gameId}/visual`)
  }, [navigate, gameId])
  const handleOpenClassic = useCallback((proofBody: string) => {
    const token = createSolvingId()
    localStorage.setItem(`visual-proof-handoff/${token}`, JSON.stringify({
      gameId,
      worldId,
      levelId,
      proofBody,
      openInEditor: true,
      sourceAttemptId: solvingId,
    }))
    const target = new URL(window.location.href)
    target.hash = `#/${gameId}/world/${worldId}/level/${levelId}?visualHandoff=${encodeURIComponent(token)}`
    window.open(target.toString(), '_blank', 'noopener,noreferrer')
  }, [gameId, levelId, solvingId, worldId])
  const dispatch = useAppDispatch()
  const previouslyCompleted = useAppSelector(selectCompleted(gameId, worldId, levelId))
  const handleLevelCompleted = useCallback((proof?: { playScript: string; leanScript: string }) => {
    if (levelId > 0) {
      dispatch(levelCompleted({ game: gameId, world: worldId, level: levelId }))
    }
    if (proof) {
      sendTelemetry({
        event_type: 'level_complete',
        game_id: gameId,
        world_id: worldId,
        level_id: levelId,
        attempt_uuid: solvingId,
        mode: 'visual',
        sequence: ++telemetrySequence.current,
        elapsed_ms: Date.now() - telemetryStartedAt,
        play_script: proof.playScript,
        lean_script: proof.leanScript,
      })
    }
  }, [dispatch, gameId, worldId, levelId, solvingId, telemetryStartedAt])
  const handleProofStep = useCallback((interactiveLeanCode: string) => {
    sendTelemetry({
      event_type: 'proof_step',
      game_id: gameId,
      world_id: worldId,
      level_id: levelId,
      attempt_uuid: solvingId,
      mode: 'visual',
      sequence: ++telemetrySequence.current,
      elapsed_ms: Date.now() - telemetryStartedAt,
      step_type: interactiveLeanCode === 'undo' ? 'undo' : 'command',
      command: interactiveLeanCode,
    })
  }, [gameId, worldId, levelId, solvingId, telemetryStartedAt])
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null)
  const [resumeState, setResumeState] = useState<VisualProofResumeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [presentationReady, setPresentationReady] = useState(false)
  const [showLoadingChrome, setShowLoadingChrome] = useState(false)
  const [levelTitle, setLevelTitle] = useState<string | null>(null)
  const [worldTitle, setWorldTitle] = useState<string | null>(null)
  const [worldSize, setWorldSize] = useState<number | null>(null)
  const [skippedLevels, setSkippedLevels] = useState<number[]>([])
  const [emphasizeItems, setEmphasizeItems] = useState<string[]>([])
  const [visualGoalInfos, setVisualGoalInfos] = useState<VisualGoalInfo[]>([])
  const [visualTransformInfos, setVisualTransformInfos] = useState<VisualTransformInfo[]>([])
  const [visualTacticHypInfos, setVisualTacticHypInfos] = useState<VisualTacticHypInfo[]>([])
  const [visualHypGoalInfos, setVisualHypGoalInfos] = useState<VisualHypGoalInfo[]>([])
  const [visualProofGraphInfos, setVisualProofGraphInfos] = useState<VisualProofGraphInfo[]>([])
  // Declared after skippedLevels/worldSize to avoid temporal dead zone in deps arrays.
  const handleNextLevel = useCallback(() => {
    let next = levelId + 1
    while (skippedLevels.includes(next) && (worldSize == null || next <= worldSize)) next++
    navigate(`/${gameId}/world/${worldId}/level/${next}/visual`)
  }, [navigate, gameId, worldId, levelId, skippedLevels, worldSize])
  const handlePreviousLevel = useCallback(() => {
    let prev = levelId - 1
    while (skippedLevels.includes(prev) && prev >= 1) prev--
    if (prev >= 1) navigate(`/${gameId}/world/${worldId}/level/${prev}/visual`)
  }, [navigate, gameId, worldId, levelId, skippedLevels])
  const [theoremEqualityHyps, setTheoremEqualityHyps] = useState<EqualityHyp[]>([])
  const [propositionTheorems, setPropositionTheorems] = useState<PropositionTheorem[]>([])
  const [visualTactics, setVisualTactics] = useState<VisualTactic[]>([])
  const [isPhonePortrait, setIsPhonePortrait] = useState(() => isPhonePortraitViewport())
  const { getClient, disposeClient } = useVisualRpcClient()
  const leanLoadingProgress = useLeanLoadingProgress()
  const telemetryConsent = useTelemetryConsentGate(`${gameId}/${worldId}/${levelId}`)
  const handleAutosave = useCallback((session: VisualProofResumeState) => {
    try {
      const stored: StoredVisualProof = {
        version: VISUAL_PROOF_AUTOSAVE_VERSION,
        gameId,
        worldId,
        levelId,
        session,
      }
      localStorage.setItem(visualProofStorageKey(gameId, worldId, levelId), JSON.stringify(stored))
    } catch {
      // Storage may be disabled or full; gameplay should continue normally.
    }
  }, [gameId, levelId, worldId])

  useEffect(() => {
    setShowLoadingChrome(false)
    const timer = window.setTimeout(() => setShowLoadingChrome(true), LOADING_CHROME_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [gameId, worldId, levelId])

  useEffect(() => {
    const updatePhonePortrait = () => setIsPhonePortrait(isPhonePortraitViewport())
    updatePhonePortrait()
    window.addEventListener('resize', updatePhonePortrait)
    window.addEventListener('orientationchange', updatePhonePortrait)
    return () => {
      window.removeEventListener('resize', updatePhonePortrait)
      window.removeEventListener('orientationchange', updatePhonePortrait)
    }
  }, [])
  const startEventSentRef = useRef<string | null>(null)
  const sendLevelStartTelemetry = useCallback(() => {
    const startKey = `${gameId}/${worldId}/${levelId}`
    if (startEventSentRef.current === startKey) return
    const queued = sendTelemetry({
      event_type: 'level_start',
      game_id: gameId,
      world_id: worldId,
      level_id: levelId,
      attempt_uuid: solvingId,
      mode: 'visual',
      sequence: telemetrySequence.current,
      elapsed_ms: Date.now() - telemetryStartedAt,
    })
    if (queued) startEventSentRef.current = startKey
  }, [gameId, levelId, solvingId, telemetryStartedAt, worldId])

  useEffect(() => {
    // Reset so VisualCanvas unmounts and remounts fresh for the new level
    setCanvasState(null)
    setResumeState(null)
    proofPreludeRef.current = ''
    setError(null)
    if (!worldId || !levelId) return

    let active = true

    void (async () => {
      let lastError: unknown = null

      for (let attempt = 0; attempt < INITIAL_PROOF_MAX_ATTEMPTS && active; attempt++) {
        const client = getClient(worldId, levelId)

        try {
          const proof = await withTimeout(
            client.loadProofState(worldId, levelId, { fresh: true }),
            INITIAL_PROOF_ATTEMPT_TIMEOUT_MS,
            'Initial proof request timed out',
          )
          if (!active) {
            return
          }
          let initialCanvas = proofStateToCanvas(proof)
          const gameData = await fetchJsonWithRetry<{
            worlds?: { edges?: string[][] }
          }>(`${getDataBaseUrl().replace(/\/$/, '')}/${gameId}/game.json`)
          if (levelSucceedsIntro(worldId, levelId, gameData?.worlds?.edges ?? [])) {
            const prepared = moveInitialVariablesIntoGoal(initialCanvas)
            proofPreludeRef.current = prepared.prelude
            initialCanvas = prepared.canvas
          }
          const saved = loadVisualProofAutosave(gameId, worldId, levelId)
          let validatedResume: VisualProofResumeState | null = null
          if (saved && saved.proofBody.trim().length > 0) {
            try {
              const restoredProof = await client.sendProofUpdate(
                [proofPreludeRef.current, saved.proofBody].filter(Boolean).join('\n'),
              )
              if (restoredProof !== null) {
                validatedResume = saved
              } else {
                discardVisualProofAutosave(gameId, worldId, levelId)
              }
            } catch {
              discardVisualProofAutosave(gameId, worldId, levelId)
            }
          }
          if (!active) return
          setResumeState(validatedResume)
          setCanvasState(initialCanvas)
          sendLevelStartTelemetry()
          return
        } catch (err) {
          lastError = err
          disposeClient(client)

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
    }
  }, [disposeClient, gameId, getClient, worldId, levelId, sendLevelStartTelemetry, solvingId, telemetryStartedAt])

  // Callback passed to VisualCanvas: sends an updated proof body to Lean and
  // returns the new ProofState, or null on Lean error.
  const handleInteraction = useCallback(async (proofBody: string): Promise<ProofState | null> => {
    if (!worldId || !levelId) return null
    return getClient(worldId, levelId).sendProofUpdate(
      [proofPreludeRef.current, proofBody].filter(Boolean).join('\n'),
    )
  }, [getClient, levelId, worldId])

  // Fetch the level JSON directly to get the lemma list (InventoryPanel is not mounted
  // on this standalone route, so the jotai atom would always be empty).
  useEffect(() => {
    setPresentationReady(false)
    setTheoremEqualityHyps([])
    setPropositionTheorems([])
    setVisualTactics([])
    setLevelTitle(null)
    setWorldTitle(null)
    setWorldSize(null)
    setSkippedLevels([])
    setEmphasizeItems([])
    setVisualGoalInfos([])
    setVisualTransformInfos([])
    setVisualTacticHypInfos([])
    setVisualHypGoalInfos([])
    setVisualProofGraphInfos([])
    if (!worldId || !levelId) return
    let active = true
    const baseUrl = getDataBaseUrl().replace(/\/$/, '')

    Promise.all([
      fetchJsonWithRetry<{
        title?: string | null
        lemmas?: Array<{ name: string; displayName: string; category?: string; locked: boolean; hidden: boolean; disabled?: boolean; world?: string | null; level?: number | null; declIndex?: number | null }>
        tactics?: Array<{ name: string; displayName: string; locked: boolean; hidden: boolean }>
        visualEmphasize?: string[]
        visualTactics?: string[]
        visualGoalInfos?: VisualGoalInfo[]
        visualTransformInfos?: VisualTransformInfo[]
        visualTacticHypInfos?: VisualTacticHypInfo[]
        visualHypGoalInfos?: VisualHypGoalInfo[]
        visualProofGraphInfos?: VisualProofGraphInfo[]
      }>(`${baseUrl}/${gameId}/level__${worldId}__${levelId}.json`),
      fetchJsonWithRetry<{ worlds?: { edges?: string[][]; nodes?: { [key: string]: { title?: string } } }; worldSize?: { [key: string]: number }; skippedLevels?: { [key: string]: number[] } }>(`${baseUrl}/${gameId}/game.json`),
    ]).then(async ([levelData, gameData]) => {
        if (!active) return
        if (!levelData) {
          setPresentationReady(true)
          return
        }
        if (levelData.title) setLevelTitle(levelData.title)
        if (levelData.visualEmphasize?.length) setEmphasizeItems(levelData.visualEmphasize)
        if (levelData.visualGoalInfos?.length) setVisualGoalInfos(levelData.visualGoalInfos)
        if (levelData.visualTransformInfos?.length) setVisualTransformInfos(levelData.visualTransformInfos)
        if (levelData.visualTacticHypInfos?.length) setVisualTacticHypInfos(levelData.visualTacticHypInfos)
        if (levelData.visualHypGoalInfos?.length) setVisualHypGoalInfos(levelData.visualHypGoalInfos)
        if (levelData.visualProofGraphInfos?.length) setVisualProofGraphInfos(levelData.visualProofGraphInfos)
        if (gameData?.worldSize?.[worldId]) setWorldSize(gameData.worldSize[worldId])
        if (gameData?.skippedLevels?.[worldId]) setSkippedLevels(gameData.skippedLevels[worldId])
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

        const tacticsWithVisualUnlocks = (() => {
          const byName = new Map(tactics.map(tactic => [tactic.name, tactic]))
          for (const name of levelData.visualTactics ?? []) {
            const existing = byName.get(name)
            byName.set(name, {
              name,
              displayName: existing?.displayName || name,
              locked: false,
              hidden: false,
            })
          }
          return [...byName.values()]
        })()

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
            activation: visualTacticActivation(tactic.name),
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
              reductionForms: inferAtomicReductionForms(theoremDisplay.mainText),
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
        setPresentationReady(true)
      })
      .catch(() => {
        // Optional presentation metadata must not leave an otherwise usable
        // Lean proof route stuck on its loading screen.
        if (active) setPresentationReady(true)
      })

    return () => { active = false }
  }, [gameId, worldId, levelId])

  useEffect(() => {
    if (canvasState && presentationReady && telemetryConsent.consentState === 'accepted') {
      sendLevelStartTelemetry()
    }
  }, [canvasState, presentationReady, sendLevelStartTelemetry, telemetryConsent.consentState])

  if (error) {
    return <div className={`visual-page visual-loading${isPhonePortrait ? ' phone-portrait' : ''}`} style={{ color: 'var(--visual-error-text)' }}>Error: {error}</div>
  }

  // Skip-aware prev/next: find closest non-skipped neighbour.
  const hasPrev = (() => { let p = levelId - 1; while (skippedLevels.includes(p) && p >= 1) p--; return p >= 1 })()
  const hasNext = (() => { let n = levelId + 1; while (skippedLevels.includes(n) && worldSize != null && n <= worldSize) n++; return worldSize == null || n <= worldSize })()
  const displayLevelId = visualDisplayLevelId(levelId, skippedLevels)

  const contentReady = Boolean(canvasState && presentationReady)
  if (!canvasState || !presentationReady || telemetryConsent.shouldHold) {
    const loadingProgress = contentReady
      ? { value: 100, message: 'Complete' }
      : canvasState
        ? { value: 98, message: 'Loading level information…' }
        : leanLoadingProgress
    return <VisualLoadingScreen
      worldId={worldId}
      worldTitle={worldTitle ?? undefined}
      levelId={levelId}
      displayLevelId={displayLevelId}
      levelTitle={levelTitle}
      showChrome={showLoadingChrome}
      message={loadingProgress.message}
      progress={loadingProgress.value}
      onWorldMap={handleWorldMap}
      hasPrev={hasPrev}
      hasNext={hasNext}
      previouslyCompleted={previouslyCompleted ?? false}
      onPrev={levelId > 1 ? handlePreviousLevel : () => {}}
      onNext={handleNextLevel}
      phonePortrait={isPhonePortrait}
      telemetryConsent={telemetryConsent}
    />
  }

  return (
    <VisualCanvas
      gameId={gameId}
      initialState={canvasState}
      theoremEqualityHyps={theoremEqualityHyps}
      propositionTheorems={propositionTheorems}
      visualTactics={visualTactics}
      emphasizeItems={emphasizeItems}
      visualGoalInfos={visualGoalInfos}
      visualTransformInfos={visualTransformInfos}
      visualTacticHypInfos={visualTacticHypInfos}
      visualHypGoalInfos={visualHypGoalInfos}
      visualProofGraphInfos={visualProofGraphInfos}
      worldId={worldId}
      levelId={levelId}
      displayLevelId={displayLevelId}
      onInteraction={handleInteraction}
      onNextLevel={handleNextLevel}
      onPreviousLevel={hasPrev ? handlePreviousLevel : undefined}
      onWorldMap={handleWorldMap}
      levelTitle={levelTitle}
      worldTitle={worldTitle}
      worldSize={worldSize}
      skippedLevels={skippedLevels}
      previouslyCompleted={previouslyCompleted}
      onLevelCompleted={handleLevelCompleted}
      onProofStep={handleProofStep}
      onOpenClassic={handleOpenClassic}
      resumeState={resumeState}
      onAutosave={handleAutosave}
      proofPrelude={proofPreludeRef.current}
    />
  )
}

export default VisualProofPage
