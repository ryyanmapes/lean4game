/**
 * @fileOverview Layout of the path-style world map (`VisualPathMap`).
 *
 * Every level is a node. A world is a column of its levels, top to bottom;
 * worlds split and join along the game's dependency edges, and a bonus world
 * (`VisualBonusOf`) sprouts sideways off one level of another world, with its
 * levels in a row. A path that can't run down its own column, because another
 * world carries on there, leaves to the side first; where two paths cross, one
 * bridges the other; and a world's title moves beside its path when something
 * is in the way above it. The layout is pure, so progress only changes how its
 * parts are painted.
 */

export interface PathMapWorld {
  title: string
  /** Bonus branch off this level of another world. */
  bonusOf?: { world: string; level: number }
  /** Named colour, see `PATH_MAP_COLORS`. */
  color?: string
  /** Column: 0 is the centre, negative is left. For a bonus world, the column
   * that its path onwards to a later world runs down. */
  column?: number
  /** Below every other world, as a closing level is. */
  bottom?: boolean
  /** Not part of any named world: grey and unlabelled. */
  shared?: boolean
  /** Carries on this world's path: its colour, and no label of its own. */
  continues?: string
}

export interface PathMapInput {
  worlds: Record<string, PathMapWorld>
  edges: readonly (readonly string[])[]
  worldSize: Record<string, number>
  skippedLevels?: Record<string, number[]>
}

export interface PathMapPoint {
  x: number
  y: number
}

export interface PathMapNode {
  world: string
  level: number
  /** 1-based position among the world's visible levels. */
  index: number
  x: number
  y: number
  color: string
}

/** A stretch of path, lit once `source` is completed. */
export interface PathMapSegment {
  key: string
  points: PathMapPoint[]
  color: string
  source: { world: string; level: number }
  /** A short piece of a path where it crosses another, drawn over it. */
  bridge?: boolean
}

/** A world's title. `x` is its middle, or the end named by `anchor` when it sits
 * beside its path. */
export interface PathMapLabel {
  world: string
  text: string
  x: number
  y: number
  color: string
  anchor: 'middle' | 'start' | 'end'
}

export interface PathMapLayout {
  nodes: PathMapNode[]
  segments: PathMapSegment[]
  labels: PathMapLabel[]
  bounds: { x1: number; y1: number; x2: number; y2: number }
}

export const PATH_MAP_COLUMN_WIDTH = 150
export const PATH_MAP_ROW_HEIGHT = 92
export const PATH_MAP_NODE_RADIUS = 22
/** Radius of a boss level's node (`VisualBossLevel`). */
export const PATH_MAP_BOSS_NODE_RADIUS = 31
export const PATH_MAP_CORNER_RADIUS = 26
/** Colour of sections that aren't part of a named world. */
export const PATH_MAP_SHARED_COLOR = 'grey'
/** Named world colours, in the order worlds without a colour receive them. */
export const PATH_MAP_COLORS = ['purple', 'amber', 'sky', 'green', 'pink', 'teal', 'orange', 'blue', 'red', 'indigo', 'lime']

/** Rows from a world's last level to the first level of a world in another column. */
const COLUMN_CHANGE_ROWS = 2
/** Rows above its first level where the edge into a world in another column turns. */
const TURN_ROWS_ABOVE = 0.9
/** Distance between the levels of a bonus world's row, as a fraction of a column. */
const BONUS_STEP_FRACTION = 0.6
const MIN_BONUS_STEP = 60
/** Where several bonus branches leave one level, they leave its path once, down a
 * shared stem beside it, and fan out from the stem. The stem's distance from the
 * path, and how much further out the branches' levels then sit, in bonus steps. */
