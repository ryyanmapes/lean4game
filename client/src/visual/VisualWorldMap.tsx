/**
 * @fileOverview Visual-mode world map.
 * All levels are always clickable and route to the /visual level page.
 */
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faArrowRightArrowLeft,
  faBars,
  faCircleInfo,
  faDownload,
  faEraser,
  faMoon,
  faSun,
  faUpload,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useAtom } from 'jotai'
import cytoscape from 'cytoscape'

import { GameIdContext } from '../app'
import { PreferencesContext } from '../components/infoview/context'
import { useGetGameInfoQuery } from '../state/api'
import { selectCompleted, selectEntered, selectProgress } from '../state/progress'
import { store } from '../state/store'
import { computeWorldLayout } from '../components/world_tree'
import { plainLevelTitle } from '../components/annotated_level_title'
import { useMapLevelTooltip } from '../components/map_level_tooltip'
import { getDataBaseUrl, getWebsocketUrl } from '../utils/url'
import { navOpenAtom } from '../store/navigation-atoms'
import { popupAtom, PopupType } from '../store/popup-atoms'
import { useAppSelector } from '../hooks'
import { downloadProgress } from '../components/popup/erase'
import { useRetryUntilData } from '../hooks/useRetryUntilData'
import { useTranslation } from 'react-i18next'
import { VISUAL_PROOF_AUTOSAVE_VERSION } from './visualAutosave'
import { computeVisualProgressFrontier } from './visualWorldProgress'
import { getConsentState, setConsent } from '../utils/telemetry'
import './visual.css'

const r = 16
const s = 10
const lineWidth = 10
const ds = 0.75

const NMIN = 5
const NLABEL = 8
const NMAX = 16
const NSPIRAL = 12
const MINFONT = 14

interface VisualMapPalette {
  background: string
  lockedLevel: string
  unlockedLevel: string
  startedLevel: string
  unlockedLevelOutline: string
  completedLevel: string
  lockedWorld: string
  unlockedWorld: string
  completedWorld: string
  lockedLabel: string
  unlockedLabel: string
  completedLabel: string
  lockedPath: string
  unlockedPath: string
}

const DARK_MAP_PALETTE: VisualMapPalette = {
  background: '#0f172a',
  lockedLevel: '#475569',
  unlockedLevel: '#475569',
  startedLevel: '#8b5cf6',
  unlockedLevelOutline: '#8b5cf6',
  completedLevel: '#10b981',
  lockedWorld: '#334155',
  unlockedWorld: '#6d28d9',
  completedWorld: '#059669',
  lockedLabel: '#475569',
  unlockedLabel: '#5b21b6',
  completedLabel: '#047857',
  lockedPath: '#1e293b',
  unlockedPath: '#064e3b',
}

const LIGHT_MAP_PALETTE: VisualMapPalette = {
  background: '#f8fafc',
  lockedLevel: '#94a3b8',
  unlockedLevel: '#cbd5e1',
  startedLevel: '#6366f1',
  unlockedLevelOutline: '#6366f1',
  completedLevel: '#10b981',
  lockedWorld: '#cbd5e1',
  unlockedWorld: '#818cf8',
  completedWorld: '#34d399',
  lockedLabel: '#94a3b8',
  unlockedLabel: '#4f46e5',
  completedLabel: '#059669',
  lockedPath: '#64748b',
  unlockedPath: '#065f46',
}

function toIconProp(icon: unknown): IconProp {
  return icon as IconProp
}

function getViewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function isNng4Game(gameId: string): boolean {
  const parts = gameId.split('/').filter(Boolean)
  return parts[parts.length - 1]?.toLowerCase() === 'nng4'
}

function getVisualMapGameTitle(gameId: string, title?: string | null): string {
  return isNng4Game(gameId) ? 'The Natural Numbers Game' : (title || gameId)
}

function handleMapLinkKeyDown(
  event: React.KeyboardEvent<SVGGElement>,
  onActivate: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onActivate()
  }
}

type MapLevelMode = 'classic' | 'visual'

