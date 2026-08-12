/**
 * @fileOverview Define the menu displayed with the tree of worlds on the welcome page
*/
import * as React from 'react'
import { Link } from 'react-router-dom'
import cytoscape, { LayoutOptions } from 'cytoscape'
import klay from 'cytoscape-klay'

import { GameIdContext } from '../app'
import { selectCompleted } from '../state/progress'
import { store } from '../state/store'

import '../css/world_tree.css'
import { useGameTranslation } from '../utils/translation'
import { getDataBaseUrl } from '../utils/url'
import { plainLevelTitle } from './annotated_level_title'
import { useMapLevelTooltip } from './map_level_tooltip'

// Settings for the world tree
cytoscape.use( klay )

const r = 16              // radius of a level
const s = 10              // global scale
const lineWidth = 10      //
const ds = .75  // scale the resulting svg image

const NMIN = 5   // min. worldsize
const NLABEL = 8 // max. world size to display label below the world
const NMAX = 16  // max. world size. Level icons start spiraling out if the world has more levels.
const NSPIRAL = 12 // world size if NMAX has been passed and need to spiral.

const MINFONT = 12

// colours
const grey = 'var(--world-locked)'
const lightgrey = 'var(--world-level-locked)'
const green = 'var(--world-path-complete)'
const lightgreen = 'var(--world-level-complete)'
const blue = 'var(--world-level-current)'
const darkgrey = 'var(--world-label-locked)'
const darkgreen = 'var(--world-label-complete)'
const darkblue = 'var(--world-label-current)'


/** svg object for a level in the game tree */
export function LevelIcon({ world, level, position, completed, unlocked, worldSize, title }:
  { world: string,
    level: number,
    position: cytoscape.Position,
    completed: boolean,
    unlocked: boolean,
    worldSize: number,
    title?: string
  }) {

  const N = Math.max(worldSize, NMIN)

  // divide circle into `N+2` equal pieces.
  // only for non-spiraling case
  const beta = 2 * Math.PI / Math.min(N+2, ((N < (NMAX+1) ? NMAX : NSPIRAL)+1))

  // We want distance between two level icons to be `2.2*r`, therefore:
  // Sinus-Satz: (1.1*r) / sin(β/2) = R / sin(π/2)
  let R = 1.1 * r / Math.sin(beta/2)

  const gameId = React.useContext(GameIdContext)
  const levelLabel = plainLevelTitle(title ?? `Level ${level}`, true)
  const { tooltip, triggerProps } = useMapLevelTooltip(levelLabel)

  /** In the spiral, the angle `β` should decrease to avoid big gaps between levels.
   * This is a simplified function, which has little mathematical foundation, but
   * works fine in tests up to `N=30`.
   */
  function betaSpiral(level) {
    return 2 * Math.PI / ((NSPIRAL+1) + 2 * Math.max(0, (level-2)) / (NSPIRAL+1))
  }

  const x = N < (NMAX+1) ?
    // normal case
    s * position.x + Math.sin(level * beta) * R :
    // spiraling case
    s * position.x + Math.sin(level * betaSpiral(level)) * (R + 2*r*(level-1)/(NSPIRAL+1))
  const y = N < (NMAX+1) ?
    // normal case
    s * position.y - Math.cos(level * beta) * R :
    // spiraling case
    s * position.y - Math.cos(level * betaSpiral(level)) * (R + 2*r*(level-1)/(NSPIRAL+1))

  return (<>
    <Link to={`/${gameId}/world/${world}/level/${level}`}
        className={`level ${completed ? 'completed' : unlocked ? 'unlocked' : 'locked'}`}
        aria-label={`Open ${world} level ${level}: ${levelLabel}`}
        {...triggerProps}>
      <title>{levelLabel}</title>
      <circle fill={completed ? lightgreen : unlocked? blue : lightgrey} cx={x} cy={y} r={r} />
      <foreignObject className="level-title-wrapper" x={x} y={y}
          width={1.42*r} height={1.42*r} transform={"translate("+ -.71*r +","+ -.71*r +")"}>
        <div>
          <p className="level-title" style={{fontSize: Math.floor(r) + "px"}}>
            {level}
          </p>
        </div>
      </foreignObject>
    </Link>
    {tooltip}
  </>)
}

