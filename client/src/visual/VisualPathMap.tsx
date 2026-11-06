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
import { bonusAnchorsOf, computeVisualProgressFrontier, isVisualLevelUnlocked } from './visualWorldProgress'

/** Fill and edge of each named world colour. */
const WORLD_COLORS: Record<string, { fill: string; edge: string }> = {
  grey: { fill: '#94a3b8', edge: '#64748b' },
  purple: { fill: '#8b5cf6', edge: '#6d28d9' },
  blue: { fill: '#3b82f6', edge: '#1d4ed8' },
  sky: { fill: '#38bdf8', edge: '#0284c7' },
  teal: { fill: '#14b8a6', edge: '#0f766e' },
  green: { fill: '#22c55e', edge: '#15803d' },
  amber: { fill: '#f59e0b', edge: '#b45309' },
  orange: { fill: '#f97316', edge: '#c2410c' },
  red: { fill: '#ef4444', edge: '#b91c1c' },
  pink: { fill: '#ec4899', edge: '#be185d' },
}

interface PathMapTheme {
  background: string
  /** Outline of paths and levels not reached yet. */
  shadow: string
  lockedText: string
}

const DARK_THEME: PathMapTheme = { background: '#0f172a', shadow: '#475569', lockedText: '#64748b' }
const LIGHT_THEME: PathMapTheme = { background: '#f8fafc', shadow: '#cbd5e1', lockedText: '#94a3b8' }

const PATH_OUTER_WIDTH = 16
const PATH_INNER_WIDTH = 10
const MAP_PADDING = 48

interface LevelMeta {
  title?: string
  /** `VisualLevelNumber` label shown in the node. */
  label?: string
  textLevel: boolean
  boss: boolean
  introduction?: string
}

function worldColor(name: string) {
  return WORLD_COLORS[name] ?? WORLD_COLORS.purple!
}

function useLevelMeta(gameId: string, worldSize: Record<string, number> | null | undefined) {
  const [meta, setMeta] = React.useState<Record<string, LevelMeta>>({})
  React.useEffect(() => {
    if (!worldSize) return
    const controller = new AbortController()
    const base = getDataBaseUrl().replace(/\/$/u, '')
    const requests = Object.entries(worldSize).flatMap(([world, size]) =>
      Array.from({ length: size }, (_, index) => {
        const level = index + 1
        return fetch(`${base}/${gameId}/level__${world}__${level}.json`, { signal: controller.signal })
          .then(response => response.ok ? response.json() : null)
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
          .catch(() => [`${world}:${level}`, { textLevel: false, boss: false }] as const)
      }))
    void Promise.all(requests).then(entries => {
      if (!controller.signal.aborted) setMeta(Object.fromEntries(entries))
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
  const { tooltip, triggerProps } = useMapLevelTooltip(state === 'locked' ? `${title} (locked)` : title)
  const activate = () => onOpen?.()
  const stroke = state === 'completed' ? color.edge : state === 'frontier' ? color.fill : theme.shadow
  const fill = state === 'completed' ? color.fill : theme.background
  const textColor = state === 'completed' ? '#ffffff' : state === 'frontier' ? color.fill : theme.lockedText
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

export function VisualPathMap({ gameInfo, isLightMode, openAnyLevel }: {
  gameInfo: GameInfo
  isLightMode: boolean
  /** The "Open Any Level" setting: locked levels open too. */
  openAnyLevel: boolean
}) {
  const gameId = React.useContext(GameIdContext)
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [searchParams, setSearchParams] = useSearchParams()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const theme = isLightMode ? LIGHT_THEME : DARK_THEME
  // Subscribe so completions and imports repaint the map.
  useAppSelector(selectProgress(gameId))
  const meta = useLevelMeta(gameId, gameInfo.worldSize)
  const [viewportWidth, setViewportWidth] = React.useState(() => window.innerWidth)
  React.useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
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
  const openTextMeta = openText ? meta[`${openText.world}:${openText.level}`] : undefined
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
    const levelMeta = meta[`${node.world}:${node.level}`]
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
  })

  const { bounds } = layout
  const viewX = bounds.x1 - MAP_PADDING
  const viewY = bounds.y1 - MAP_PADDING
  const viewWidth = bounds.x2 - bounds.x1 + 2 * MAP_PADDING
  const viewHeight = bounds.y2 - bounds.y1 + 2 * MAP_PADDING
  // Natural size where it fits; narrower screens scale the whole map down.
  const displayWidth = Math.min(viewWidth, Math.max(240, viewportWidth - 16))

  // Two passes, outlines then fillings, so overlapping stretches join without
  // seams; lit stretches go last so they cover the outline of an unlit twin.
  const segments = layout.segments.map(segment => ({
    ...segment,
    lit: isDone(segment.source.world, segment.source.level),
    data: roundedPathData(segment.points, PATH_MAP_CORNER_RADIUS),
  })).sort((a, b) => Number(a.lit) - Number(b.lit))

  return (
    <div className="visual-map-scroll visual-path-map-scroll" ref={scrollRef} data-testid="visual-world-map">
      <svg
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
        {layout.labels.map(label => (
          <text
            key={`label:${label.world}`}
            className="path-map-world-label"
            data-testid="path-map-world-label"
            x={label.x}
            y={label.y}
            dy="0.35em"
            textAnchor="middle"
            fill={worldColor(label.color).fill}
          >{label.text}</text>
        ))}
        {layout.nodes.map(node => {
          const state = stateOf(node)
          return (
            <PathMapLevel
              key={`${node.world}:${node.level}`}
              node={node}
              meta={meta[`${node.world}:${node.level}`]}
              state={state}
              theme={theme}
              onOpen={state !== 'locked' || openAnyLevel ? () => openLevel(node) : undefined}
            />
          )
        })}
      </svg>
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