function VisualLevelIcon({ world, level, displayLevel, visualIndex, position, completed, started, unlocked, worldSize, palette, levelMode, title }: {
  world: string
  level: number
  /** Display index after Visual Lean-only skipped levels are removed. */
  displayLevel: number
  /** Ring position index (1-based, counts only non-skipped levels). */
  visualIndex: number
  position: cytoscape.Position
  completed: boolean
  started: boolean
  unlocked: boolean
  worldSize: number
  palette: VisualMapPalette
  levelMode: MapLevelMode
  title?: string
}) {
  const gameId = React.useContext(GameIdContext)
  const navigate = useNavigate()
  // Keep title modifier emojis, but do not expand them into parenthetical
  // explanations inside the compact map tooltip.
  const levelLabel = plainLevelTitle(title ?? `Level ${displayLevel}`)
  const { tooltip, triggerProps } = useMapLevelTooltip(levelLabel)
  const N = Math.max(worldSize, NMIN)
  const beta = 2 * Math.PI / Math.min(N + 2, ((N < (NMAX + 1) ? NMAX : NSPIRAL) + 1))
  let R = 1.1 * r / Math.sin(beta / 2)

  function betaSpiral(lv: number) {
    return 2 * Math.PI / ((NSPIRAL + 1) + 2 * Math.max(0, (lv - 2)) / (NSPIRAL + 1))
  }

  const x = N < (NMAX + 1)
    ? s * position.x + Math.sin(visualIndex * beta) * R
    : s * position.x + Math.sin(visualIndex * betaSpiral(visualIndex)) * (R + 2 * r * (visualIndex - 1) / (NSPIRAL + 1))
  const y = N < (NMAX + 1)
    ? s * position.y - Math.cos(visualIndex * beta) * R
    : s * position.y - Math.cos(visualIndex * betaSpiral(visualIndex)) * (R + 2 * r * (visualIndex - 1) / (NSPIRAL + 1))

  const fill = completed
    ? palette.completedLevel
    : started
      ? palette.startedLevel
      : unlocked
        ? palette.unlockedLevel
        : palette.lockedLevel
  const stroke = !completed && !started && unlocked ? palette.unlockedLevelOutline : 'none'
  const to = `/${gameId}/world/${world}/level/${level}${levelMode === 'visual' ? '/visual' : ''}`
  return (<>
    <g
      className="level visual-map-link"
      data-map-completed={completed ? 'true' : 'false'}
      role="link"
      tabIndex={0}
      aria-label={`Open ${world} level ${displayLevel}: ${levelLabel}`}
      onClick={() => navigate(to)}
      onKeyDown={(event) => handleMapLinkKeyDown(event, () => navigate(to))}
      {...triggerProps}
    >
      <circle
        className={`level-circle${started ? ' saved-progress' : ''}${!completed && !started && unlocked ? ' unlocked-outline' : ''}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke === 'none' ? 0 : 4}
        cx={x}
        cy={y}
        r={stroke === 'none' ? r : r - 2}
      />
      <foreignObject
        className="level-title-wrapper"
        x={x}
        y={y}
        width={1.42 * r}
        height={1.42 * r}
        transform={`translate(${-0.71 * r},${-0.71 * r})`}
      >
        <div>
          <p className="level-title" style={{ fontSize: `${Math.floor(r)}px` }}>
            {displayLevel}
          </p>
        </div>
      </foreignObject>
    </g>
    {tooltip}
  </>)
}

function endingProgressArc(cx: number, cy: number, radius: number, progress: number) {
  const clamped = Math.max(0, Math.min(1, progress))
  if (clamped <= 0) return null
  if (clamped >= 1) {
    return <circle cx={cx} cy={cy} r={radius} fill="none" stroke="currentColor" strokeWidth={10} />
  }
  const startAngle = -Math.PI / 2
  const endAngle = startAngle + clamped * Math.PI * 2
  const x1 = cx + Math.cos(startAngle) * radius
  const y1 = cy + Math.sin(startAngle) * radius
  const x2 = cx + Math.cos(endAngle) * radius
  const y2 = cy + Math.sin(endAngle) * radius
  const largeArc = clamped > 0.5 ? 1 : 0
  return (
    <path
      d={`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={10}
      strokeLinecap="butt"
    />
  )
}

function VisualEndingWorldIcon({ position, completedLevels, totalLevels, palette }: {
  position: cytoscape.Position
  completedLevels: number
  totalLevels: number
  palette: VisualMapPalette
}) {
  const cx = s * position.x
  const cy = s * position.y
  const radius = 54
  const progress = totalLevels > 0 ? completedLevels / totalLevels : 0
  const complete = totalLevels > 0 && completedLevels === totalLevels
  // The completion page is a sibling static page of this sub-app rather than a
  // router route, so resolve it against the document base instead of navigate().
  const openCompletionPage = () => {
    window.location.href = new URL('../congratulations.html', document.baseURI).href
  }
  return (
    <g
      className={`visual-ending-world${complete ? ' complete visual-map-link' : ' locked'}`}
      data-world-id="Ending"
      role={complete ? 'link' : undefined}
      tabIndex={complete ? 0 : undefined}
      aria-label={complete
        ? `Ending World, all ${totalLevels} levels completed. Open the congratulations page`
        : `Ending World, ${completedLevels} of ${totalLevels} levels completed`}
      aria-disabled={complete ? undefined : 'true'}
      onClick={complete ? openCompletionPage : undefined}
      onKeyDown={complete ? (event) => handleMapLinkKeyDown(event, openCompletionPage) : undefined}
    >
      <circle className="ending-world-background" cx={cx} cy={cy} r={radius + 5} fill={palette.background} />
      <circle
        className="ending-world-hollow"
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={palette.lockedWorld}
        strokeWidth={10}
      />
      <g className="ending-world-progress" style={{ color: complete ? palette.completedWorld : palette.startedLevel }}>
        {endingProgressArc(cx, cy, radius, progress)}
      </g>
      <foreignObject x={cx - 90} y={cy + radius + 18} width="180px" height="3.4em" style={{ overflow: 'visible' }}>
        <div className="world-label ending-world-label" style={{ backgroundColor: palette.lockedLabel }}>
          <p className="world-title" style={{ fontSize: `${MINFONT}px` }}>Ending World</p>
          <p className="ending-world-count">{completedLevels} / {totalLevels}</p>
        </div>
      </foreignObject>
    </g>
  )
}

type WorldLayoutNode = { position: cytoscape.Position; data: { title?: string } }

/** Deliberate NNG4 presentation grid; game dependency data still owns the paths. */
export function applyNng4VisualLayout(
  rawNodes: Record<string, WorldLayoutNode>,
  rawBounds?: { x1: number; x2: number; y1: number; y2: number },
  compact = false,
) {
  const nodes: Record<string, WorldLayoutNode> = { ...rawNodes }
  if (!rawBounds || !rawNodes.Tutorial || !rawNodes.Addition) {
    return { nodes, bounds: rawBounds ? { ...rawBounds } : undefined, endingPosition: null }
  }

  const rawWidth = Math.max(120, rawBounds.x2 - rawBounds.x1)
  const rawCenter = rawBounds.x1 + rawWidth / 2
  const width = compact ? rawWidth * 0.8 : rawWidth
  const left = rawCenter - width / 2
  const center = left + width / 2
  const at = (fraction: number) => left + width * fraction
  const graphHeight = Math.max(180, rawBounds.y2 - rawBounds.y1)
  const rowGap = graphHeight / 4 * (compact ? 0.78 : 1)
  const row = (index: number) => rawBounds.y1 + rowGap * index
  const place = (id: string, x: number, y: number) => {
    if (rawNodes[id]) nodes[id] = { ...rawNodes[id], position: { x, y } }
  }

  place('Tutorial', center, row(0))
  place('Addition', center, row(1))
  place('Multiplication', at(1 / 3), row(2))
  place('Implication', at(2 / 3), row(2))
  place('Power', at(1 / 5), row(3))
  place('AdvAddition', at(2 / 3), row(3))
  place('LessOrEqual', at(2 / 3), row(4))
  place('AdvMultiplication', center, row(5))

  const endingPosition = { x: center, y: row(6) }
  return {
    nodes,
    bounds: { ...rawBounds, x1: left, x2: left + width, y1: row(0), y2: endingPosition.y },
    endingPosition,
  }
}

function hasUnfinishedVisualAutosave(gameId: string, worldId: string, levelId: number): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(`visual-proof-autosave/${gameId}/${worldId}/${levelId}`)
    if (!raw) return false
    const stored = JSON.parse(raw) as {
      version?: unknown
      gameId?: unknown
      worldId?: unknown
      levelId?: unknown
      session?: { version?: unknown; proofBody?: unknown; proofSteps?: unknown }
    }
    return stored.version === VISUAL_PROOF_AUTOSAVE_VERSION &&
      stored.gameId === gameId &&
      stored.worldId === worldId &&
      stored.levelId === levelId &&
      stored.session?.version === VISUAL_PROOF_AUTOSAVE_VERSION &&
      typeof stored.session.proofBody === 'string' &&
      stored.session.proofBody.trim().length > 0 &&
      Array.isArray(stored.session.proofSteps)
  } catch {
    return false
  }
}