/** svg object of one world in the game tree */
export function WorldIcon({world, title, position, completedLevels, worldSize}:
  { world: string,
    title: string,
    position: cytoscape.Position,
    completedLevels: any,
    worldSize: number
  }) {
  const { t : gT } = useGameTranslation()

  // See level icons. Match radius computed there minus `1.2*r`
  const N = Math.max(worldSize, NMIN)
  const betaHalf = Math.PI / Math.min(N+2, ((N < (NMAX+1) ? NMAX : NSPIRAL) + 1))
  let R = 1.1 * r / Math.sin(betaHalf) - 1.2 * r

  let fontSize = Math.floor(R/4)

  // Offset for the labels for small worlds
  let labelOffset = R + 2.5 * r

  // index `0` indicates that all prerequisites are completed
  let unlocked = completedLevels[0]
  // indices `1`-`n` indicate that the corresponding level is completed
  let completed = completedLevels.slice(1).every(Boolean)
  // select the first non-completed level
  let nextLevel: number = completedLevels.findIndex(c => !c)
  if (nextLevel <= 1) nextLevel = 1
  const gameId = React.useContext(GameIdContext)

  return <Link
      to={`/${gameId}/world/${world}/level/${nextLevel}`}
      className={`world ${completed ? 'completed' : unlocked ? 'unlocked' : 'locked'}`}
      aria-label={`Open ${title || world}`}>
    <title>{title || world}</title>
    <circle className="world-circle" cx={s*position.x} cy={s*position.y} r={R}
        fill={completed ? green : unlocked ? blue : grey}/>
    { false ? // fontSize >= MINFONT ?
      // NOTE: This code would display the world names inside the bubble, but currently
      //       it isn't used.
      // Label for large worlds
      <foreignObject className="world-title-wrapper" x={s*position.x} y={s*position.y}
          width={1.42*R} height={1.42*R} transform={"translate("+ -.71*R +","+ -.71*R +")"}>
        <div className={unlocked && !completed ? "playable-world" : ''}>
          <p className="world-title" style={{fontSize: fontSize + "px"}}>
            {title ? gT(title) : world}
          </p>
        </div>
      </foreignObject>
      :
      // Label for small worlds
      <foreignObject x={s*position.x - 75} y={s*position.y + labelOffset}
          width='150px' height='2em' style={{overflow: 'visible'}}
          >
        <div className='world-label' style={{backgroundColor: completed ? darkgreen : unlocked ? darkblue : darkgrey}}>
          <p className='world-title' style={{fontSize: MINFONT + "px"}}>
            {title ? gT(title) : world}
          </p>
        </div>
      </foreignObject>}
  </Link>
}

/** svg object for a connection path between worlds in the game tree */
export function WorldPath({source, target, unlocked} : {source: any, target: any, unlocked: boolean}) {
  return <line x1={s*source.position.x} y1={s*source.position.y}
          x2={s*target.position.x} y2={s*target.position.y}
          stroke={unlocked ? green : grey} strokeWidth={lineWidth} />
}

/** Download a file containing `data` */
export const downloadFile = ({ data, fileName, fileType } :
  { data: string
    fileName: string
    fileType: string}) => {
  const blob = new Blob([data], { type: fileType })
  const a = document.createElement('a')
  a.download = fileName
  a.href = window.URL.createObjectURL(blob)
  const clickEvt = new MouseEvent('click', {
    view: window,
    bubbles: true,
    cancelable: true,
  })
  a.dispatchEvent(clickEvt)
  a.remove()
}

export function computeWorldLayout(worlds) {
  let elements = []
  const sortedWorldIds = Object.keys(worlds.nodes).sort((a, b) => a.localeCompare(b))
  for (const id of sortedWorldIds) {
    elements.push({ data: { id: id, title: worlds.nodes[id].title } })
  }
  for (let edge of worlds.edges) {
    elements.push({
      data: {
        id: edge[0] + " --edge-to--> " + edge[1],
        source: edge[0],
        target: edge[1]
      }
    })
  }
  const cy = cytoscape({
    container: null,
    elements,
    headless: true,
    styleEnabled: false
  })

  cy.layout({name: "klay", klay: {direction: "DOWN", nodePlacement: "LINEAR_SEGMENTS"}} as LayoutOptions).run()

  let nodes = {}
  cy.nodes().forEach((node, id) => {
    nodes[node.id()] = {
      position: node.position(),
      data: node.data()
    }
  })
  const bounds = cy.nodes().boundingBox()
  return { nodes, bounds }
}


