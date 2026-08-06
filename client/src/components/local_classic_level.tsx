import * as React from 'react'
import Split from 'react-split'
import { useLocation, useParams } from 'react-router-dom'
import { useSelector } from 'react-redux'
import type { Diagnostic } from 'vscode-languageserver-types'

import { GameIdContext } from '../app'
import { useAppDispatch } from '../hooks'
import { useGetGameInfoQuery, useLoadLevelQuery } from '../state/api'
import {
  changedInventory,
  changeTypewriterMode,
  levelCompleted,
  selectInventory,
  selectTypewriterMode,
} from '../state/progress'
import { store } from '../state/store'
import { LocalWasmRpcClient } from '../visual/localWasmRpcClient'
import { useLeanLoadingProgress } from '../visual/useLeanLoadingProgress'
import { ClassicLoadingScreen } from './classic_loading_screen'
import { createTelemetryId, sendTelemetry } from '../utils/telemetry'
import { LevelAppBar } from './app_bar'
import {
  DeletedChatContext,
  InputModeContext,
  PreferencesContext,
  ProofContext,
  SelectionContext,
} from './infoview/context'
import { ExerciseStatement, GoalsTabs } from './infoview/main'
import type { GameHint, ProofState } from './infoview/rpc_api'
import { InventoryPanel } from './inventory/inventory_panel'
import { ChatPanel } from './level'

import '../css/level.css'
import '../css/infoview.css'
import '../css/local-classic-level.css'

const emptyProof: ProofState = {
  steps: [],
  diagnostics: [],
  completed: false,
  completedWithWarnings: false,
}

type VisualProofHandoff = {
  gameId?: string
  worldId?: string
  levelId?: number
  proofBody?: string
  openInEditor?: boolean
  sourceAttemptId?: string
}

function proofEdit(previous: string, next: string) {
  const before = previous ? previous.split(/\r?\n/u) : []
  const after = next ? next.split(/\r?\n/u) : []
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++
  return {
    fromLine: prefix,
    removedLines: before.length - prefix - suffix,
    inserted: after.slice(prefix, after.length - suffix).join('\n'),
  }
}

