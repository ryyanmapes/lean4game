/**
 * @fileOverview Layout of the path-style world map (`VisualPathMap`).
 *
 * Every level is a node. A world is a column of its levels, top to bottom;
 * worlds join along the game's dependency edges, and a bonus world
 * (`VisualBonusOf`) sprouts sideways off one level of another world. The
 * layout is pure, so progress only changes how its parts are painted.
 */

export interface PathMapWorld {
  title: string
  /** Bonus branch off this level of another world. */
  bonusOf?: { world: string; level: number }
  /** Named colour, see `PATH_MAP_COLORS`. */
  color?: string
  /** Column: 0 is the centre, negative is left. */
  column?: number
  /** Not part of any named world: grey and unlabelled. */
  shared?: boolean
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
}

export interface PathMapLabel {
  world: string
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  color: string
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
/** Colour of sections that aren't part of a named world. */
export const PATH_MAP_SHARED_COLOR = 'grey'
/** Named world colours, in the order worlds without a colour receive them. */
export const PATH_MAP_COLORS = ['purple', 'amber', 'sky', 'green', 'pink', 'teal', 'orange', 'blue', 'red']

/** Where an edge into a world in another column turns, as a fraction of a row. */
const BEND_FRACTION = 0.6
/** Extra rows between worlds in different columns, for the turn. */
const COLUMN_CHANGE_ROWS = 1.5
const LABEL_GAP = 12
/** Rough label width per character, for the bounds. */
const LABEL_CHAR_WIDTH = 8.5

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
  /** World titles beside their column (wide screens) or above it (phones). */
  labelPlacement?: 'side' | 'above'
}

