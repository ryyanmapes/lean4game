/**
 * @fileOverview Visual-mode world map. Dark-themed, no sidebars.
 * All levels are always clickable and route to the /visual level page.
 */
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBars, faXmark, faArrowLeft,
  faEraser, faDownload, faUpload, faCircleInfo, faGear, faLock, faLockOpen,
} from '@fortawesome/free-solid-svg-icons'
import { useAtom } from 'jotai'
import cytoscape from 'cytoscape'

import { GameIdContext } from '../app'
import { useGetGameInfoQuery } from '../state/api'
import { selectCompleted, selectProgress, selectUnlockLevels, changeUnlockLevels } from '../state/progress'
import { store } from '../state/store'
import { computeWorldLayout } from '../components/world_tree'
import { navOpenAtom, closeNavAtom } from '../store/navigation-atoms'
import { popupAtom, PopupType } from '../store/popup-atoms'
import { useAppDispatch, useAppSelector } from '../hooks'
import { saveState } from '../state/local_storage'
import { downloadProgress } from '../components/popup/erase'
import { useRetryUntilData } from '../hooks/useRetryUntilData'
import { useTranslation } from 'react-i18next'
import './visual.css'

// ── Layout constants (match world_tree.tsx) ──────────────────────────────────
const r = 16
const s = 10
const lineWidth = 10
const ds = 0.75

const NMIN = 5
const NLABEL = 8
const NMAX = 16
const NSPIRAL = 12
const MINFONT = 12

// ── Dark-mode colour palette ─────────────────────────────────────────────────
const lockedLevel     = '#475569'   // slate-600  – locked level icon
const unlockedLevel   = '#8b5cf6'   // purple     – unlocked (accessible) level
const completedLevel  = '#10b981'   // emerald-500 – completed level

const lockedWorld     = '#334155'   // slate-700
const unlockedWorld   = '#6d28d9'   // violet-700
const completedWorld  = '#059669'   // emerald-600

const lockedLabel     = '#475569'
const unlockedLabel   = '#5b21b6'
const completedLabel  = '#047857'

const lockedPath      = '#475569'
const unlockedPath    = '#10b981'

// ─────────────────────────────────────────────────────────────────────────────

/** Level icon that always allows navigation and links to the /visual route. */
function VisualLevelIcon({ world, level, position, completed, unlocked, worldSize }: {
  world: string
  level: number
  position: cytoscape.Position
  completed: boolean
  unlocked: boolean
  worldSize: number
}) {
  const gameId = React.useContext(GameIdContext)
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

  const fill = completed ? completedLevel : unlocked ? unlockedLevel : lockedLevel
  const to = `/${gameId}/world/${world}/level/${level}/visual`

  return (
    <Link to={to} className="level">
      <circle fill={fill} cx={x} cy={y} r={r} />
      <foreignObject className="level-title-wrapper" x={x} y={y}
        width={1.42 * r} height={1.42 * r}
        transform={`translate(${-0.71 * r},${-0.71 * r})`}>
        <div>
          <p className="level-title" style={{ fontSize: Math.floor(r) + 'px' }}>
            {level}
          </p>
        </div>
      </foreignObject>
    </Link>
  )
}

/** World icon that links to the first unplayed visual level. */
function VisualWorldIcon({ world, title, position, completedLevels, worldSize }: {
  world: string
  title: string
  position: cytoscape.Position
  completedLevels: boolean[]
  worldSize: number
}) {
  const gameId = React.useContext(GameIdContext)
  const N = Math.max(worldSize, NMIN)
  const betaHalf = Math.PI / Math.min(N + 2, ((N < (NMAX + 1) ? NMAX : NSPIRAL) + 1))
  let R = 1.1 * r / Math.sin(betaHalf) - 1.2 * r
  let labelOffset = R + 2.5 * r

  const unlocked = completedLevels[0]
  const completed = completedLevels.slice(1).every(Boolean)
  let nextLevel: number = completedLevels.findIndex(c => !c)
  if (nextLevel <= 1) nextLevel = 1

  const fill = completed ? completedWorld : unlocked ? unlockedWorld : lockedWorld
  const labelBg = completed ? completedLabel : unlocked ? unlockedLabel : lockedLabel

  return (
    <Link to={`/${gameId}/world/${world}/level/${nextLevel}/visual`}>
      <circle className="world-circle" cx={s * position.x} cy={s * position.y} r={R} fill={fill} />
      <foreignObject x={s * position.x - 75} y={s * position.y + labelOffset}
        width="150px" height="2em" style={{ overflow: 'visible' }}>
        <div className="world-label" style={{ backgroundColor: labelBg }}>
          <p className="world-title" style={{ fontSize: MINFONT + 'px' }}>
            {title || world}
          </p>
        </div>
      </foreignObject>
    </Link>
  )
}

/** SVG edge between worlds. */
function VisualWorldPath({ source, target, unlocked }: { source: any; target: any; unlocked: boolean }) {
  return (
    <line
      x1={s * source.position.x} y1={s * source.position.y}
      x2={s * target.position.x} y2={s * target.position.y}
      stroke={unlocked ? unlockedPath : lockedPath}
      strokeWidth={lineWidth}
    />
  )
}

// ── Hamburger menu ────────────────────────────────────────────────────────────

