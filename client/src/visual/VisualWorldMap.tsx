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
  lockedPath: '#475569',
  unlockedPath: '#10b981',
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
  lockedPath: '#cbd5e1',
  unlockedPath: '#34d399',
}

function toIconProp(icon: unknown): IconProp {
  return icon as IconProp
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

function VisualLevelIcon({ world, level, position, completed, unlocked, worldSize, palette }: {
  world: string
  level: number
  position: cytoscape.Position
  completed: boolean
  unlocked: boolean
  worldSize: number
  palette: VisualMapPalette
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
    ? s * position.x + Math.sin(level * beta) * R
    : s * position.x + Math.sin(level * betaSpiral(level)) * (R + 2 * r * (level - 1) / (NSPIRAL + 1))
  const y = N < (NMAX + 1)
    ? s * position.y - Math.cos(level * beta) * R
    : s * position.y - Math.cos(level * betaSpiral(level)) * (R + 2 * r * (level - 1) / (NSPIRAL + 1))

  const fill = completed ? palette.completedLevel : unlocked ? palette.unlockedLevel : palette.lockedLevel
  const to = `/${gameId}/world/${world}/level/${level}/visual`

  return (
    <g
      className="level visual-map-link"
      role="link"
      tabIndex={0}
      aria-label={`Open ${world} level ${level}`}
      onClick={() => navigate(to)}
      onKeyDown={(event) => handleMapLinkKeyDown(event, () => navigate(to))}
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
            {level}
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
  const { worlds, worldSize, title } = gameInfo.data ?? {}
  const { nodes, bounds }: { nodes: Record<string, { position: cytoscape.Position; data: { title?: string } }>; bounds?: { x1: number; x2: number; y1: number; y2: number } } =
    worlds ? computeWorldLayout(worlds) : { nodes: {} }

  const completed: Record<string, boolean[]> = {}
  const svgElements: React.ReactNode[] = []

  if (worlds && worldSize) {
    for (const worldId in nodes) {
      completed[worldId] = Array.from({ length: worldSize[worldId] + 1 }, (_, i) =>
        i === 0 || selectCompleted(gameId, worldId, i)(store.getState()),
      )
    }

    for (const edge of worlds.edges) {
      const sourceCompleted = completed[edge[0]].slice(1).every(Boolean)
      if (!sourceCompleted) completed[edge[1]][0] = false
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
      const position = nodes[worldId].position
      svgElements.push(
        <VisualWorldIcon
          key={`world-${worldId}`}
          world={worldId}
          title={nodes[worldId].data.title || worldId}
          position={position}
          completedLevels={completed[worldId]}
          worldSize={worldSize[worldId]}
          palette={mapPalette}
        />,
      )
      for (let i = 1; i <= worldSize[worldId]; i++) {
        svgElements.push(
          <VisualLevelIcon
            key={`level-${worldId}-${i}`}
            world={worldId}
            level={i}
            position={position}
            completed={completed[worldId][i]}
            unlocked={completed[worldId][i - 1]}
            worldSize={worldSize[worldId]}
            palette={mapPalette}
          />,
        )
      }
    }
  }

  let R = 1.1 * r / Math.sin(Math.PI / (NMAX + 1))
  const padding = R + 2.1 * r
  const dx = bounds ? s * (bounds.x2 - bounds.x1) + 2 * padding : null

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
        gameTitle={title || gameId}
        isLightMode={isVisualLightMode}
        onToggleLightMode={() => setIsVisualLightMode(!isVisualLightMode)}
      />
      <div className="visual-map-scroll" ref={scrollRef}>
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          xmlnsXlink="http://www.w3.org/1999/xlink"
          width={bounds ? `${ds * dx}` : ''}
          viewBox={bounds
            ? `${s * bounds.x1 - padding} ${s * bounds.y1 - padding} ${dx} ${s * (bounds.y2 - bounds.y1) + 2 * padding}`
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