const BONUS_STEM_FRACTION = 0.5
const BONUS_FAN_SHIFT_FRACTION = 0.25
/** Clear space between a world's title and the top of the path below it. */
const LABEL_GAP = 22
/** Half the outer width of a path, which a title has to clear. */
const PATH_HALF_WIDTH = 8
/** Half the height of a title's text. */
const LABEL_HALF_HEIGHT = 8
/** Rough label width per character, for the bounds. */
const LABEL_CHAR_WIDTH = 8.5
/** A generous label width per character, for keeping titles clear of paths. */
const LABEL_CLEAR_CHAR_WIDTH = 9.2
/** Space between a title beside a path and that path's edge. */
const LABEL_SIDE_GAP = 12
/** Space a title keeps from paths, levels and other titles. */
const LABEL_CLEARANCE = 5
/** Half the length of a bridge over a crossed path. */
const BRIDGE_HALF_LENGTH = PATH_HALF_WIDTH + 6

function visibleLevels(input: PathMapInput, world: string): number[] {
  const skipped = new Set(input.skippedLevels?.[world] ?? [])
  const size = input.worldSize[world] ?? 0
  return Array.from({ length: size }, (_, index) => index + 1).filter(level => !skipped.has(level))
}

/** The visible level a branch off `level` leaves from: that level, or the last
 * visible one before it (the first one if there is none). */
function anchorLevel(levels: number[], level: number): number {
  let anchor = levels[0]!
  for (const candidate of levels) if (candidate <= level) anchor = candidate
  return anchor
}

