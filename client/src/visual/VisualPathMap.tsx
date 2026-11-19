/**
 * @fileOverview The path-style world map (`VisualPathMap`): every level is a
 * node on a path, worlds are coloured paths that split and join, and bonus
 * levels sprout off the side. Finished stretches are filled in their world's
 * colour, the levels waiting to be played are hollow rings, and everything
 * further on is an uncoloured outline. Text-only levels (`VisualTextLevel`) open
 * in a dialog over the map; closing it completes them.
 */
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { GameIdContext } from '../app'
import type { GameInfo } from '../state/api'
import { levelCompleted, levelEntered, selectCompleted, selectEntered, selectProgress } from '../state/progress'
import { store } from '../state/store'
import { useAppDispatch, useAppSelector } from '../hooks'
import { getDataBaseUrl } from '../utils/url'
import { useMapLevelTooltip } from '../components/map_level_tooltip'
import { plainLevelTitle } from '../components/annotated_level_title'
import { Markdown } from '../components/markdown'
import {
  computePathMapLayout,
  PATH_MAP_BOSS_NODE_RADIUS,
  PATH_MAP_CORNER_RADIUS,
  PATH_MAP_NODE_RADIUS,
  roundedPathData,
  type PathMapNode,
} from './pathMapLayout'
import { visualInterfaceScale } from './interfaceScale'
import { bonusAnchorsOf, computeVisualProgressFrontier, isVisualLevelUnlocked } from './visualWorldProgress'

/** The named world colours. Their fill and edge are in the palette (palette.css),
 * as `--pal-world-<name>` and `--pal-world-<name>-edge`. */
const WORLD_COLOR_NAMES = new Set([
  'grey', 'purple', 'blue', 'sky', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'indigo', 'lime',
])

/** The map's own colours, from the palette of the scheme in use. */
const THEME = {
  background: 'rgb(var(--pal-bg-start))',
  /** Outline of paths and levels not reached yet. */
  shadow: 'rgb(var(--pal-track))',
  lockedText: 'rgb(var(--pal-inactive))',
  /** The number of a finished level, on its world's colour. */
  completedText: 'rgb(var(--pal-on-solid))',
}
type PathMapTheme = typeof THEME

const PATH_OUTER_WIDTH = 16
const PATH_INNER_WIDTH = 10
const MAP_PADDING = 48
/** A phone scrolls sideways rather than shrink the map below this, so its levels
 * stay readable and tappable. */
const MIN_PHONE_SCALE = 0.62

interface LevelMeta {
  title?: string
  /** `VisualLevelNumber` label shown in the node. */
  label?: string
  textLevel: boolean
  boss: boolean
  introduction?: string
}

function worldColor(name: string) {
  const known = WORLD_COLOR_NAMES.has(name) ? name : 'purple'
  return { fill: `rgb(var(--pal-world-${known}))`, edge: `rgb(var(--pal-world-${known}-edge))` }
}

/** Each game's level metadata, kept for the session: coming back from a level
 * paints the map complete straight away, with no fetch. */
const levelMetaCache = new Map<string, Record<string, LevelMeta>>()

/** The metadata of every level of a game, or null until it has all arrived. Levels'
 * labels and sizes depend on it, so the map waits rather than paint and correct them. */
function useLevelMeta(gameId: string, worldSize: Record<string, number> | null | undefined) {
  const [meta, setMeta] = React.useState<Record<string, LevelMeta> | null>(() => levelMetaCache.get(gameId) ?? null)
  React.useEffect(() => {
    if (!worldSize || levelMetaCache.has(gameId)) return
    const controller = new AbortController()
    const base = getDataBaseUrl().replace(/\/$/u, '')
    let complete = true
    const requests = Object.entries(worldSize).flatMap(([world, size]) =>
      Array.from({ length: size }, (_, index) => {
        const level = index + 1
        return fetch(`${base}/${gameId}/level__${world}__${level}.json`, { signal: controller.signal })
          .then(response => {
            if (!response.ok) complete = false
            return response.ok ? response.json() : null
          })
          .then((data: {
            title?: string | null
            introduction?: string | null
            visualLevelNumber?: string | null
            visualTextLevel?: boolean
            visualBossLevel?: boolean
          } | null) => [`${world}:${level}`, {
            title: data?.title ?? undefined,
            label: data?.visualLevelNumber ?? undefined,
            textLevel: Boolean(data?.visualTextLevel),
            boss: Boolean(data?.visualBossLevel),
            introduction: data?.introduction ?? undefined,
          }] as const)
          .catch(() => {
            complete = false
            return [`${world}:${level}`, { textLevel: false, boss: false }] as const
          })
      }))
    void Promise.all(requests).then(entries => {
      if (controller.signal.aborted) return
      const next = Object.fromEntries(entries)
      if (complete) levelMetaCache.set(gameId, next)
      setMeta(next)
    })
    return () => controller.abort()
  }, [gameId, worldSize])
  return meta
}