function VisualWorldIcon({ world, title, position, completedLevels, nextLevel, worldSize, palette, levelMode }: {
  world: string
  title: string
  position: cytoscape.Position
  completedLevels: boolean[]
  nextLevel: number | null
  worldSize: number
  palette: VisualMapPalette
  levelMode: MapLevelMode
}) {
  const gameId = React.useContext(GameIdContext)
  const navigate = useNavigate()
  const N = Math.max(worldSize, NMIN)
  const betaHalf = Math.PI / Math.min(N + 2, ((N < (NMAX + 1) ? NMAX : NSPIRAL) + 1))
  let R = 1.1 * r / Math.sin(betaHalf) - 1.2 * r
  let labelOffset = R + 2.5 * r

  const unlocked = completedLevels[0]
  const completed = completedLevels.slice(1).every(Boolean)
  const targetLevel = nextLevel ?? 1

  const fill = completed ? palette.completedWorld : unlocked ? palette.unlockedWorld : palette.lockedWorld
  const labelBg = completed ? palette.completedLabel : unlocked ? palette.unlockedLabel : palette.lockedLabel
  const to = `/${gameId}/world/${world}/level/${targetLevel}${levelMode === 'visual' ? '/visual' : ''}`

  return (
    <g
      className="visual-map-link"
      data-world-id={world}
      role="link"
      tabIndex={0}
      aria-label={`Open ${title || world}`}
      onClick={() => navigate(to)}
      onKeyDown={(event) => handleMapLinkKeyDown(event, () => navigate(to))}
    >
      <circle className="world-circle" cx={s * position.x} cy={s * position.y} r={R} fill={fill} />
      <foreignObject
        x={s * position.x - 75}
        y={s * position.y + labelOffset}
        width="150px"
        height="2em"
        style={{ overflow: 'visible' }}
      >
        <div className="world-label" style={{ backgroundColor: labelBg }}>
          <p className="world-title" style={{ fontSize: `${MINFONT}px` }}>
            {title || world}
          </p>
        </div>
      </foreignObject>
    </g>
  )
}