function rejectedCommandMessage(proofBody: string, detail: string) {
  const command = proofBody.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).at(-1) ?? ''
  const syntaxHint = /^rw\s+(?!\[)/u.test(command) && !/expected\s+['`]\[['`]/u.test(detail)
    ? "unexpected identifier; expected '['"
    : ''
  const diagnostic = [syntaxHint, detail].filter(Boolean).join('\n\n')
  return command
    ? `Failed command\n: ${command}\n\n${diagnostic || 'Lean rejected the command.'}`
    : diagnostic || 'Lean rejected the proof.'
}

function LocalExercisePanel({
  level,
  proofBody,
  setProofBody,
  proof,
  checking,
  error,
  commandInput,
  setCommandInput,
  typewriterMode,
  visible = true,
}: {
  level: any
  proofBody: string
  setProofBody: React.Dispatch<React.SetStateAction<string>>
  proof: ProofState
  checking: boolean
  error: string
  commandInput: string
  setCommandInput: React.Dispatch<React.SetStateAction<string>>
  typewriterMode: boolean
  visible?: boolean
}) {
  const proofLines = proofBody.split(/\r?\n/u)

  function executeCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const command = commandInput.trim()
    if (!command || checking || proof.completed) return
    setProofBody(current => current.trim() ? `${current.trimEnd()}\n${command}` : command)
    setCommandInput('')
  }

  function retryFrom(stepIndex: number, command: string) {
    setProofBody(proofLines.slice(0, Math.max(0, stepIndex - 1)).join('\n'))
    setCommandInput(command)
  }

  const proofSteps = proof.steps ?? []
  const lastStepIndex = Math.max(0, proofSteps.length - 1)

  return <div className={`exercise-panel ${visible ? '' : 'hidden'}`}>
    <div className="exercise">
      {typewriterMode ? <div className="typewriter-interface">
        <div className="content">
          <div className="world-image-container empty" />
          <div className="tmp-pusher" />
          <div className="proof">
            <ExerciseStatement data={level} showLeanStatement />
            {proofSteps.map((step, index) => <div className={`step step-${index}`} key={index}>
              {step.command && <div className="command">
                <div className="command-text">{step.command}</div>
                <button type="button" className="undo-button btn btn-inverted"
                  onClick={() => retryFrom(index, step.command)}>
                  Retry
                </button>
              </div>}
              {step.goals.length > 0 && <GoalsTabs proofStep={step}
                last={index === lastStepIndex} />}
            </div>)}
            {error && <div className="message error"><pre>{error}</pre></div>}
            {proof.completed && <div className="message information">
              <strong>Level completed! 🎉</strong>
            </div>}
            <div className={`local-classic-status ${proof.completed ? 'is-complete' : ''}`}>
              {checking ? 'Lean is checking…' : proof.completed ? 'Proof complete — checked by Lean' : 'Lean is ready'}
            </div>
          </div>
        </div>
        <form className="typewriter local-wasm-typewriter" onSubmit={executeCommand}>
          <div className="typewriter-input-wrapper">
            <input value={commandInput}
              onChange={event => setCommandInput(event.target.value.replace(/[\r\n]/gu, ''))}
              aria-label="Lean command"
              disabled={checking || Boolean(proof.completed)}
              autoComplete="off"
              spellCheck={false} />
          </div>
          <button type="submit" className="btn btn-inverted"
            disabled={checking || Boolean(proof.completed) || !commandInput.trim()}>
            Execute
          </button>
        </form>
        <textarea id="local-classic-proof" value={proofBody} readOnly hidden aria-hidden="true" />
      </div> : <>
        <ExerciseStatement data={level} showLeanStatement />
        <textarea id="local-classic-proof" className="local-wasm-code-editor"
          value={proofBody}
          onChange={event => setProofBody(event.target.value)}
          aria-label="Lean code"
          spellCheck={false} />
        <div className="local-wasm-editor-goals">
          {proofSteps[lastStepIndex]?.goals.length > 0 &&
            <GoalsTabs proofStep={proofSteps[lastStepIndex]} last />}
          {error && <div className="message error"><pre>{error}</pre></div>}
          <div className={`local-classic-status ${proof.completed ? 'is-complete' : ''}`}>
            {checking ? 'Lean is checking…' : proof.completed ? 'Proof complete — checked by Lean' : 'Lean is ready'}
          </div>
        </div>
      </>}
    </div>
  </div>
}

/**
 * The original hosted Lean4Game level shell, backed by the persistent
 * in-browser Lean process instead of the hosted WebSocket language server.
 */
export default function LocalClassicLevel() {
  const gameId = React.useContext(GameIdContext)
  const { mobile } = React.useContext(PreferencesContext)
  const params = useParams()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const worldId = params.worldId ?? ''
  const levelId = Number(params.levelId ?? 1)
  const attemptId = React.useMemo(() => createTelemetryId(), [gameId, worldId, levelId])
  const telemetryStartedAt = React.useMemo(() => Date.now(), [attemptId])
  const telemetrySequence = React.useRef(0)
  const telemetryStarted = React.useRef(false)
  const telemetryCompleted = React.useRef(false)
  const level = useLoadLevelQuery({ game: gameId, world: worldId, level: levelId })
  const game = useGetGameInfoQuery({ game: gameId })
  const client = React.useMemo(() => new LocalWasmRpcClient(gameId, worldId, levelId), [gameId])
  const leanLoadingProgress = useLeanLoadingProgress()

  const [visualHandoff] = React.useState<VisualProofHandoff | undefined>(() => {
    const routeHandoff = (
      location.state as { visualProofHandoff?: VisualProofHandoff } | null
    )?.visualProofHandoff
    if (routeHandoff) return routeHandoff

    const token = new URLSearchParams(location.search).get('visualHandoff')
    if (!token) return undefined
    const storageKey = `visual-proof-handoff/${token}`
    const rawHandoff = localStorage.getItem(storageKey)
    localStorage.removeItem(storageKey)
    if (!rawHandoff) return undefined
    try {
      return JSON.parse(rawHandoff) as VisualProofHandoff
    } catch {
      return undefined
    }
  })
  const handedOffProof =
    visualHandoff?.gameId === gameId &&
    visualHandoff.worldId === worldId &&
    visualHandoff.levelId === levelId &&
    typeof visualHandoff.proofBody === 'string'
      ? visualHandoff.proofBody
      : ''

  const [proofBody, setProofBody] = React.useState(handedOffProof)
  const [proof, setProof] = React.useState<ProofState>(emptyProof)
  const [checking, setChecking] = React.useState(true)
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState('')
  const [commandInput, setCommandInput] = React.useState('')
  const [deletedChat, setDeletedChat] = React.useState<GameHint[]>([])
  const [showHelp, setShowHelp] = React.useState<Set<number>>(new Set())
  const [selectedStep, setSelectedStep] = React.useState<number>()
  const [interimDiags, setInterimDiags] = React.useState<Diagnostic[]>([])
  const [crashed, setCrashed] = React.useState<Boolean>(false)
  const [lockEditorMode, setLockEditorMode] = React.useState(false)
  const [pageNumber, setPageNumber] = React.useState(0)
  const [showLoadingChrome, setShowLoadingChrome] = React.useState(false)
  const acceptedProofBody = React.useRef('')
  const telemetryAcceptedProof = React.useRef(handedOffProof)
  const preserveRejectedError = React.useRef(false)

  const typewriterMode = useSelector(selectTypewriterMode(gameId))
  const setTypewriterMode: React.Dispatch<React.SetStateAction<boolean>> = value => {
    const next = typeof value === 'function' ? value(typewriterMode) : value
    dispatch(changeTypewriterMode({ game: gameId, typewriterMode: next }))
  }

  React.useEffect(() => {
    if (visualHandoff?.openInEditor) {
      dispatch(changeTypewriterMode({ game: gameId, typewriterMode: false }))
    }
  }, [dispatch, gameId, visualHandoff?.openInEditor])

  React.useEffect(() => {
    let active = true
    acceptedProofBody.current = ''
    telemetryAcceptedProof.current = handedOffProof
    telemetryStarted.current = false
    telemetryCompleted.current = false
    telemetrySequence.current = 0
    preserveRejectedError.current = false
    setProofBody(handedOffProof)
    setCommandInput('')
    setReady(false)
    setChecking(true)
    setError('')
    client.loadProofState(worldId, levelId).then(next => {
      if (!active) return
      setProof(next)
      setReady(true)
      telemetryStarted.current = true
      sendTelemetry({
        event_type: 'level_start',
        game_id: gameId,
        world_id: worldId,
        level_id: levelId,
        attempt_uuid: attemptId,
        mode: 'classic',
        sequence: telemetrySequence.current,
        elapsed_ms: Date.now() - telemetryStartedAt,
        initial_script: handedOffProof,
        source_attempt_uuid: visualHandoff?.sourceAttemptId,
      })
    }, reason => {
      if (active) setError(String(reason))
    }).finally(() => {
      if (active) setChecking(false)
    })
    return () => { active = false }
  }, [attemptId, client, gameId, handedOffProof, levelId, telemetryStartedAt, visualHandoff?.sourceAttemptId, worldId])

  React.useEffect(() => {
    setShowLoadingChrome(false)
    const timer = window.setTimeout(() => setShowLoadingChrome(true), 200)
    return () => window.clearTimeout(timer)
  }, [worldId, levelId])

  React.useEffect(() => () => client.close(), [client])

  React.useEffect(() => {
    if (!ready || proofBody === acceptedProofBody.current) return
    let active = true
    const timer = window.setTimeout(async () => {
      setChecking(true)
      const keepRejectedError = preserveRejectedError.current
      if (!keepRejectedError) setError('')
      try {
        const next = await client.sendProofUpdate(proofBody)
        if (!active) return
        if (next) {
          const previousAccepted = telemetryAcceptedProof.current
          acceptedProofBody.current = proofBody
          telemetryAcceptedProof.current = proofBody
          setProof(next)
          if (telemetryStarted.current && proofBody !== previousAccepted) {
            const edit = proofEdit(previousAccepted, proofBody)
            sendTelemetry({
              event_type: 'proof_step',
              game_id: gameId,
              world_id: worldId,
              level_id: levelId,
              attempt_uuid: attemptId,
              mode: 'classic',
              sequence: ++telemetrySequence.current,
              elapsed_ms: Date.now() - telemetryStartedAt,
              step_type: 'edit',
              from_line: edit.fromLine,
              removed_lines: edit.removedLines,
              command: edit.inserted,
            })
          }
          if (keepRejectedError) preserveRejectedError.current = false
        } else {
          const detail = client.getLastProofError()
          setError(rejectedCommandMessage(proofBody, detail))
          if (typewriterMode) {
            const command = proofBody.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).at(-1) ?? ''
            preserveRejectedError.current = true
            setCommandInput(command)
            setProofBody(acceptedProofBody.current)
          }
        }
      } catch (reason) {
        if (active) setError(String(reason))
      } finally {
        if (active) setChecking(false)
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [attemptId, client, gameId, levelId, proofBody, ready, telemetryStartedAt, typewriterMode, worldId])

  React.useEffect(() => {
    if (!proof.completed || !level.data) return
    dispatch(levelCompleted({ game: gameId, world: worldId, level: levelId }))
    const unlocked = [
      ...level.data.tactics,
      ...level.data.lemmas,
      ...level.data.definitions,
    ].filter(tile => tile.new).map(tile => tile.name)
    if (level.data.statementName) unlocked.push(level.data.statementName)
    const inventory = selectInventory(gameId)(store.getState())
    dispatch(changedInventory({
      game: gameId,
      inventory: [...inventory, ...unlocked].filter((item, index, all) => all.indexOf(item) === index),
    }))
    if (!telemetryCompleted.current) {
      telemetryCompleted.current = true
      sendTelemetry({
        event_type: 'level_complete',
        game_id: gameId,
        world_id: worldId,
        level_id: levelId,
        attempt_uuid: attemptId,
        mode: 'classic',
        sequence: ++telemetrySequence.current,
        elapsed_ms: Date.now() - telemetryStartedAt,
        lean_script: acceptedProofBody.current,
      })
    }
  }, [attemptId, dispatch, gameId, level.data, levelId, proof.completed, telemetryStartedAt, worldId])

  const loadingWorldSize = game.data?.worldSize?.[worldId] ?? levelId
  const loadingLevelTitle = `${mobile ? '' : 'Level'} ${levelId} / ${loadingWorldSize}` +
    (level.data?.title ? ` : ${level.data.title}` : '')

  if (!level.data || !game.data || !ready) {
    const loadingProgress = !level.data || !game.data
      ? { value: 8, message: 'Loading game and level information…' }
      : leanLoadingProgress
    return <ClassicLoadingScreen
      worldTitle={game.data?.worlds.nodes[worldId]?.title}
      levelTitle={loadingLevelTitle}
      showChrome={showLoadingChrome}
      message={loadingProgress.message}
      progress={loadingProgress.value}
    />
  }

  const worldSize = game.data.worldSize?.[worldId] ?? levelId
  const lastLevel = levelId >= worldSize
  const levelTitle = `${mobile ? '' : 'Level'} ${levelId} / ${worldSize}` +
    (level.data.title ? ` : ${level.data.title}` : '')

  const exercise = <LocalExercisePanel
    level={level.data}
    proofBody={proofBody}
    setProofBody={setProofBody}
    proof={proof}
    checking={checking}
    error={error}
    commandInput={commandInput}
    setCommandInput={setCommandInput}
    typewriterMode={typewriterMode}
  />

  return <DeletedChatContext.Provider value={{ deletedChat, setDeletedChat, showHelp, setShowHelp }}>
    <SelectionContext.Provider value={{ selectedStep, setSelectedStep }}>
      <InputModeContext.Provider value={{
        typewriterMode,
        setTypewriterMode,
        typewriterInput: commandInput,
        setTypewriterInput: setCommandInput,
        lockEditorMode,
        setLockEditorMode,
      }}>
        <ProofContext.Provider value={{
          proof,
          setProof,
          interimDiags,
          setInterimDiags,
          crashed,
          setCrashed,
        }}>
          <LevelAppBar pageNumber={pageNumber} setPageNumber={setPageNumber}
            isLoading={false} levelTitle={levelTitle} />
          {mobile ? <div className="app-content level-mobile">
            <LocalExercisePanel
              level={level.data}
              proofBody={proofBody}
              setProofBody={setProofBody}
              proof={proof}
              checking={checking}
              error={error}
              commandInput={commandInput}
              setCommandInput={setCommandInput}
              typewriterMode={typewriterMode}
              visible={pageNumber === 0}
            />
            <InventoryPanel levelInfo={level.data} visible={pageNumber === 1} />
          </div> :
            <Split minSize={0} snapOffset={200} sizes={[25, 50, 25]} className="app-content level">
              <ChatPanel lastLevel={lastLevel} />
              {exercise}
              <InventoryPanel levelInfo={level.data} />
            </Split>}
        </ProofContext.Provider>
      </InputModeContext.Provider>
    </SelectionContext.Provider>
  </DeletedChatContext.Provider>
}