function VisualMapMenuButton() {
  const [navOpen, setNavOpen] = useAtom(navOpenAtom)
  return (
    <button
      className="visual-map-menu-btn"
      onClick={() => setNavOpen(!navOpen)}
      aria-label="Menu"
    >
      <FontAwesomeIcon icon={navOpen ? faXmark : faBars} />
    </button>
  )
}

function VisualMapAppBar({ gameTitle }: { gameTitle: string }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const gameId = React.useContext(GameIdContext)
  const [navOpen, setNavOpen] = useAtom(navOpenAtom)
  const [, setPopup] = useAtom(popupAtom)
  const dispatch = useAppDispatch()
  const unlockLevels = useAppSelector(selectUnlockLevels(gameId))
  const gameProgress = useAppSelector(selectProgress(gameId))

  function closeMenu() { setNavOpen(false) }

  function toggleUnlockLevels() {
    dispatch(changeUnlockLevels({ game: gameId, unlockLevels: !unlockLevels }))
    saveState(store.getState().progress)
    window.location.reload()
  }

  return (
    <div className="visual-map-appbar">
      <button
        className="visual-map-back-btn"
        onClick={() => navigate('/')}
        title={t("Home")}
        aria-label={t("Home")}
      >
        <FontAwesomeIcon icon={faArrowLeft} />
      </button>
      <span className="visual-map-title">{gameTitle}</span>
      <VisualMapMenuButton />
      <div className={`visual-map-dropdown${navOpen ? ' open' : ''}`}>
        <button onClick={() => { setPopup(PopupType.info); closeMenu() }}>
          <FontAwesomeIcon icon={faCircleInfo} />&nbsp;{t("Game Info")}
        </button>
        <button onClick={(ev) => { downloadProgress(gameId, gameProgress, ev); closeMenu() }}>
          <FontAwesomeIcon icon={faDownload} />&nbsp;{t("Download")}
        </button>
        <button onClick={() => { setPopup(PopupType.upload); closeMenu() }}>
          <FontAwesomeIcon icon={faUpload} />&nbsp;{t("Upload")}
        </button>
        <button onClick={toggleUnlockLevels} className={unlockLevels ? 'active' : ''}>
          <FontAwesomeIcon icon={unlockLevels ? faLockOpen : faLock} />&nbsp;{t("Unlock levels")}
        </button>
        <button onClick={() => { setPopup(PopupType.erase); closeMenu() }}>
          <FontAwesomeIcon icon={faEraser} />&nbsp;{t("Erase")}
        </button>
        <button onClick={() => { setPopup(PopupType.preferences); closeMenu() }}>
          <FontAwesomeIcon icon={faGear} />&nbsp;{t("Preferences")}
        </button>
        <button onClick={() => { setPopup(PopupType.impressum); closeMenu() }}>
          <FontAwesomeIcon icon={faCircleInfo} />&nbsp;{t("Impressum")}
        </button>
        <button onClick={() => { setPopup(PopupType.privacy); closeMenu() }}>
          <FontAwesomeIcon icon={faCircleInfo} />&nbsp;{t("Privacy Policy")}
        </button>
      </div>
    </div>
  )
}

// ── Main world map component ──────────────────────────────────────────────────

export function VisualWorldMap() {
  const gameId = React.useContext(GameIdContext)
  const gameInfo = useGetGameInfoQuery({ game: gameId })
  useRetryUntilData(gameInfo)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  if (!gameInfo.data) {
    return (
      <div className="visual-page visual-map-page">
        <Box display="flex" alignItems="center" justifyContent="center" sx={{ height: '100vh' }}>
          <CircularProgress sx={{ color: '#8b5cf6' }} />
        </Box>
      </div>
    )
  }

  const { worlds, worldSize, title } = gameInfo.data
  const { nodes, bounds }: any = worlds ? computeWorldLayout(worlds) : { nodes: {} }

  // Compute completion state (same logic as WorldTreePanel)
  const completed: Record<string, boolean[]> = {}
  const svgElements: React.ReactNode[] = []

  if (worlds && worldSize) {
    for (const worldId in nodes) {
      completed[worldId] = Array.from({ length: worldSize[worldId] + 1 }, (_, i) =>
        i === 0 || selectCompleted(gameId, worldId, i)(store.getState())
      )
    }

    // Draw edges
    for (const edge of worlds.edges) {
      const sourceCompleted = completed[edge[0]].slice(1).every(Boolean)
      if (!sourceCompleted) completed[edge[1]][0] = false
      svgElements.push(
        <VisualWorldPath
          key={`path_${edge[0]}-->${edge[1]}`}
          source={nodes[edge[0]]}
          target={nodes[edge[1]]}
          unlocked={sourceCompleted}
        />
      )
    }

    // Draw worlds and levels
    for (const worldId in nodes) {
      const position: cytoscape.Position = nodes[worldId].position
      svgElements.push(
        <VisualWorldIcon
          key={`world-${worldId}`}
          world={worldId}
          title={nodes[worldId].data.title || worldId}
          position={position}
          completedLevels={completed[worldId]}
          worldSize={worldSize[worldId]}
        />
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
          />
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

  return (
    <div className="visual-page visual-map-page">
      <VisualMapAppBar gameTitle={title || gameId} />
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