export function WorldTreePanel({worlds, worldSize, completionNeutralLevels = {}}:
  { worlds: any,
    worldSize: any,
    completionNeutralLevels?: Record<string, number[]>,
  }) {
  const gameId = React.useContext(GameIdContext)
  const {nodes, bounds}: any = worlds ? computeWorldLayout(worlds) : {nodes: []}
  const [levelTitles, setLevelTitles] = React.useState<Record<string, Record<number, string>>>({})

  React.useEffect(() => {
    if (!worldSize) return
    const controller = new AbortController()
    const base = getDataBaseUrl().replace(/\/$/u, '')
    const requests = Object.entries(worldSize as Record<string, number>).flatMap(([worldId, size]) =>
      Array.from({length: size}, (_, index) => {
        const level = index + 1
        return fetch(`${base}/${gameId}/level__${worldId}__${level}.json`, {signal: controller.signal})
          .then(response => response.ok ? response.json() : null)
          .then((data: {title?: string} | null) => ({worldId, level, title: data?.title ?? `Level ${level}`}))
          .catch(() => ({worldId, level, title: `Level ${level}`}))
      })
    )
    void Promise.all(requests).then(results => {
      if (controller.signal.aborted) return
      const next: Record<string, Record<number, string>> = {}
      for (const {worldId, level, title} of results) {
        next[worldId] ??= {}
        next[worldId][level] = title
      }
      setLevelTitles(next)
    })
    return () => controller.abort()
  }, [gameId, worldSize])

  // scroll to playable world
  React.useEffect(() => {
    let elems = Array.from(document.getElementsByClassName("playable-world"))
    if (elems.length) {
      // it seems that the last element is the one furthest up in the tree
      // TODO: I think they appear in random order. Check their position and select the lowest one
      // of these positions to scroll to.
      let elem = elems[0]
      console.debug(`scrolling to ${elem.textContent}`)
      elem.scrollIntoView({block: "center"})
    }
  }, [worlds, worldSize])

  let svgElements = []

  // for each `worldId` as index, this contains a list of booleans with indices
  // 0, 1, …, n. Index `0` will be set to `false` if any dependency is not completely solved.
  // Indices `1, …, n` indicate if the corresponding level is completed
  var completed = {}
  var satisfied = {}

  if (worlds && worldSize) {
    // Fill `completed` with the level data.
    for (let worldId in nodes) {
      completed[worldId] = Array.from({ length: worldSize[worldId] + 1 }, (_, i) => {
        // index `0` starts off as `true` but can be set to `false` by any edge with non-completed source
        return i == 0 || selectCompleted(gameId, worldId, i)(store.getState())
      })
      const neutral = new Set(completionNeutralLevels[worldId] ?? [])
      satisfied[worldId] = completed[worldId].map((done, i) => done || neutral.has(i))
    }

    // draw all connecting paths
    for (let i in worlds.edges) {
      const edge = worlds.edges[i]
      let sourceCompleted = satisfied[edge[0]].slice(1).every(Boolean)
      // if the origin world is not completed, mark the target world as non-playable
      if (!sourceCompleted) {satisfied[edge[1]][0] = false}
      svgElements.push(
        <WorldPath key={`path_${edge[0]}-->${edge[1]}`}
          source={nodes[edge[0]]} target={nodes[edge[1]]} unlocked={sourceCompleted}/>
      )
    }

    // draw the worlds and levels
    for (let worldId in nodes) {
      let position: cytoscape.Position = nodes[worldId].position
      svgElements.push(
        <WorldIcon world={worldId}
          title={nodes[worldId].data.title || worldId}
          position={position}
          completedLevels={satisfied[worldId]}
          key={`${gameId}-${worldId}`}
          worldSize={worldSize[worldId]}
        />
      )

      for (let i = 1; i <= worldSize[worldId]; i++) {
        svgElements.push(
          <LevelIcon
            world={worldId}
            level={i}
            position={position}
            completed={completed[worldId][i]}
            unlocked={satisfied[worldId][i-1]}
            key={`${gameId}-${worldId}-${i}`}
            worldSize={worldSize[worldId]}
            title={levelTitles[worldId]?.[i]}
          />
        )
      }
    }
  }

  // See `LevelIcon` for calculation of the radius. Use the max. radius for calculating the padding
  // TODO: Is there a way to determine padding according to the drawn objects?
  let R = 1.1 * r / Math.sin(Math.PI / (NMAX+1))
  const padding = R + 2.1*r

  let dx = bounds ? s*(bounds.x2 - bounds.x1) + 2*padding : null

  return <div className="column">
      <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink"
          width={bounds ? `${ds * dx}` : ''}
          viewBox={bounds ? `${s*bounds.x1 - padding} ${s*bounds.y1 - padding} ${dx} ${s*(bounds.y2 - bounds.y1) + 2 * padding}` : ''}
          className="world-selection" >
        {svgElements}
      </svg>
  </div>
}
