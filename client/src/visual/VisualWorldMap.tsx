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
  faBars,
  faCircleInfo,
  faDownload,
  faEraser,
  faGear,
  faLock,
  faLockOpen,
  faSun,
  faUpload,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useAtom } from 'jotai'
import cytoscape from 'cytoscape'

import { GameIdContext } from '../app'
import { PreferencesContext } from '../components/infoview/context'
import { useGetGameInfoQuery } from '../state/api'
import { selectCompleted, selectProgress, selectUnlockLevels, changeUnlockLevels } from '../state/progress'
import { store } from '../state/store'
import { computeWorldLayout } from '../components/world_tree'
import { navOpenAtom } from '../store/navigation-atoms'
import { popupAtom, PopupType } from '../store/popup-atoms'
import { useAppDispatch, useAppSelector } from '../hooks'
import { saveState } from '../state/local_storage'
import { downloadProgress } from '../components/popup/erase'
import { useRetryUntilData } from '../hooks/useRetryUntilData'
import { useTranslation } from 'react-i18next'
import { getWebsocketUrl } from '../utils/url'
import { titleCaseLevel } from './VisualHeader'
import './visual.css'

const r = 16
const s = 10
const lineWidth = 10
const ds = 0.75

const NMIN = 5
const NLABEL = 8
const NMAX = 16
const NSPIRAL = 12
const MINFONT = 12
const LEVEL_TOOLTIP_SCREEN_FONT_SIZE = 12
const LEVEL_TOOLTIP_FONT_SIZE = LEVEL_TOOLTIP_SCREEN_FONT_SIZE / ds
const LEVEL_TOOLTIP_FONT_FAMILY = "'Inter', system-ui, -apple-system, sans-serif"
const LEVEL_TOOLTIP_FONT = `${LEVEL_TOOLTIP_SCREEN_FONT_SIZE}px ${LEVEL_TOOLTIP_FONT_FAMILY}`
const LEVEL_TOOLTIP_PAD_X = 10 / ds
const LEVEL_TOOLTIP_HEIGHT = 26 / ds

let levelTooltipMeasureCanvas: HTMLCanvasElement | null = null

function measureLevelTooltipText(text: string): number {
  if (typeof document === 'undefined') {
    return text.length * LEVEL_TOOLTIP_SCREEN_FONT_SIZE * 0.58 / ds
  }

  levelTooltipMeasureCanvas ??= document.createElement('canvas')
  const context = levelTooltipMeasureCanvas.getContext('2d')
  if (!context) {
    return text.length * LEVEL_TOOLTIP_SCREEN_FONT_SIZE * 0.58 / ds
  }

  context.font = LEVEL_TOOLTIP_FONT
  return context.measureText(text).width / ds
}

