import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { GameIdContext } from '../app'
import { useGetGameInfoQuery, useLoadLevelQuery } from '../state/api'
import type { InteractiveGoalWithHints, ProofState } from './infoview/rpc_api'
import { Markdown } from './markdown'
import { LocalWasmRpcClient } from '../visual/localWasmRpcClient'
import '../css/local-classic-level.css'

function codeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'text' in value) {
    return String((value as { text?: unknown }).text ?? '')
  }
  return String(value ?? '')
}

function Goal({ state }: { state: InteractiveGoalWithHints }) {
  return <section className="local-classic-goal">
    {state.goal.hyps.map((hyp, index) => <div className="local-classic-hyp" key={`${hyp.names.join('-')}-${index}`}>
      <span>{hyp.names.join(' ') || '_'}</span>
      <b>:</b>
      <code>{codeText(hyp.type)}</code>
    </div>)}
    <div className="local-classic-turnstile">âŠ¢</div>
    <code className="local-classic-target">{codeText(state.goal.type)}</code>
  </section>
}

/**
 * Local counterpart of the classic NNG level page. The hosted application
 * continues to use Lean's websocket language server; the mounted /lean4game
 * build sends the whole tactic script to the persistent in-browser Lean
 * process and renders the resulting structured proof state.
 */
export default function LocalClassicLevel() {
  const gameId = React.useContext(GameIdContext)
  const params = useParams()
  const worldId = params.worldId ?? ''
  const levelId = Number(params.levelId ?? 0)
  const level = useLoadLevelQuery({ game: gameId, world: worldId, level: levelId })
  const game = useGetGameInfoQuery({ game: gameId })
  const client = React.useMemo(() => new LocalWasmRpcClient(gameId, worldId, levelId), [gameId])
  const [proof, setProof] = React.useState('')
  const [state, setState] = React.useState<ProofState | null>(null)
  const [checking, setChecking] = React.useState(true)
  const [error, setError] = React.useState('')
  const revision = React.useRef(0)

  React.useEffect(() => {
    let active = true
    setProof('')
    setChecking(true)
    setError('')
    client.loadProofState(worldId, levelId).then(next => {
      if (active) setState(next)
    }, reason => {
      if (active) setError(String(reason))
    }).finally(() => {
      if (active) setChecking(false)
    })
    return () => { active = false }
  }, [client, worldId, levelId])

  React.useEffect(() => () => client.close(), [client])

  React.useEffect(() => {
    if (!level.data) return
    const current = ++revision.current
    const timer = window.setTimeout(async () => {
      setChecking(true)
      setError('')
      const next = await client.sendProofUpdate(proof)
      if (current !== revision.current) return
      if (next) setState(next)
      else setError('Lean rejected this proof. Edit the last tactic and try again.')
      setChecking(false)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [client, level.data, proof])

  if (!level.data || !game.data) return <main className="local-classic-loading">Loading levelâ€¦</main>

  const goals = state?.steps.at(-1)?.goals ?? []
  const worldSize = game.data.worldSize?.[worldId] ?? levelId
  const available = [...level.data.tactics, ...level.data.lemmas, ...level.data.definitions]
    .filter(item => !item.locked && !item.hidden)

  return <main className="local-classic-page">
    <header className="local-classic-header">
      <Link to={`/${gameId}`}>Natural Number Game</Link>
      <span>{worldId} World Â· Level {levelId}</span>
      <nav>
        {levelId > 1 && <Link to={`/${gameId}/world/${worldId}/level/${levelId - 1}`}>Previous</Link>}
        {levelId < worldSize && <Link to={`/${gameId}/world/${worldId}/level/${levelId + 1}`}>Next</Link>}
      </nav>
    </header>
    <div className="local-classic-columns">
      <article className="local-classic-lesson">
        <p className="local-classic-kicker">{level.data.displayName ?? level.data.title}</p>
        <h1>{level.data.title}</h1>
        <Markdown>{level.data.introduction ?? ''}</Markdown>
        <pre className="local-classic-statement">{level.data.descrText ?? level.data.descrFormat}</pre>
        {available.length > 0 && <section className="local-classic-inventory">
          <h2>Available tools</h2>
          <div>{available.map(item => <code key={`${item.category}-${item.name}`}>{item.displayName || item.name}</code>)}</div>
        </section>}
      </article>
      <section className="local-classic-workspace">
        <label htmlFor="local-classic-proof">Tactic proof</label>
        <textarea
          id="local-classic-proof"
          value={proof}
          onChange={event => setProof(event.target.value)}
          placeholder="Enter one Lean tactic per lineâ€¦"
          spellCheck={false}
        />
        <div className={`local-classic-status ${state?.completed ? 'is-complete' : ''}`}>
          {checking ? 'Lean is checkingâ€¦' : state?.completed ? 'Proof complete â€” checked by Lean' : error || 'Goals'}
        </div>
        {!state?.completed && goals.map((goal, index) => <Goal key={index} state={goal} />)}
        {state?.completed && level.data.conclusion && <div className="local-classic-conclusion"><Markdown>{level.data.conclusion}</Markdown></div>}
      </section>
    </div>
  </main>
}