export function computePathMapLayout(input: PathMapInput, options: PathMapLayoutOptions = {}): PathMapLayout {
  const columnWidth = options.columnWidth ?? PATH_MAP_COLUMN_WIDTH
  const labelPlacement = options.labelPlacement ?? 'side'
  const worldIds = Object.keys(input.worlds)
    .filter(world => visibleLevels(input, world).length > 0)
    .sort()
  const present = new Set(worldIds)
  const levelsOf = Object.fromEntries(worldIds.map(world => [world, visibleLevels(input, world)]))
  const bonusOf = (world: string) => {
    const anchor = input.worlds[world]?.bonusOf
    return anchor && anchor.world !== world && present.has(anchor.world) ? anchor : undefined
  }
  const mainWorlds = worldIds.filter(world => !bonusOf(world))
  const mainSet = new Set(mainWorlds)
  const mainEdges = dedupeEdges(input.edges).filter(([source, target]) =>
    mainSet.has(source) && mainSet.has(target))
  const predecessors: Record<string, string[]> = Object.fromEntries(mainWorlds.map(world => [world, []]))
  for (const [source, target] of mainEdges) predecessors[target]!.push(source)

  // Dependency order; a cycle (which MakeGame reports) falls back to name order.
  const order: string[] = []
  const remaining = new Set(mainWorlds)
  while (remaining.size > 0) {
    const ready = [...remaining].filter(world =>
      predecessors[world]!.every(source => !remaining.has(source)))
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

  // Rows: a world's levels go down one row at a time, with an extra row after a
  // level that a bonus branches off, so the branch has room beside the path.
  const row: Record<string, Record<number, number>> = {}
  const placeLevels = (world: string, startRow: number) => {
    const levels = levelsOf[world]!
    row[world] = {}
    let current = startRow
    levels.forEach((level, index) => {
      row[world]![level] = current
      const branches = branchesAt[`${world}:${level}`]?.length ?? 0
      current += 1 + (branches > 0 && index < levels.length - 1 ? 1 : 0)
    })
  }
  const lastRow = (world: string) => row[world]![levelsOf[world]!.at(-1)!]!
  for (const world of order) {
    const sources = predecessors[world]!
    const start = sources.length === 0
      ? 0
      : Math.max(...sources.map(source =>
        lastRow(source) + (column[source] === column[world] ? 1 : COLUMN_CHANGE_ROWS)))
    placeLevels(world, start)
  }
  // Bonus worlds after the worlds they branch off (a bonus of a bonus included).
  const pendingBonuses = [...bonusWorlds]
  while (pendingBonuses.length > 0) {
    const index = pendingBonuses.findIndex(world => row[bonusOf(world)!.world] !== undefined)
    if (index < 0) break
    const [world] = pendingBonuses.splice(index, 1)
    const anchor = bonusOf(world!)!
    const from = anchorLevel(levelsOf[anchor.world]!, anchor.level)
    const anchorColumn = column[anchor.world] ?? 0
    const side = anchorColumn > 0 ? 1 : -1
    const siblings = branchesAt[`${anchor.world}:${from}`]!
    column[world!] = anchorColumn + side * (1 + siblings.indexOf(world!))
    placeLevels(world!, row[anchor.world]![from]! + 1)
  }
  const placed = worldIds.filter(world => row[world] !== undefined)

  // Colours: shared sections are grey, bonuses take their anchor's colour, and
  // the other worlds without one get the unused palette colours in map order.
  const color: Record<string, string> = {}
  for (const world of placed) {
    const own = input.worlds[world]
    if (own?.shared) color[world] = PATH_MAP_SHARED_COLOR
    else if (own?.color) color[world] = own.color
  }
  const used = new Set(Object.values(color))
  const palette = PATH_MAP_COLORS.filter(name => !used.has(name))
  const uncoloured = placed
    .filter(world => color[world] === undefined && !bonusOf(world))
    .sort((a, b) => (column[a]! - column[b]!) || (row[a]![levelsOf[a]![0]!]! - row[b]![levelsOf[b]![0]!]!) || a.localeCompare(b))
  uncoloured.forEach((world, index) => {
    color[world] = palette[index % Math.max(1, palette.length)] ?? PATH_MAP_COLORS[0]!
  })
  const colorOf = (world: string): string => {
    if (color[world] !== undefined) return color[world]!
    const anchor = bonusOf(world)
    color[world] = anchor ? colorOf(anchor.world) : PATH_MAP_COLORS[0]!
    return color[world]!
  }

  const x = (world: string) => column[world]! * columnWidth
  const y = (world: string, level: number) => row[world]![level]! * PATH_MAP_ROW_HEIGHT

  const nodes: PathMapNode[] = placed.flatMap(world =>
    levelsOf[world]!.map((level, index) => ({
      world,
      level,
      index: index + 1,
      x: x(world),
      y: y(world, level),
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
        points: [{ x: x(world), y: y(world, from) }, { x: x(world), y: y(world, to) }],
        color: colorOf(world),
        source: { world, level: from },
      })
    }
  }
  // An edge leaves its source in the source's colour and turns towards the
  // target in the target's colour, so a split shows where each world begins.
  const bendY: Record<string, number> = {}
  for (const [source, target] of mainEdges) {
    if (row[source] === undefined || row[target] === undefined) continue
    const fromLevel = levelsOf[source]!.at(-1)!
    const toLevel = levelsOf[target]![0]!
    const start = { x: x(source), y: y(source, fromLevel) }
    const end = { x: x(target), y: y(target, toLevel) }
    const sameColumn = start.x === end.x
    const turnY = sameColumn
      ? (start.y + end.y) / 2
      : start.y + BEND_FRACTION * PATH_MAP_ROW_HEIGHT
    if (!sameColumn) bendY[target] = Math.min(bendY[target] ?? Infinity, turnY)
    segments.push({
      key: `edge:${source}:${target}:out`,
      points: [start, { x: start.x, y: turnY }],
      color: colorOf(source),
      source: { world: source, level: fromLevel },
    })
    segments.push({
      key: `edge:${source}:${target}:in`,
      points: sameColumn
        ? [{ x: start.x, y: turnY }, end]
        : [{ x: start.x, y: turnY }, { x: end.x, y: turnY }, end],
      color: colorOf(target),
      source: { world: source, level: fromLevel },
    })
  }
  for (const world of placed) {
    const anchor = bonusOf(world)
    if (!anchor) continue
    const from = anchorLevel(levelsOf[anchor.world]!, anchor.level)
    const first = levelsOf[world]![0]!
    const branchY = y(world, first)
    segments.push({
      key: `bonus:${anchor.world}:${from}:${world}`,
      points: [
        { x: x(anchor.world), y: y(anchor.world, from) },
        { x: x(anchor.world), y: branchY },
        { x: x(world), y: branchY },
      ],
      color: colorOf(world),
      source: { world: anchor.world, level: from },
    })
  }

  // World titles beside the start of each named main world, on the outer side.
  const labels: PathMapLabel[] = []
  for (const world of placed) {
    const own = input.worlds[world]
    if (!own || own.shared || bonusOf(world)) continue
    const first = levelsOf[world]![0]!
    const nodeX = x(world)
    const nodeY = y(world, first)
    const text = own.title || world
    if (labelPlacement === 'above' && column[world]! !== 0) {
      labels.push({ world, text, x: nodeX, y: (bendY[world] ?? nodeY - PATH_MAP_NODE_RADIUS) - LABEL_GAP - 8, anchor: 'middle', color: colorOf(world) })
    } else if (column[world]! < 0) {
      labels.push({ world, text, x: nodeX - PATH_MAP_NODE_RADIUS - LABEL_GAP, y: bendY[world] ?? nodeY, anchor: 'end', color: colorOf(world) })
    } else if (column[world]! > 0) {
      labels.push({ world, text, x: nodeX + PATH_MAP_NODE_RADIUS + LABEL_GAP, y: bendY[world] ?? nodeY, anchor: 'start', color: colorOf(world) })
    } else {
      labels.push({ world, text, x: nodeX, y: nodeY - PATH_MAP_NODE_RADIUS - LABEL_GAP, anchor: 'middle', color: colorOf(world) })
    }
  }

  const xs: number[] = []
  const ys: number[] = []
  for (const node of nodes) {
    xs.push(node.x - PATH_MAP_NODE_RADIUS, node.x + PATH_MAP_NODE_RADIUS)
    ys.push(node.y - PATH_MAP_NODE_RADIUS, node.y + PATH_MAP_NODE_RADIUS)
  }
  for (const label of labels) {
    const width = label.text.length * LABEL_CHAR_WIDTH
    const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2
    xs.push(left, left + width)
    ys.push(label.y - 14, label.y + 8)
  }
  const bounds = xs.length > 0
    ? { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
    : { x1: 0, y1: 0, x2: 0, y2: 0 }

  return { nodes, segments, labels, bounds }
}

/** An SVG path through `points` whose corners are rounded with `radius`. */
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
    const r = Math.min(radius, inLength / 2, outLength / 2)
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