function PathMapLevel({ node, meta, state, theme, onOpen }: {
  node: PathMapNode
  meta?: LevelMeta
  state: 'completed' | 'frontier' | 'locked'
  theme: PathMapTheme
  /** Undefined while the level is locked. */
  onOpen?: () => void
}) {
  const color = worldColor(node.color)
  const label = meta?.label ?? String(node.index)
  const title = plainLevelTitle(meta?.title ?? `Level ${label}`)
  const { tooltip, triggerProps } = useMapLevelTooltip(state === 'locked' ? `🔒 ${title}` : title)
  const activate = () => onOpen?.()
  const stroke = state === 'completed' ? color.edge : state === 'frontier' ? color.fill : theme.shadow
  const fill = state === 'completed' ? color.fill : theme.background
  const textColor = state === 'completed' ? theme.completedText : state === 'frontier' ? color.fill : theme.lockedText
  const radius = meta?.boss ? PATH_MAP_BOSS_NODE_RADIUS : PATH_MAP_NODE_RADIUS
  return (<>
    <g
      className={`path-map-level visual-map-link${onOpen ? '' : ' locked'}`}
      data-testid="path-map-level"
      data-world={node.world}
      data-level={node.level}
      data-state={state}
      data-text-level={meta?.textLevel ? 'true' : undefined}
      data-boss={meta?.boss ? 'true' : undefined}
      role="link"
      tabIndex={0}
      aria-label={`${meta?.textLevel ? 'Read' : 'Open'} ${title}${onOpen ? '' : ' (locked)'}`}
      aria-disabled={onOpen ? undefined : 'true'}
      onClick={activate}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
      {...triggerProps}
    >
      <circle
        cx={node.x}
        cy={node.y}
        r={state === 'frontier' ? radius - 3.5 : radius - 1.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={state === 'frontier' ? 7 : 3}
      />
      <text
        x={node.x}
        y={node.y}
        dy="0.35em"
        textAnchor="middle"
        className="path-map-level-label"
        fill={textColor}
      >{label}</text>
    </g>
    {tooltip}
  </>)
}

function TextLevelDialog({ title, introduction, onClose }: {
  title: string
  introduction: string
  onClose: () => void
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="path-map-text-backdrop" onClick={onClose}>
      <div
        className="path-map-text-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="text-level-dialog"
        onClick={event => event.stopPropagation()}
      >
        <div className="path-map-text-body">
          <Markdown>{introduction}</Markdown>
        </div>
        <button ref={closeRef} type="button" className="path-map-text-close" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  )
}

export function VisualPathMap({ gameInfo, openAnyLevel }: {
  gameInfo: GameInfo
  /** The "Open Any Level" setting: locked levels open too. */
  openAnyLevel: boolean
}) {
  const gameId = React.useContext(GameIdContext)
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [searchParams, setSearchParams] = useSearchParams()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const theme = THEME
  // Subscribe so completions and imports repaint the map.
  useAppSelector(selectProgress(gameId))
  const meta = useLevelMeta(gameId, gameInfo.worldSize)
  const [{ viewportWidth, viewportHeight }, setViewport] = React.useState(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }))
  React.useEffect(() => {
    const onResize = () => setViewport({ viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const nodesById = gameInfo.worlds?.nodes
  // Phones fit the whole map to the screen width: narrower columns keep levels
  // tappable.
  const compact = viewportWidth <= 720
  const layout = React.useMemo(() => computePathMapLayout({
    worlds: Object.fromEntries(Object.entries(nodesById ?? {}).map(([world, node]) => [world, {
      title: node.title,
      bonusOf: node.visualBonusOf,
      color: node.visualColor,
      column: node.visualMapColumn,
      shared: node.visualSharedPath,
      continues: node.visualContinues,
      bottom: node.visualMapBottom,
    }])),
    edges: gameInfo.worlds?.edges ?? [],
    worldSize: gameInfo.worldSize ?? {},
    skippedLevels: gameInfo.skippedLevels,
  }, compact ? { columnWidth: 88 } : {}),
  [compact, gameInfo.skippedLevels, gameInfo.worldSize, gameInfo.worlds?.edges, nodesById])

  const frontier = computeVisualProgressFrontier({
    worldIds: Object.keys(nodesById ?? {}),
    edges: gameInfo.worlds?.edges ?? [],
    worldSizes: gameInfo.worldSize ?? {},
    skippedLevels: gameInfo.skippedLevels ?? {},
    completionNeutralLevels: gameInfo.completionNeutralLevels ?? {},
    bonusAnchors: bonusAnchorsOf(nodesById),
    isCompleted: (world, level) => selectCompleted(gameId, world, level)(store.getState()),
    isEntered: (world, level) => selectEntered(gameId, world, level)(store.getState()),
  })
  const isDone = (world: string, level: number) => frontier.mapCompletedLevels[world]?.[level] ?? false
  const stateOf = (node: PathMapNode): 'completed' | 'frontier' | 'locked' =>
    isDone(node.world, node.level)
      ? 'completed'
      : isVisualLevelUnlocked(frontier, node.world, node.level) ? 'frontier' : 'locked'

  // Text level opened from the map, or sent here by its level route (`?text=`).
  const [openText, setOpenText] = React.useState<{ world: string; level: number } | null>(() => {
    const requested = searchParams.get('text')
    const match = requested ? /^(.+)\/(\d+)$/u.exec(requested) : null
    return match ? { world: match[1]!, level: Number(match[2]) } : null
  })
  const openTextMeta = openText ? meta?.[`${openText.world}:${openText.level}`] : undefined
  const closeText = React.useCallback(() => {
    if (!openText) return
    dispatch(levelCompleted({ game: gameId, world: openText.world, level: openText.level }))
    setOpenText(null)
    if (searchParams.has('text')) {
      const next = new URLSearchParams(searchParams)
      next.delete('text')
      setSearchParams(next, { replace: true })
    }
  }, [dispatch, gameId, openText, searchParams, setSearchParams])

  const openLevel = (node: PathMapNode) => {
    const levelMeta = meta?.[`${node.world}:${node.level}`]
    if (levelMeta?.textLevel) {
      dispatch(levelEntered({ game: gameId, world: node.world, level: node.level }))
      setOpenText({ world: node.world, level: node.level })
      return
    }
    window.sessionStorage.setItem(`visual-map-focus:${gameId}`, node.world)
    navigate(`/${gameId}/world/${node.world}/level/${node.level}/visual`)
  }

  // Start scrolled to the levels waiting to be played.
  const scrolledRef = React.useRef(false)
  React.useLayoutEffect(() => {
    if (scrolledRef.current || layout.nodes.length === 0) return
    const scroller = scrollRef.current
    const target = scroller?.querySelector<SVGGElement>('[data-state="frontier"]')
    if (!scroller || !target) return
    scrolledRef.current = true
    const scrollRect = scroller.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const offset = targetRect.top + targetRect.height / 2 - (scrollRect.top + scrollRect.height / 2)
    if (offset > 0) scroller.scrollTop += offset
    // Sideways only where a phone can't fit the whole map.
    scroller.scrollLeft += targetRect.left + targetRect.width / 2 - (scrollRect.left + scrollRect.width / 2)
  })

  const { bounds } = layout
  const viewX = bounds.x1 - MAP_PADDING
  const viewY = bounds.y1 - MAP_PADDING
  const viewWidth = bounds.x2 - bounds.x1 + 2 * MAP_PADDING
  const viewHeight = bounds.y2 - bounds.y1 + 2 * MAP_PADDING
  // Natural size where it fits, larger on a large window, and scaled down to fit
  // a narrower one, as far as a phone can still read it.
  const fittedWidth = Math.min(
    viewWidth * visualInterfaceScale(viewportWidth, viewportHeight),
    // The window less the scroller's padding and scrollbar.
    Math.max(240, viewportWidth - (compact ? 16 : 48)),
  )
  const displayWidth = compact ? Math.max(fittedWidth, viewWidth * MIN_PHONE_SCALE) : fittedWidth

  // Two passes, outlines then fillings, so overlapping stretches join without
  // seams; lit stretches go last so they cover the outline of an unlit twin.
  const painted = layout.segments.map(segment => ({
    ...segment,
    lit: isDone(segment.source.world, segment.source.level),
    data: roundedPathData(segment.points, PATH_MAP_CORNER_RADIUS),
  })).sort((a, b) => Number(a.lit) - Number(b.lit))
  const segments = painted.filter(segment => !segment.bridge)
  // Where one path crosses another, a bridge is painted over both afterwards,
  // outline and all, so that the path underneath is seen to pass below.
  const bridges = painted.filter(segment => segment.bridge)

  // A world's title is grey until one of its levels can be played.
  const worldUnlocked = (world: string) =>
    layout.nodes.some(node => node.world === world && stateOf(node) !== 'locked')

  return (
    <div className="visual-map-scroll visual-path-map-scroll" ref={scrollRef} data-testid="visual-world-map">
      {meta && <svg
        xmlns="http://www.w3.org/2000/svg"
        className="visual-path-map-svg"
        data-testid="visual-path-map"
        width={displayWidth}
        viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      >
        <g className="path-map-paths" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {segments.map(segment => (
            <path
              key={`${segment.key}:outer`}
              d={segment.data}
              stroke={segment.lit ? worldColor(segment.color).edge : theme.shadow}
              strokeWidth={PATH_OUTER_WIDTH}
            />
          ))}
          {segments.map(segment => (
            <path
              key={`${segment.key}:inner`}
              data-testid="path-map-segment"
              data-segment={segment.key}
              data-lit={segment.lit ? 'true' : 'false'}
              d={segment.data}
              stroke={segment.lit ? worldColor(segment.color).fill : theme.background}
              strokeWidth={PATH_INNER_WIDTH}
            />
          ))}
        </g>
        <g className="path-map-bridges" fill="none" strokeLinecap="butt">
          {bridges.map(bridge => (
            <React.Fragment key={bridge.key}>
              <path
                d={bridge.data}
                stroke={bridge.lit ? worldColor(bridge.color).edge : theme.shadow}
                strokeWidth={PATH_OUTER_WIDTH}
              />
              <path
                data-testid="path-map-bridge"
                data-segment={bridge.key}
                data-lit={bridge.lit ? 'true' : 'false'}
                d={bridge.data}
                stroke={bridge.lit ? worldColor(bridge.color).fill : theme.background}
                strokeWidth={PATH_INNER_WIDTH}
              />
            </React.Fragment>
          ))}
        </g>
        {layout.labels.map(label => {
          const unlocked = worldUnlocked(label.world)
          return (
            <text
              key={`label:${label.world}`}
              className="path-map-world-label"
              data-testid="path-map-world-label"
              data-unlocked={unlocked ? 'true' : 'false'}
              data-anchor={label.anchor}
              x={label.x}
              y={label.y}
              dy="0.35em"
              textAnchor={label.anchor}
              fill={unlocked ? worldColor(label.color).fill : theme.lockedText}
            >{label.text}</text>
          )
        })}
        {layout.nodes.map(node => {
          const state = stateOf(node)
          return (
            <PathMapLevel
              key={`${node.world}:${node.level}`}
              node={node}
              meta={meta?.[`${node.world}:${node.level}`]}
              state={state}
              theme={theme}
              onOpen={state !== 'locked' || openAnyLevel ? () => openLevel(node) : undefined}
            />
          )
        })}
      </svg>}
      {openText && openTextMeta && (
        <TextLevelDialog
          title={openTextMeta.title ?? 'Welcome'}
          introduction={openTextMeta.introduction ?? ''}
          onClose={closeText}
        />
      )}
    </div>
  )
}

export default VisualPathMap