function VisualWorldPath({ source, target, unlocked, palette }: {
  source: { position: cytoscape.Position }
  target: { position: cytoscape.Position }
  unlocked: boolean
  palette: VisualMapPalette
}) {
  return (
    <line
      x1={s * source.position.x}
      y1={s * source.position.y}
      x2={s * target.position.x}
      y2={s * target.position.y}
      stroke={unlocked ? palette.unlockedPath : palette.lockedPath}
      strokeWidth={lineWidth}
    />
  )
}

function VisualMapMenuButton() {
  const [navOpen, setNavOpen] = useAtom(navOpenAtom)
  return (
    <button
      type="button"
      className="visual-map-menu-btn"
      onClick={() => setNavOpen(!navOpen)}
      aria-label="Menu"
    >
      <FontAwesomeIcon icon={toIconProp(navOpen ? faXmark : faBars)} />
    </button>
  )
}

function VisualMapAppBar({
  gameTitle,
  isLightMode,
  onToggleLightMode,
  autoBranchSwitching,
  onToggleAutoBranchSwitching,
}: {
  gameTitle: string
  isLightMode: boolean
  onToggleLightMode: () => void
  autoBranchSwitching: boolean
  onToggleAutoBranchSwitching: () => void
}) {
  const { t } = useTranslation()
  const gameId = React.useContext(GameIdContext)
  const [navOpen, setNavOpen] = useAtom(navOpenAtom)
  const [, setPopup] = useAtom(popupAtom)
  const gameProgress = useAppSelector(selectProgress(gameId))
  const [telemetryEnabled, setTelemetryEnabled] = React.useState(() => getConsentState() === 'accepted')

  function closeMenu() {
    setNavOpen(false)
  }

  return (
    <div className="visual-map-appbar">
      <div className="visual-map-side">
        <a
          className="visual-map-back-btn"
          href="/"
          aria-label={t('Home')}
        >
          <FontAwesomeIcon icon={toIconProp(faArrowLeft)} />
        </a>
      </div>
      <span className="visual-map-title">{gameTitle}</span>
      <div className="visual-map-side visual-map-actions">
        <button
          type="button"
          className={`visual-map-theme-toggle${isLightMode ? ' active' : ''}`}
          onClick={onToggleLightMode}
          aria-pressed={isLightMode}
          aria-label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
          title={isLightMode ? 'Light mode' : 'Dark mode'}
        >
          <FontAwesomeIcon icon={toIconProp(isLightMode ? faSun : faMoon)} />
        </button>
        <VisualMapMenuButton />
      </div>
      <div className={`visual-map-dropdown${navOpen ? ' open' : ''}`}>
        <button onClick={() => { setPopup(PopupType.upload); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faUpload)} />&nbsp;{t('Import')}
        </button>
        <button onClick={(ev) => { downloadProgress(gameId, gameProgress, ev); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faDownload)} />&nbsp;{t('Export')}
        </button>
        <button className="danger" onClick={() => { setPopup(PopupType.erase); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faEraser)} />&nbsp;{t('Reset')}
        </button>
        <button
          type="button"
          className={`visual-map-menu-toggle${autoBranchSwitching ? ' active' : ''}`}
          aria-pressed={autoBranchSwitching}
          onClick={onToggleAutoBranchSwitching}
        >
          <FontAwesomeIcon icon={toIconProp(faArrowRightArrowLeft)} />
          <span>{t('Auto branch switching')}</span>
          <span className="visual-map-toggle-state" aria-hidden="true">{autoBranchSwitching ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className={`visual-map-menu-toggle${telemetryEnabled ? ' active' : ''}`}
          aria-pressed={telemetryEnabled}
          onClick={() => {
            const next = !telemetryEnabled
            setConsent(next)
            setTelemetryEnabled(next)
          }}
        >
          <FontAwesomeIcon icon={toIconProp(faCircleInfo)} />
          <span>{t('Anonymous telemetry')}</span>
          <span className="visual-map-toggle-state" aria-hidden="true">{telemetryEnabled ? 'On' : 'Off'}</span>
        </button>
        <button onClick={() => { setPopup(PopupType.privacy); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faCircleInfo)} />&nbsp;{t('Privacy Policy')}
        </button>
      </div>
    </div>
  )
}

export function VisualWorldMap({ levelMode = 'visual' }: { levelMode?: MapLevelMode }) {
  const gameId = React.useContext(GameIdContext)
  const {
    isVisualLightMode,
    setIsVisualLightMode,
    isVisualAutoBranchSwitching,
    setIsVisualAutoBranchSwitching,
  } = React.useContext(PreferencesContext)
  const gameInfo = useGetGameInfoQuery({ game: gameId })
  useRetryUntilData(gameInfo)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const mapPalette = isVisualLightMode ? LIGHT_MAP_PALETTE : DARK_MAP_PALETTE
  const { worlds, worldSize, skippedLevels, completionNeutralLevels, title } = gameInfo.data ?? {}
  const [levelTitles, setLevelTitles] = React.useState<Record<string, Record<number, string>>>({})
  // Subscribe so completion/import updates redraw the imperative selector results below.
  useAppSelector(selectProgress(gameId))

  React.useEffect(() => {
    if (!worldSize) return
    const controller = new AbortController()
    const base = getDataBaseUrl().replace(/\/$/u, '')
    const requests = Object.entries(worldSize as Record<string, number>).flatMap(([worldId, size]) =>
      Array.from({ length: size }, (_, index) => {
        const level = index + 1
        return fetch(`${base}/${gameId}/level__${worldId}__${level}.json`, { signal: controller.signal })
          .then(response => response.ok ? response.json() : null)
          .then((data: { title?: string } | null) => ({ worldId, level, title: data?.title ?? `Level ${level}` }))
          .catch(() => ({ worldId, level, title: `Level ${level}` }))
      }),
    )
    void Promise.all(requests).then(results => {
      if (controller.signal.aborted) return
      const next: Record<string, Record<number, string>> = {}
      for (const result of results) {
        next[result.worldId] ??= {}
        next[result.worldId]![result.level] = result.title
      }
      setLevelTitles(next)
    })
    return () => controller.abort()
  }, [gameId, worldSize])

  const [viewportSize, setViewportSize] = React.useState(getViewportSize)
  const [phoneScrollbarGutter, setPhoneScrollbarGutter] = React.useState(0)
  const isPhonePortraitViewport = viewportSize.width <= 720 && viewportSize.height >= viewportSize.width
  React.useEffect(() => {
    const onResize = () => {
      const next = getViewportSize()
      setViewportSize(next)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const rawLayout: { nodes: Record<string, { position: cytoscape.Position; data: { title?: string } }>; bounds?: { x1: number; x2: number; y1: number; y2: number } } =
    worlds ? computeWorldLayout(worlds) : { nodes: {} }

  const arrangedLayout = isNng4Game(gameId)
    ? applyNng4VisualLayout(rawLayout.nodes, rawLayout.bounds, isPhonePortraitViewport)
    : { nodes: { ...rawLayout.nodes }, bounds: rawLayout.bounds ? { ...rawLayout.bounds } : undefined, endingPosition: null }
  const nodes = arrangedLayout.nodes
  const endingPosition = arrangedLayout.endingPosition

  const isSkipped = (worldId: string, level: number) =>
    skippedLevels?.[worldId]?.includes(level) ?? false

  const visibleCount = (worldId: string) => {
    const total = worldSize?.[worldId] ?? 0
    return total - (skippedLevels?.[worldId]?.length ?? 0)
  }

  // Hidden/skipped worlds must not reserve empty horizontal space on phones.
  // Fit the portrait viewBox to the worlds that are actually painted, while
  // retaining the original vertical bounds and orbit padding.
  const bounds = (() => {
    const layoutBounds = arrangedLayout.bounds
    if (!layoutBounds || !isPhonePortraitViewport) return layoutBounds
    const visibleNodes = Object.entries(nodes)
      .filter(([worldId]) => visibleCount(worldId) > 0)
    const visibleX = visibleNodes.map(([, node]) => node.position.x)
    if (endingPosition) visibleX.push(endingPosition.x)
    if (visibleX.length === 0) return layoutBounds
    // The NNG tree is intentionally asymmetric below its root. Fitting the
    // raw extrema therefore shifts the Tutorial world away from the centre of
    // a phone even though the whole graph fits. Keep the fitted horizontal
    // range symmetric around the first/root world; vertical scrolling still
    // follows the player's current progress.
    const firstWorldX = nodes.Tutorial?.position.x
      ?? visibleNodes
        .slice()
        .sort(([, left], [, right]) => left.position.y - right.position.y)[0]?.[1].position.x
      ?? (Math.min(...visibleX) + Math.max(...visibleX)) / 2
    const halfWidth = Math.max(...visibleX.map(x => Math.abs(x - firstWorldX)))
    return {
      ...layoutBounds,
      x1: firstWorldX - halfWidth,
      x2: firstWorldX + halfWidth,
    }
  })()

  const completed: Record<string, boolean[]> = {}
  const started: Record<string, boolean[]> = {}
  const svgElements: React.ReactNode[] = []

  if (worlds && worldSize) {
    const worldIds = Object.keys(nodes)
    const progressFrontier = computeVisualProgressFrontier({
      worldIds,
      edges: worlds.edges,
      worldSizes: worldSize,
      skippedLevels: skippedLevels ?? {},
      completionNeutralLevels: completionNeutralLevels ?? {},
      isCompleted: (worldId, level) => selectCompleted(gameId, worldId, level)(store.getState()),
      isEntered: (worldId, level) => selectEntered(gameId, worldId, level)(store.getState()),
    })

    for (const worldId of worldIds) {
      completed[worldId] = progressFrontier.completedLevels[worldId]
      started[worldId] = Array.from({ length: worldSize[worldId] + 1 }, (_, i) =>
        i > 0 && !progressFrontier.mapCompletedLevels[worldId][i] && hasUnfinishedVisualAutosave(gameId, worldId, i),
      )
    }

    for (const edge of worlds.edges) {
      const sourceCompleted = completed[edge[0]].slice(1).every(Boolean)
      if (!sourceCompleted) completed[edge[1]][0] = false
      // Don't draw paths to/from fully-hidden worlds.
      if (visibleCount(edge[0]) === 0 || visibleCount(edge[1]) === 0) continue
      svgElements.push(
        <VisualWorldPath
          key={`path_${edge[0]}-->${edge[1]}`}
          source={nodes[edge[0]]}
          target={nodes[edge[1]]}
          unlocked={sourceCompleted}
          palette={mapPalette}
        />,
      )
    }

    const totalVisibleLevels = Object.keys(nodes).reduce(
      (total, worldId) => total + visibleCount(worldId) - (completionNeutralLevels?.[worldId]?.length ?? 0),
      0,
    )
    const totalCompletedLevels = Object.keys(nodes).reduce(
      (total, worldId) => total + progressFrontier.actualCompletedLevels[worldId]
        .slice(1)
        .filter((done, index) => done && !(skippedLevels?.[worldId]?.includes(index + 1) ?? false) &&
          !(completionNeutralLevels?.[worldId]?.includes(index + 1) ?? false)).length,
      0,
    )

    if (endingPosition && nodes.Power && nodes.AdvMultiplication) {
      svgElements.push(
        <VisualWorldPath
          key="path_Power-->Ending"
          source={nodes.Power}
          target={{ position: endingPosition }}
          unlocked={completed.Power.slice(1).every(Boolean)}
          palette={mapPalette}
        />,
        <VisualWorldPath
          key="path_AdvMultiplication-->Ending"
          source={nodes.AdvMultiplication}
          target={{ position: endingPosition }}
          unlocked={completed.AdvMultiplication.slice(1).every(Boolean)}
          palette={mapPalette}
        />,
      )
    }

    for (const worldId in nodes) {
      // Hide worlds where every level is skipped.
      if (visibleCount(worldId) === 0) continue

      const position = nodes[worldId].position
      svgElements.push(
        <VisualWorldIcon
          key={`world-${worldId}`}
          world={worldId}
          title={nodes[worldId].data.title || worldId}
          position={position}
          completedLevels={completed[worldId]}
          nextLevel={progressFrontier.nextLevels[worldId]}
          worldSize={visibleCount(worldId)}
          palette={mapPalette}
          levelMode={levelMode}
        />,
      )
      let visualIndex = 0
      for (let i = 1; i <= worldSize[worldId]; i++) {
        if (isSkipped(worldId, i)) continue
        visualIndex++
        svgElements.push(
          <VisualLevelIcon
            key={`level-${worldId}-${i}`}
            world={worldId}
            level={i}
            displayLevel={visualIndex}
            visualIndex={visualIndex}
            position={position}
            completed={progressFrontier.mapCompletedLevels[worldId][i]}
            started={started[worldId][i]}
            unlocked={progressFrontier.highlightedLevels[worldId] === i ||
              ((completionNeutralLevels?.[worldId]?.includes(i) ?? false) && completed[worldId][i - 1])}
            worldSize={visibleCount(worldId)}
            palette={mapPalette}
            levelMode={levelMode}
            title={levelTitles[worldId]?.[i]}
          />,
        )
      }
    }

    if (endingPosition) {
      svgElements.push(
        <VisualEndingWorldIcon
          key="world-Ending"
          position={endingPosition}
          completedLevels={totalCompletedLevels}
          totalLevels={totalVisibleLevels}
          palette={mapPalette}
        />,
      )
    }
  }

  const rememberedWorld = typeof window === 'undefined'
    ? null
    : window.sessionStorage.getItem(`visual-map-focus:${gameId}`)
  const visibleWorldIds = Object.keys(nodes)
    .filter(worldId => visibleCount(worldId) > 0)
    .sort((left, right) => {
      const vertical = nodes[left].position.y - nodes[right].position.y
      return vertical !== 0 ? vertical : nodes[left].position.x - nodes[right].position.x
    })
  const focusWorldId = rememberedWorld && visibleWorldIds.includes(rememberedWorld)
    ? rememberedWorld
    : visibleWorldIds.find(worldId => completed[worldId]?.slice(1).some(done => !done))
      ?? visibleWorldIds[0]

  let R = 1.1 * r / Math.sin(Math.PI / (NMAX + 1))
  const padding = R + 2.1 * r
  const hPadding = isPhonePortraitViewport ? R + 0.55 * r : padding + 80

  const contentDx = bounds ? s * (bounds.x2 - bounds.x1) + 2 * hPadding : null
  const naturalSvgDisplayWidth = contentDx != null ? ds * contentDx : null
  // Phone portrait fits the entire graph width into one fixed horizontal span;
  // navigation is vertical-only. Desktop/tablet retain their fill-width view.
  const svgDisplayWidth = contentDx != null && naturalSvgDisplayWidth != null
    ? isPhonePortraitViewport
      // Account for the map's horizontal padding and the vertical scrollbar.
      // Using the raw viewport width leaves genuine horizontal overflow once
      // both are present on a narrow mobile browser.
      ? Math.max(0, viewportSize.width - 16)
      : Math.max(naturalSvgDisplayWidth, viewportSize.width)
    : null
  const extraViewBoxUnits = (!isPhonePortraitViewport && svgDisplayWidth != null && contentDx != null && naturalSvgDisplayWidth != null)
    ? (svgDisplayWidth - naturalSvgDisplayWidth) / ds
    : 0
  const dx = contentDx != null ? contentDx + extraViewBoxUnits : null
  // Shift the drawing inside the fixed-width SVG rather than translating the
  // SVG box itself. A CSS transform centred the root but made the transformed
  // edge contribute horizontal overflow on narrow browsers.
  const phoneViewBoxShift = isPhonePortraitViewport
    && phoneScrollbarGutter > 0
    && dx != null
    && svgDisplayWidth != null
    ? phoneScrollbarGutter * dx / (2 * svgDisplayWidth)
    : 0

  React.useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl || !isPhonePortraitViewport) {
      setPhoneScrollbarGutter(0)
      return
    }
    // Flex centring uses the scroll area's content box, which excludes a
    // classic vertical scrollbar. Compensate by half of that measured gutter
    // so the root world is centred in the full phone viewport as well.
    const gutter = Math.max(0, scrollEl.offsetWidth - scrollEl.clientWidth)
    setPhoneScrollbarGutter(current => current === gutter ? current : gutter)
  }, [bounds, isPhonePortraitViewport, svgDisplayWidth, viewportSize])

  const appliedFocusRef = React.useRef<string | null>(null)
  const focusMap = React.useCallback(() => {
    const scrollEl = scrollRef.current
    const svgEl = svgRef.current
    if (!scrollEl || !svgEl) return false

    if (!isPhonePortraitViewport || !focusWorldId) {
      const maxScrollLeft = scrollEl.scrollWidth - scrollEl.clientWidth
      if (maxScrollLeft > 0) scrollEl.scrollLeft = maxScrollLeft / 2
      return true
    }

    const target = Array.from(svgEl.querySelectorAll<SVGGElement>('[data-world-id]'))
      .find(element => element.dataset.worldId === focusWorldId)
    if (!target) return false
    const scrollRect = scrollEl.getBoundingClientRect()
    // A world group also contains its orbiting level dots and label, so its
    // bounding-box centre is not the visual centre of the world itself.
    const targetRect = (target.querySelector<SVGGraphicsElement>('.world-circle') ?? target)
      .getBoundingClientRect()
    // Horizontal placement is fixed: the fitted SVG always shows the complete
    // graph width, so only move to the requested world's vertical position.
    scrollEl.scrollLeft = 0
    scrollEl.scrollTop += targetRect.top + targetRect.height / 2 - (scrollRect.top + scrollRect.height / 2)
    scrollEl.dataset.focusWorld = focusWorldId
    return true
  }, [focusWorldId, isPhonePortraitViewport])

  React.useLayoutEffect(() => {
    if (!bounds) return
    const focusKey = `${isPhonePortraitViewport ? 'phone' : 'wide'}:${focusWorldId ?? 'center'}`
    if (appliedFocusRef.current === focusKey) return
    let secondRaf = 0
    const firstRaf = window.requestAnimationFrame(() => {
      secondRaf = window.requestAnimationFrame(() => {
        if (focusMap()) appliedFocusRef.current = focusKey
      })
    })
    return () => {
      window.cancelAnimationFrame(firstRaf)
      window.cancelAnimationFrame(secondRaf)
    }
  }, [bounds, dx, focusMap, focusWorldId, isPhonePortraitViewport])

  React.useEffect(() => {
    if (!gameInfo.data) return

    const warmedKey = `visual-ws-auth-warmed:${gameId}`
    if (window.sessionStorage.getItem(warmedKey) === '1') return

    const controller = new AbortController()
    const warmUrl = new URL(getWebsocketUrl(gameId))
    warmUrl.protocol = window.location.protocol

    void fetch(warmUrl.toString(), {
      method: 'HEAD',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(() => {
        if (!controller.signal.aborted) {
          window.sessionStorage.setItem(warmedKey, '1')
        }
      })
      .catch(() => {
        // Ignore warm-up failures; the real websocket request still handles retries.
      })

    return () => controller.abort()
  }, [gameId, gameInfo.data])

  if (!gameInfo.data) {
    return (
      <div className="visual-page visual-map-page">
        <Box display="flex" alignItems="center" justifyContent="center" sx={{ height: '100vh' }}>
          <CircularProgress sx={{ color: mapPalette.unlockedLevel }} />
        </Box>
      </div>
    )
  }

  return (
    <div className="visual-page visual-map-page">
      <VisualMapAppBar
        gameTitle={getVisualMapGameTitle(gameId, title)}
        isLightMode={isVisualLightMode}
        onToggleLightMode={() => setIsVisualLightMode(!isVisualLightMode)}
        autoBranchSwitching={isVisualAutoBranchSwitching}
        onToggleAutoBranchSwitching={() => setIsVisualAutoBranchSwitching(!isVisualAutoBranchSwitching)}
      />
      <div className="visual-map-scroll" ref={scrollRef} data-testid="visual-world-map">
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          xmlnsXlink="http://www.w3.org/1999/xlink"
          width={svgDisplayWidth ?? ''}
          viewBox={bounds
            ? `${s * bounds.x1 - hPadding - extraViewBoxUnits / 2 - phoneViewBoxShift} ${s * bounds.y1 - padding} ${dx} ${s * (bounds.y2 - bounds.y1) + 2 * padding}`
            : ''}
          className="visual-map-svg world-selection"
        >
          {svgElements}
        </svg>
      </div>
    </div>
  )
}

export default VisualWorldMap