function dedupeEdges(edges: readonly (readonly string[])[]): [string, string][] {
  const seen = new Set<string>()
  const result: [string, string][] = []
  for (const edge of edges) {
    const [source, target] = edge
    if (!source || !target || source === target) continue
    const key = `${source}\u0000${target}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push([source, target])
  }
  return result
}

export interface PathMapLayoutOptions {
  /** Horizontal distance between columns. */
  columnWidth?: number
}

export function computePathMapLayout(input: PathMapInput, options: PathMapLayoutOptions = {}): PathMapLayout {
  const columnWidth = options.columnWidth ?? PATH_MAP_COLUMN_WIDTH
  const worldIds = Object.keys(input.worlds)
    .filter(world => visibleLevels(input, world).length > 0)
    .sort()
  const present = new Set(worldIds)
  const levelsOf = Object.fromEntries(worldIds.map(world => [world, visibleLevels(input, world)]))
  const bonusOf = (world: string) => {
    const anchor = input.worlds[world]?.bonusOf
    return anchor && anchor.world !== world && present.has(anchor.world) ? anchor : undefined
  }
  const continuesOf = (world: string) => {
    const source = input.worlds[world]?.continues
    return source && source !== world && present.has(source) ? source : undefined
  }
  const mainWorlds = worldIds.filter(world => !bonusOf(world))
  const mainSet = new Set(mainWorlds)
  const mainEdges = dedupeEdges(input.edges).filter(([source, target]) =>
    mainSet.has(source) && mainSet.has(target))
  const predecessors: Record<string, string[]> = Object.fromEntries(mainWorlds.map(world => [world, []]))
  for (const [source, target] of mainEdges) predecessors[target]!.push(source)
  // A bonus world can lead on to a main world. Its row follows from the main
  // world it hangs off, however many bonuses lie in between.
  const bonusRoot = (world: string): string => {
    const seen = new Set<string>()
    let current = world
    while (bonusOf(current) && !seen.has(current)) {
      seen.add(current)
      current = bonusOf(current)!.world
    }
    return current
  }
  const onwardEdges = dedupeEdges(input.edges).filter(([source, target]) =>
    bonusOf(source) !== undefined && mainSet.has(target) && mainSet.has(bonusRoot(source)))
  const onwardRoots: Record<string, string[]> = Object.fromEntries(mainWorlds.map(world => [world, []]))
  for (const [source, target] of onwardEdges) {
    const root = bonusRoot(source)
    if (root !== target) onwardRoots[target]!.push(root)
  }
  const isBottom = (world: string) => input.worlds[world]?.bottom === true

  // Dependency order; a cycle (which MakeGame reports) falls back to name order.
  const order: string[] = []
  const remaining = new Set(mainWorlds)
  while (remaining.size > 0) {
    const ready = [...remaining].filter(world =>
      [...predecessors[world]!, ...onwardRoots[world]!].every(source => !remaining.has(source)))
    const next = ready.length > 0 ? ready : [[...remaining][0]!]
    for (const world of next) {
      order.push(world)
      remaining.delete(world)
    }
  }

  // Columns: explicit ones win; otherwise a world follows its predecessor, and
  // worlds splitting off the same world spread out around it.
  const column: Record<string, number> = {}
  const explicitColumn = (world: string) => input.worlds[world]?.column
  for (const world of order) {
    const explicit = explicitColumn(world)
    if (explicit !== undefined) {
      column[world] = explicit
      continue
    }
    const sources = predecessors[world]!
    if (sources.length === 0) {
      column[world] = 0
    } else if (sources.length > 1) {
      column[world] = sources.reduce((sum, source) => sum + (column[source] ?? 0), 0) / sources.length
    } else {
      const parent = sources[0]!
      const siblings = order.filter(candidate =>
        explicitColumn(candidate) === undefined &&
        predecessors[candidate]!.length === 1 &&
        predecessors[candidate]![0] === parent)
      const offset = siblings.length === 1 ? 0 : (siblings.indexOf(world) - (siblings.length - 1) / 2) * 2
      column[world] = (column[parent] ?? 0) + offset
    }
  }

  // Bonus branches, grouped by the level they leave from.
  const bonusWorlds = worldIds.filter(world => bonusOf(world))
  const branchesAt: Record<string, string[]> = {}
  for (const world of bonusWorlds) {
    const anchor = bonusOf(world)!
    const key = `${anchor.world}:${anchorLevel(levelsOf[anchor.world]!, anchor.level)}`
    ;(branchesAt[key] ??= []).push(world)
  }

  // Rows: a world's levels go down one row at a time, with a row after a level
  // for each bonus that branches off it, so the branches have room beside the path.
  const row: Record<string, Record<number, number>> = {}
  const branchRows = (world: string, level: number) => branchesAt[`${world}:${level}`]?.length ?? 0
  const placeLevels = (world: string, startRow: number) => {
    row[world] = {}
    let current = startRow
    for (const level of levelsOf[world]!) {
      row[world]![level] = current
      current += 1 + branchRows(world, level)
    }
  }
  const startRowOf = (world: string) => row[world]![levelsOf[world]![0]!]!
  const endRowOf = (world: string) => {
    const last = levelsOf[world]!.at(-1)!
    return row[world]![last]! + branchRows(world, last)
  }
  const minStartRow: Record<string, number> = {}
  // A path joining a world from the side turns in just above the world's first
  // level. Where the world carries straight on from the one above, one row
  // apart, that turn would be under the level above, as if the path came out
  // of the level itself. Such a join gets a column change's room instead, so
  // it turns in between the two levels, clear of both and of anything that
  // leaves the level above.
  const joinedFromSide = (world: string) =>
    predecessors[world]!.some(source => column[source] !== column[world]) || onwardRoots[world]!.length > 0
  // The same goes for a world carrying straight on from one that another path
  // leaves sideways: that path turns away between the two levels.
  const forksToSide = (source: string, world: string) =>
    mainEdges.some(([from, to]) => from === source && to !== world && column[to] !== column[source])
  // Worlds at the bottom of the map are placed last, below all the others.
  const placeOrder = [...order.filter(world => !isBottom(world)), ...order.filter(isBottom)]
  const placeMainWorlds = () => {
    let lowestRow = -COLUMN_CHANGE_ROWS
    for (const world of placeOrder) {
      const starts = [
        ...predecessors[world]!.map(source =>
          endRowOf(source) + (column[source] === column[world] && !joinedFromSide(world) && !forksToSide(source, world)
            ? 1
            : COLUMN_CHANGE_ROWS)),
        ...onwardRoots[world]!.map(root => endRowOf(root) + COLUMN_CHANGE_ROWS),
      ]
      if (isBottom(world)) starts.push(lowestRow + COLUMN_CHANGE_ROWS)
      placeLevels(world, Math.max(0, minStartRow[world] ?? 0, ...starts))
      if (!isBottom(world)) lowestRow = Math.max(lowestRow, endRowOf(world))
    }
  }
  placeMainWorlds()
  // Worlds in other columns that split off one world start level with each other,
  // so the split is one fork even when one of them has to wait for another path.
  // Pushing a world down can push others down too, so repeat until nothing moves.
  for (let pass = 0; pass < mainWorlds.length; pass += 1) {
    let moved = false
    for (const source of mainWorlds) {
      const targets = mainEdges
        .filter(([from, to]) => from === source && column[to] !== column[source])
        .map(([, to]) => to)
      if (targets.length < 2) continue
      const start = Math.max(...targets.map(startRowOf))
      for (const target of targets) {
        if (startRowOf(target) < start) {
          minStartRow[target] = start
          moved = true
        }
      }
    }
    if (!moved) break
    placeMainWorlds()
  }

  const levelX: Record<string, Record<number, number>> = {}
  for (const world of mainWorlds) {
    levelX[world] = Object.fromEntries(levelsOf[world]!.map(level => [level, column[world]! * columnWidth]))
  }
  // Bonus worlds after the worlds they branch off (a bonus of a bonus included):
  // a row of levels going outwards, or to the left from the centre.
  const bonusStep = Math.max(MIN_BONUS_STEP, BONUS_STEP_FRACTION * columnWidth)
  const pendingBonuses = [...bonusWorlds]
  while (pendingBonuses.length > 0) {
    const index = pendingBonuses.findIndex(world => row[bonusOf(world)!.world] !== undefined)
    if (index < 0) break
    const [world] = pendingBonuses.splice(index, 1)
    const anchor = bonusOf(world!)!
    const from = anchorLevel(levelsOf[anchor.world]!, anchor.level)
    const anchorX = levelX[anchor.world]![from]!
    const side = anchorX > 0 ? 1 : -1
    column[world!] = column[anchor.world] ?? 0
    const siblings = branchesAt[`${anchor.world}:${from}`]!
    const branchRow = row[anchor.world]![from]! + 1 + siblings.indexOf(world!)
    row[world!] = Object.fromEntries(levelsOf[world!]!.map(level => [level, branchRow]))
    // Branches that fan out from a stem start past it.
    const fanShift = siblings.length > 1 ? BONUS_FAN_SHIFT_FRACTION * bonusStep : 0
    levelX[world!] = Object.fromEntries(levelsOf[world!]!.map((level, levelIndex) =>
      [level, anchorX + side * ((levelIndex + 1) * bonusStep + fanShift)]))
  }
  const placed = worldIds.filter(world => row[world] !== undefined)

  // Colours: shared sections are grey, bonuses and continuations take the colour
  // of the world they extend, and the other worlds without one get the unused
  // palette colours in map order.
  const color: Record<string, string> = {}
  for (const world of placed) {
    const own = input.worlds[world]
    if (own?.shared) color[world] = PATH_MAP_SHARED_COLOR
    else if (own?.color) color[world] = own.color
  }
  const used = new Set(Object.values(color))
  const palette = PATH_MAP_COLORS.filter(name => !used.has(name))
  const uncoloured = placed
    .filter(world => color[world] === undefined && !bonusOf(world) && !continuesOf(world))
    .sort((a, b) => (column[a]! - column[b]!) || (row[a]![levelsOf[a]![0]!]! - row[b]![levelsOf[b]![0]!]!) || a.localeCompare(b))
  uncoloured.forEach((world, index) => {
    color[world] = palette[index % Math.max(1, palette.length)] ?? PATH_MAP_COLORS[0]!
  })
  const colorOf = (world: string): string => {
    if (color[world] !== undefined) return color[world]!
    const extended = bonusOf(world)?.world ?? continuesOf(world)
    color[world] = extended ? colorOf(extended) : PATH_MAP_COLORS[0]!
    return color[world]!
  }

  const position = (world: string, level: number): PathMapPoint => ({
    x: levelX[world]![level]!,
    y: row[world]![level]! * PATH_MAP_ROW_HEIGHT,
  })

  const nodes: PathMapNode[] = placed.flatMap(world =>
    levelsOf[world]!.map((level, index) => ({
      world,
      level,
      index: index + 1,
      ...position(world, level),
      color: colorOf(world),
    })))

  const segments: PathMapSegment[] = []
  for (const world of placed) {
    const levels = levelsOf[world]!
    for (let index = 0; index + 1 < levels.length; index += 1) {
      const from = levels[index]!
      const to = levels[index + 1]!
      segments.push({
        key: `level:${world}:${from}`,
        points: [position(world, from), position(world, to)],
        color: colorOf(world),
        source: { world, level: from },
      })
    }
  }
  // An edge leaves its source in the source's colour and turns towards the
  // target in the target's colour, so a split shows where each world begins. It
  // stays in its column until just above the target, and the curves of a split
  // leave the stem at the same point: a smooth fork.
  const bendY: Record<string, number> = {}
  const rowHeight = PATH_MAP_ROW_HEIGHT
  /** Whether a level of some world lies in column `x` strictly between two heights. */
  const columnBlocked = (x: number, fromY: number, toY: number) =>
    nodes.some(node => node.x === x && node.y > fromY && node.y < toY)
  const isShared = (world: string) => input.worlds[world]?.shared === true
  const pushEdge = (
    source: string,
    target: string,
    fromLevel: number,
    out: PathMapPoint[],
    into: PathMapPoint[],
  ) => {
    segments.push({
      key: `edge:${source}:${target}:out`,
      points: out,
      color: colorOf(source),
      source: { world: source, level: fromLevel },
    })
    segments.push({
      key: `edge:${source}:${target}:in`,
      points: into,
      color: colorOf(target),
      source: { world: source, level: fromLevel },
    })
  }
  for (const [source, target] of mainEdges) {
    if (row[source] === undefined || row[target] === undefined) continue
    const fromLevel = levelsOf[source]!.at(-1)!
    const toLevel = levelsOf[target]![0]!
    const start = position(source, fromLevel)
    const end = position(target, toLevel)
    // Where a path turns away from its source: below the bonuses off its last
    // level, and as far below those as a turn is above the level it leads to.
    const leaveY = start.y + (branchRows(source, fromLevel) + COLUMN_CHANGE_ROWS - TURN_ROWS_ABOVE) * rowHeight
    // A path to a section that belongs to no world is that section's grey as
    // soon as it has left its source, however far it still has to go.
    const earlyChangeY = isShared(target) && !isShared(source) ? leaveY - PATH_MAP_CORNER_RADIUS : Infinity
    if (start.x === end.x) {
      const change = { x: start.x, y: Math.min((start.y + end.y) / 2, earlyChangeY) }
      pushEdge(source, target, fromLevel, [start, change], [change, end])
      continue
    }
    const turnY = end.y - TURN_ROWS_ABOVE * rowHeight
    if (columnBlocked(start.x, start.y, turnY) && leaveY < turnY - PATH_MAP_CORNER_RADIUS) {
      // Another world carries on below the source, so the path can't stay in
      // its column. It leaves to the side at once and runs down a clear column:
      // the target's own if it can, or else the nearest one on the way there.
      const direction = Math.sign(end.x - start.x)
      const lanes = [end.x]
      for (let x = start.x + direction * columnWidth; (end.x - x) * direction > 0; x += direction * columnWidth) lanes.push(x)
      const laneX = lanes.find(x => !columnBlocked(x, leaveY, x === end.x ? end.y : turnY))
      if (laneX !== undefined) {
        const change = { x: start.x, y: leaveY - PATH_MAP_CORNER_RADIUS }
        const into = [change, { x: start.x, y: leaveY }, { x: laneX, y: leaveY }]
        if (laneX !== end.x) {
          into.push({ x: laneX, y: turnY }, { x: end.x, y: turnY })
          bendY[target] = Math.min(bendY[target] ?? Infinity, turnY)
        }
        pushEdge(source, target, fromLevel, [start, change], [...into, end])
        continue
      }
    }
    bendY[target] = Math.min(bendY[target] ?? Infinity, turnY)
    const change = { x: start.x, y: Math.min(turnY - PATH_MAP_CORNER_RADIUS, earlyChangeY) }
    pushEdge(source, target, fromLevel, [start, change],
      [change, { x: start.x, y: turnY }, { x: end.x, y: turnY }, end])
  }
  // A bonus world's path onwards runs down the bonus world's column, if it has
  // one, or straight down from its last level, and turns in above the target.
  for (const [source, target] of onwardEdges) {
    if (row[source] === undefined || row[target] === undefined) continue
    const fromLevel = levelsOf[source]!.at(-1)!
    const start = position(source, fromLevel)
    const end = position(target, levelsOf[target]![0]!)
    const lane = input.worlds[source]?.column
    const laneX = lane === undefined ? start.x : lane * columnWidth
    const turnY = end.y - TURN_ROWS_ABOVE * rowHeight
    const leaveY = start.y + (COLUMN_CHANGE_ROWS - TURN_ROWS_ABOVE) * rowHeight
    if (leaveY >= turnY) continue
    const change = { x: laneX, y: (isShared(target) ? leaveY : turnY) - PATH_MAP_CORNER_RADIUS }
    const out = laneX === start.x ? [start, change] : [start, { x: laneX, y: start.y }, change]
    if (laneX === end.x) {
      pushEdge(source, target, fromLevel, out, [change, end])
      continue
    }
    bendY[target] = Math.min(bendY[target] ?? Infinity, turnY)
    pushEdge(source, target, fromLevel, out, [change, { x: laneX, y: turnY }, { x: end.x, y: turnY }, end])
  }
  for (const world of placed) {
    const anchor = bonusOf(world)
    if (!anchor) continue
    const from = anchorLevel(levelsOf[anchor.world]!, anchor.level)
    const anchorPoint = position(anchor.world, from)
    const firstPoint = position(world, levelsOf[world]![0]!)
    const siblings = branchesAt[`${anchor.world}:${from}`]!
    let points = [anchorPoint, { x: anchorPoint.x, y: firstPoint.y }, firstPoint]
    if (siblings.length > 1) {
      // Several branches off one level: the first leaves the level sideways and
      // turns down a stem beside the path, and each later one carries the stem
      // on from the branch above it, so the path is left only once.
      const stemX = anchorPoint.x + Math.sign(firstPoint.x - anchorPoint.x) * BONUS_STEM_FRACTION * bonusStep
      const index = siblings.indexOf(world)
      const above = index > 0 ? position(siblings[index - 1]!, levelsOf[siblings[index - 1]!]![0]!) : undefined
      points = above
        ? [{ x: stemX, y: above.y - PATH_MAP_CORNER_RADIUS }, { x: stemX, y: firstPoint.y }, firstPoint]
        : [anchorPoint, { x: stemX, y: anchorPoint.y }, { x: stemX, y: firstPoint.y }, firstPoint]
    }
    segments.push({
      key: `bonus:${anchor.world}:${from}:${world}`,
      points,
      color: colorOf(world),
      source: { world: anchor.world, level: from },
    })
  }

  // Where the level run of one path crosses the upright run of another, a short
  // bridge is drawn over the crossing, so the two don't read as a junction.
  const bridges: PathMapSegment[] = []
  const bridged = new Set<string>()
  const edgeOf = (key: string) => key.replace(/:(?:out|in)$/u, '')
  for (const over of segments) {
    if (!over.key.startsWith('edge:')) continue
    for (let index = 0; index + 1 < over.points.length; index += 1) {
      const [a, b] = [over.points[index]!, over.points[index + 1]!]
      if (a.y !== b.y || a.x === b.x) continue
      const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
      for (const under of segments) {
        if (edgeOf(under.key) === edgeOf(over.key)) continue
        for (let leg = 0; leg + 1 < under.points.length; leg += 1) {
          const [c, d] = [under.points[leg]!, under.points[leg + 1]!]
          if (c.x !== d.x || c.y === d.y) continue
          const [top, bottom] = [Math.min(c.y, d.y), Math.max(c.y, d.y)]
          const crosses = c.x > left + BRIDGE_HALF_LENGTH && c.x < right - BRIDGE_HALF_LENGTH &&
            a.y > top + BRIDGE_HALF_LENGTH && a.y < bottom - BRIDGE_HALF_LENGTH
          const id = `${over.key}:${c.x}:${a.y}`
          if (!crosses || bridged.has(id)) continue
          bridged.add(id)
          bridges.push({
            key: `${over.key}:bridge:${c.x}`,
            points: [{ x: c.x - BRIDGE_HALF_LENGTH, y: a.y }, { x: c.x + BRIDGE_HALF_LENGTH, y: a.y }],
            color: over.color,
            source: over.source,
            bridge: true,
          })
        }
      }
    }
  }
  segments.push(...bridges)

  // World titles above the stream of each named main world. A title that a
  // path, a level or another title would run through moves beside the path
  // into its world instead: on the outer side if that is clear, to the left
  // from the centre, or else on the inner side.
  interface Box { x1: number; x2: number; y1: number; y2: number }
  const labelBox = (label: Pick<PathMapLabel, 'text' | 'x' | 'y' | 'anchor'>): Box => {
    const width = label.text.length * LABEL_CLEAR_CHAR_WIDTH
    const x1 = label.anchor === 'middle' ? label.x - width / 2 : label.anchor === 'end' ? label.x - width : label.x
    return { x1, x2: x1 + width, y1: label.y - LABEL_HALF_HEIGHT, y2: label.y + LABEL_HALF_HEIGHT }
  }
  const boxesMeet = (a: Box, b: Box, clearance: number) =>
    a.x1 < b.x2 + clearance && b.x1 < a.x2 + clearance && a.y1 < b.y2 + clearance && b.y1 < a.y2 + clearance
  const labelBoxes: Box[] = []
  /** How many paths, levels and titles a title in `box` would run into. */
  const labelBlockers = (box: Box, clearance: number) => {
    let count = 0
    for (const segment of segments) {
      for (let index = 0; index + 1 < segment.points.length; index += 1) {
        const [a, b] = [segment.points[index]!, segment.points[index + 1]!]
        const leg = {
          x1: Math.min(a.x, b.x) - PATH_HALF_WIDTH,
          x2: Math.max(a.x, b.x) + PATH_HALF_WIDTH,
          y1: Math.min(a.y, b.y) - PATH_HALF_WIDTH,
          y2: Math.max(a.y, b.y) + PATH_HALF_WIDTH,
        }
        if (boxesMeet(box, leg, clearance)) count += 1
      }
    }
    for (const node of nodes) {
      // Any level may be a boss, which is drawn larger.
      const radius = PATH_MAP_BOSS_NODE_RADIUS + clearance
      const dx = Math.max(box.x1 - node.x, 0, node.x - box.x2)
      const dy = Math.max(box.y1 - node.y, 0, node.y - box.y2)
      if (dx * dx + dy * dy < radius * radius) count += 1
    }
    return count + labelBoxes.filter(other => boxesMeet(box, other, clearance)).length
  }
  const mapCenterX = (() => {
    const first = order.find(world => row[world] !== undefined)
    return first ? position(first, levelsOf[first]![0]!).x : 0
  })()
  const labels: PathMapLabel[] = []
  for (const world of placed) {
    const own = input.worlds[world]
    if (!own || own.shared || bonusOf(world) || continuesOf(world)) continue
    const first = position(world, levelsOf[world]![0]!)
    const text = own.title || world
    const above = (top: number) => top - PATH_HALF_WIDTH - LABEL_GAP - LABEL_HALF_HEIGHT
    const y = above(bendY[world] ?? first.y - PATH_MAP_NODE_RADIUS)
    const sideGap = PATH_HALF_WIDTH + LABEL_SIDE_GAP
    const outer = first.x > mapCenterX ? 1 : -1
    const beside = (side: number, atY: number) => ({
      text,
      x: first.x + side * sideGap,
      y: atY,
      anchor: side > 0 ? 'start' as const : 'end' as const,
    })
    const besideLevelY = above(first.y - PATH_MAP_NODE_RADIUS)
    const candidates = [
      { text, x: first.x, y, anchor: 'middle' as const },
      beside(outer, y),
      beside(-outer, y),
      ...(besideLevelY === y ? [] : [beside(outer, besideLevelY), beside(-outer, besideLevelY)]),
    ]
    // The title stays above its world unless something actually runs through it
    // there. Beside the path it keeps a little clear space as well. Where nothing
    // is clear, as on a phone's narrow columns, it goes where the least is in its way.
    const blockers = candidates.map((candidate, index) =>
      labelBlockers(labelBox(candidate), index === 0 ? 0 : LABEL_CLEARANCE))
    const chosen = candidates[blockers.indexOf(Math.min(...blockers))]!
    labelBoxes.push(labelBox(chosen))
    labels.push({ world, ...chosen, color: colorOf(world) })
  }

  const xs: number[] = []
  const ys: number[] = []
  for (const node of nodes) {
    xs.push(node.x - PATH_MAP_NODE_RADIUS, node.x + PATH_MAP_NODE_RADIUS)
    ys.push(node.y - PATH_MAP_NODE_RADIUS, node.y + PATH_MAP_NODE_RADIUS)
  }
  for (const segment of segments) {
    for (const point of segment.points) {
      xs.push(point.x - PATH_HALF_WIDTH, point.x + PATH_HALF_WIDTH)
      ys.push(point.y)
    }
  }
  for (const label of labels) {
    const width = label.text.length * LABEL_CHAR_WIDTH
    const x1 = label.anchor === 'middle' ? label.x - width / 2 : label.anchor === 'end' ? label.x - width : label.x
    xs.push(x1, x1 + width)
    ys.push(label.y - 14, label.y + 8)
  }
  // Centred on where the map starts, however lopsided it gets further down.
  const centerX = mapCenterX
  const halfWidth = xs.length > 0 ? Math.max(...xs.map(x => Math.abs(x - centerX))) : 0
  const bounds = xs.length > 0
    ? { x1: centerX - halfWidth, y1: Math.min(...ys), x2: centerX + halfWidth, y2: Math.max(...ys) }
    : { x1: 0, y1: 0, x2: 0, y2: 0 }

  return { nodes, segments, labels, bounds }
}

/** An SVG path through `points` whose corners are rounded with `radius`. Two
 * corners share the leg between them, but the first and last legs have just one. */
export function roundedPathData(points: readonly PathMapPoint[], radius: number): string {
  if (points.length === 0) return ''
  let data = `M ${points[0]!.x} ${points[0]!.y}`
  for (let index = 1; index < points.length; index += 1) {
    const corner = points[index]!
    const next = points[index + 1]
    if (!next) {
      data += ` L ${corner.x} ${corner.y}`
      break
    }
    const previous = points[index - 1]!
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y)
    const inRoom = index === 1 ? inLength : inLength / 2
    const outRoom = index === points.length - 2 ? outLength : outLength / 2
    const r = Math.min(radius, inRoom, outRoom)
    if (r <= 0) {
      data += ` L ${corner.x} ${corner.y}`
      continue
    }
    const before = {
      x: corner.x + (previous.x - corner.x) * (r / inLength),
      y: corner.y + (previous.y - corner.y) * (r / inLength),
    }
    const after = {
      x: corner.x + (next.x - corner.x) * (r / outLength),
      y: corner.y + (next.y - corner.y) * (r / outLength),
    }
    data += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`
  }
  return data
}