interface VisualMapPalette {
  lockedLevel: string
  unlockedLevel: string
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
  lockedLevel: '#475569',
  unlockedLevel: '#8b5cf6',
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
  lockedLevel: '#94a3b8',
  unlockedLevel: '#6366f1',
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

interface LevelTooltipInfo {
  x: number
  y: number
  title: string
  isRight: boolean
}

function VisualLevelIcon({ world, level, displayLevel, visualIndex, position, completed, unlocked, worldSize, palette, title, onHoverChange }: {
  world: string
  level: number
  /** Display index after Visual Lean-only skipped levels are removed. */
  displayLevel: number
  /** Ring position index (1-based, counts only non-skipped levels). */
  visualIndex: number
  position: cytoscape.Position
  completed: boolean
  unlocked: boolean
  worldSize: number
  palette: VisualMapPalette
  title?: string
  onHoverChange?: (info: LevelTooltipInfo | null) => void
}) {
  const gameId = React.useContext(GameIdContext)
  const navigate = useNavigate()
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

  const fill = completed ? palette.completedLevel : unlocked ? palette.unlockedLevel : palette.lockedLevel
  const to = `/${gameId}/world/${world}/level/${level}/visual`
  const isRight = x >= s * position.x

  return (
    <g
      className="level visual-map-link"
      role="link"
      tabIndex={0}
      aria-label={`Open ${world} level ${displayLevel}`}
      onClick={() => navigate(to)}
      onKeyDown={(event) => handleMapLinkKeyDown(event, () => navigate(to))}
      onMouseEnter={() => onHoverChange?.({ x, y, title: title ?? `Level ${displayLevel}`, isRight })}
      onMouseLeave={() => onHoverChange?.(null)}
    >
      <circle fill={fill} cx={x} cy={y} r={r} />
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
  )
}

function VisualWorldIcon({ world, title, position, completedLevels, worldSize, palette }: {
  world: string
  title: string
  position: cytoscape.Position
  completedLevels: boolean[]
  worldSize: number
  palette: VisualMapPalette
}) {
  const gameId = React.useContext(GameIdContext)
  const navigate = useNavigate()
  const N = Math.max(worldSize, NMIN)
  const betaHalf = Math.PI / Math.min(N + 2, ((N < (NMAX + 1) ? NMAX : NSPIRAL) + 1))
  let R = 1.1 * r / Math.sin(betaHalf) - 1.2 * r
  let labelOffset = R + 2.5 * r

  const unlocked = completedLevels[0]
  const completed = completedLevels.slice(1).every(Boolean)
  let nextLevel: number = completedLevels.findIndex(c => !c)
  if (nextLevel <= 1) nextLevel = 1

  const fill = completed ? palette.completedWorld : unlocked ? palette.unlockedWorld : palette.lockedWorld
  const labelBg = completed ? palette.completedLabel : unlocked ? palette.unlockedLabel : palette.lockedLabel
  const to = `/${gameId}/world/${world}/level/${nextLevel}/visual`

  return (
    <g
      className="visual-map-link"
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
}: {
  gameTitle: string
  isLightMode: boolean
  onToggleLightMode: () => void
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const gameId = React.useContext(GameIdContext)
  const [navOpen, setNavOpen] = useAtom(navOpenAtom)
  const [, setPopup] = useAtom(popupAtom)
  const dispatch = useAppDispatch()
  const unlockLevels = useAppSelector(selectUnlockLevels(gameId))
  const gameProgress = useAppSelector(selectProgress(gameId))

  function closeMenu() {
    setNavOpen(false)
  }

  function toggleUnlockLevels() {
    dispatch(changeUnlockLevels({ game: gameId, unlockLevels: !unlockLevels }))
    saveState(store.getState().progress)
    window.location.reload()
  }

  return (
    <div className="visual-map-appbar">
      <div className="visual-map-side">
        <button
          type="button"
          className="visual-map-back-btn"
          onClick={() => navigate('/')}
          title={t('Home')}
          aria-label={t('Home')}
        >
          <FontAwesomeIcon icon={toIconProp(faArrowLeft)} />
        </button>
      </div>
      <span className="visual-map-title">{gameTitle}</span>
      <div className="visual-map-side visual-map-actions">
        <button
          type="button"
          className={`visual-map-theme-toggle${isLightMode ? ' active' : ''}`}
          onClick={onToggleLightMode}
          aria-pressed={isLightMode}
          title={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
          aria-label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          <FontAwesomeIcon icon={toIconProp(faSun)} />
          <span className="visual-map-theme-label">Light</span>
        </button>
        <VisualMapMenuButton />
      </div>
      <div className={`visual-map-dropdown${navOpen ? ' open' : ''}`}>
        <button onClick={() => { setPopup(PopupType.info); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faCircleInfo)} />&nbsp;{t('Game Info')}
        </button>
        <button onClick={(ev) => { downloadProgress(gameId, gameProgress, ev); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faDownload)} />&nbsp;{t('Download')}
        </button>
        <button onClick={() => { setPopup(PopupType.upload); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faUpload)} />&nbsp;{t('Upload')}
        </button>
        <button onClick={toggleUnlockLevels} className={unlockLevels ? 'active' : ''}>
          <FontAwesomeIcon icon={toIconProp(unlockLevels ? faLockOpen : faLock)} />&nbsp;{t('Unlock levels')}
        </button>
        <button onClick={() => { setPopup(PopupType.erase); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faEraser)} />&nbsp;{t('Erase')}
        </button>
        <button onClick={() => { setPopup(PopupType.preferences); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faGear)} />&nbsp;{t('Preferences')}
        </button>
        <button onClick={() => { setPopup(PopupType.impressum); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faCircleInfo)} />&nbsp;{t('Impressum')}
        </button>
        <button onClick={() => { setPopup(PopupType.privacy); closeMenu() }}>
          <FontAwesomeIcon icon={toIconProp(faCircleInfo)} />&nbsp;{t('Privacy Policy')}
        </button>
      </div>
    </div>
  )
}

export function VisualWorldMap() {
  const gameId = React.useContext(GameIdContext)
  const { isVisualLightMode, setIsVisualLightMode } = React.useContext(PreferencesContext)
  const gameInfo = useGetGameInfoQuery({ game: gameId })
  useRetryUntilData(gameInfo)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const mapPalette = isVisualLightMode ? LIGHT_MAP_PALETTE : DARK_MAP_PALETTE
  const { worlds, worldSize, skippedLevels, title } = gameInfo.data ?? {}

  const [levelTitles, setLevelTitles] = React.useState<Record<string, Record<number, string>>>({})
  const [levelTooltip, setLevelTooltip] = React.useState<LevelTooltipInfo | null>(null)
  const [viewportSize, setViewportSize] = React.useState(getViewportSize)
  React.useEffect(() => {
    const onResize = () => setViewportSize(getViewportSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  React.useEffect(() => {
    if (!gameInfo.data?.worldSize) return
    const ws = gameInfo.data.worldSize as Record<string, number>
    const promises = Object.entries(ws).flatMap(([worldId, size]) =>
      Array.from({ length: size }, (_, i) => {
        const level = i + 1
        return fetch(`/data/${gameId}/level__${worldId}__${level}.json`)
          .then(r => r.json())
          .then((d: { title?: string }) => ({ worldId, level, title: d.title ? titleCaseLevel(d.title) : `Level ${level}` }))
          .catch(() => ({ worldId, level, title: `Level ${level}` }))
      })
    )
    Promise.all(promises).then(results => {
      const titles: Record<string, Record<number, string>> = {}
      results.forEach(({ worldId, level, title: t }) => {
        titles[worldId] = titles[worldId] ?? {}
        titles[worldId][level] = t
      })
      setLevelTitles(titles)
    })
  }, [gameId, gameInfo.data])
  const rawLayout: { nodes: Record<string, { position: cytoscape.Position; data: { title?: string } }>; bounds?: { x1: number; x2: number; y1: number; y2: number } } =
    worlds ? computeWorldLayout(worlds) : { nodes: {} }

  // NNG4-specific position overrides: straighten the center column and balance the branches.
  // rawNodes positions come from klay; we override x only, keeping klay's y ordering.
  const rawNodes = rawLayout.nodes
  const nodes: typeof rawNodes = { ...rawNodes }
  // bounds may need expanding if an override moves a node outside the klay bounding box.
  let bounds = rawLayout.bounds ? { ...rawLayout.bounds } : undefined

  // Center column: Tutorial and Addition align with klay's LessOrEqual x (the convergence point).
  if (rawNodes['Tutorial'] && rawNodes['LessOrEqual']) {
    nodes['Tutorial'] = { ...rawNodes['Tutorial'], position: { ...rawNodes['Tutorial'].position, x: rawNodes['LessOrEqual'].position.x } }
  }
  if (rawNodes['Addition'] && rawNodes['LessOrEqual']) {
    nodes['Addition'] = { ...rawNodes['Addition'], position: { ...rawNodes['Addition'].position, x: rawNodes['LessOrEqual'].position.x } }
  }
  // Right column: Implication and LessOrEqual align with AdvAddition.
  if (rawNodes['Implication'] && rawNodes['AdvAddition']) {
    nodes['Implication'] = { ...rawNodes['Implication'], position: { ...rawNodes['Implication'].position, x: rawNodes['AdvAddition'].position.x } }
  }
  if (rawNodes['LessOrEqual'] && rawNodes['AdvAddition']) {
    nodes['LessOrEqual'] = { ...rawNodes['LessOrEqual'], position: { ...rawNodes['LessOrEqual'].position, x: rawNodes['AdvAddition'].position.x } }
  }
  // Left column: Power shifts further left of Multiplication so it doesn't crowd it.
  // Expand bounds.x1 so the SVG viewBox isn't clipped.
  if (rawNodes['Power'] && rawNodes['Multiplication'] && rawNodes['LessOrEqual']) {
    const colSpan = rawNodes['LessOrEqual'].position.x - rawNodes['Multiplication'].position.x
    const newPowerX = rawNodes['Multiplication'].position.x - colSpan * 0.4
    nodes['Power'] = { ...rawNodes['Power'], position: { ...rawNodes['Power'].position, x: newPowerX } }
    if (bounds && newPowerX < bounds.x1) bounds = { ...bounds, x1: newPowerX }
  }

  const isSkipped = (worldId: string, level: number) =>
    skippedLevels?.[worldId]?.includes(level) ?? false

  const visibleCount = (worldId: string) => {
    const total = worldSize?.[worldId] ?? 0
    return total - (skippedLevels?.[worldId]?.length ?? 0)
  }

  const completed: Record<string, boolean[]> = {}
  const svgElements: React.ReactNode[] = []

  if (worlds && worldSize) {
    for (const worldId in nodes) {
      // Treat skipped levels as completed so they don't block world unlock/completion.
      completed[worldId] = Array.from({ length: worldSize[worldId] + 1 }, (_, i) =>
        i === 0 || isSkipped(worldId, i) || selectCompleted(gameId, worldId, i)(store.getState()),
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
          worldSize={visibleCount(worldId)}
          palette={mapPalette}
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
            completed={completed[worldId][i]}
            unlocked={completed[worldId][i - 1]}
            worldSize={visibleCount(worldId)}
            palette={mapPalette}
            title={levelTitles[worldId]?.[i]}
            onHoverChange={setLevelTooltip}
          />,
        )
      }
    }
  }

  let R = 1.1 * r / Math.sin(Math.PI / (NMAX + 1))
  const padding = R + 2.1 * r
  // Extra horizontal space so tooltips on edge-of-map levels aren't clipped.
  const hPadding = padding + 250

  // Tooltip rendered last so it appears above all other SVG elements.
  if (levelTooltip) {
    const { x: tx, y: ty, title: tooltipText, isRight } = levelTooltip
    const tooltipW = Math.ceil(measureLevelTooltipText(tooltipText) + 2 * LEVEL_TOOLTIP_PAD_X)
    const tooltipH = LEVEL_TOOLTIP_HEIGHT
    const tooltipX = isRight ? tx + r + 5 : tx - r - 5 - tooltipW
    const tooltipY = ty - tooltipH / 2
    svgElements.push(
      <g key="level-tooltip" style={{ pointerEvents: 'none' }}>
        <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={4}
          fill="rgba(15,23,42,0.93)" stroke="rgba(148,163,184,0.28)" strokeWidth={1} />
        <text
          x={isRight ? tooltipX + LEVEL_TOOLTIP_PAD_X : tooltipX + tooltipW - LEVEL_TOOLTIP_PAD_X}
          y={tooltipY + tooltipH / 2 + 4}
          textAnchor={isRight ? 'start' : 'end'}
          fill="#e2e8f0"
          fontSize={LEVEL_TOOLTIP_FONT_SIZE}
          fontFamily={LEVEL_TOOLTIP_FONT_FAMILY}
        >{tooltipText}</text>
      </g>,
    )
  }

  const contentDx = bounds ? s * (bounds.x2 - bounds.x1) + 2 * hPadding : null
  const isPhonePortraitViewport = viewportSize.width <= 720 && viewportSize.height >= viewportSize.width
  const naturalSvgDisplayWidth = contentDx != null ? ds * contentDx : null
  const phoneMapScale = 2.55
  // Desktop/tablet fill width by adding viewBox padding. Phone portrait should instead scale
  // the map itself so the world nodes remain tappable and the page scrolls vertically.
  const svgDisplayWidth = contentDx != null && naturalSvgDisplayWidth != null
    ? isPhonePortraitViewport
      ? Math.max(naturalSvgDisplayWidth * phoneMapScale, viewportSize.width * 1.95)
      : Math.max(naturalSvgDisplayWidth, viewportSize.width)
    : null
  const extraViewBoxUnits = (!isPhonePortraitViewport && svgDisplayWidth != null && contentDx != null && naturalSvgDisplayWidth != null)
    ? (svgDisplayWidth - naturalSvgDisplayWidth) / ds
    : 0
  const dx = contentDx != null ? contentDx + extraViewBoxUnits : null

  const centerMapHorizontally = React.useCallback(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const maxScrollLeft = scrollEl.scrollWidth - scrollEl.clientWidth
    if (maxScrollLeft <= 0) return
    scrollEl.scrollLeft = maxScrollLeft / 2
  }, [])

  React.useLayoutEffect(() => {
    if (!bounds) return
    const rafId = window.requestAnimationFrame(centerMapHorizontally)
    return () => window.cancelAnimationFrame(rafId)
  }, [bounds, dx, centerMapHorizontally])

  React.useEffect(() => {
    if (!bounds) return

    const handleResize = () => centerMapHorizontally()
    window.addEventListener('resize', handleResize)

    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', handleResize)
    }

    const observer = new ResizeObserver(() => centerMapHorizontally())
    if (scrollRef.current) observer.observe(scrollRef.current)
    if (svgRef.current) observer.observe(svgRef.current)

    return () => {
      window.removeEventListener('resize', handleResize)
      observer.disconnect()
    }
  }, [bounds, centerMapHorizontally])

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
      />
      <div className="visual-map-scroll" ref={scrollRef}>
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          xmlnsXlink="http://www.w3.org/1999/xlink"
          width={svgDisplayWidth ?? ''}
          viewBox={bounds
            ? `${s * bounds.x1 - hPadding - extraViewBoxUnits / 2} ${s * bounds.y1 - padding} ${dx} ${s * (bounds.y2 - bounds.y1) + 2 * padding}`
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
