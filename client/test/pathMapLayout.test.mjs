import test from 'node:test'
import assert from 'node:assert/strict'

const { computePathMapLayout, roundedPathData, PATH_MAP_COLUMN_WIDTH, PATH_MAP_CORNER_RADIUS, PATH_MAP_ROW_HEIGHT } =
  await import('../../tmp-path-map-tests/visual/pathMapLayout.js')

// An earlier map of the Natural Numbers Video Game: a welcome text level, then Rewrite
// World on the left (with a bonus off its third level) and Proposition World on the
// right. Rewrite World leads to Induction World. Proposition World forks: its left
// branch joins the middle of Induction World, and its right branch carries on with a
// bonus. A bonus also leaves the end of Induction World's first part, right where
// Proposition World's branch joins.
const nnvg = {
  worlds: {
    Intro: { title: 'Welcome', shared: true, column: 0 },
    Rewrite: { title: 'Rewrite World', color: 'amber', column: -1 },
    RewriteBonus: { title: 'Rewrite World Bonus', bonusOf: { world: 'Rewrite', level: 3 } },
    Proposition: { title: 'Proposition World', color: 'sky', column: 1 },
    PropositionRight: { title: 'Proposition World', continues: 'Proposition', column: 2 },
    PropositionBonus: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 2 } },
    PropositionBonusB: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 7 } },
    Induction: { title: 'Induction World', color: 'green', column: 0 },
    InductionJoined: { title: 'Induction World', continues: 'Induction', column: 0 },
    InductionBonus: { title: 'Induction World Bonus', bonusOf: { world: 'Induction', level: 3 } },
  },
  edges: [
    ['Rewrite', 'RewriteBonus'],
    ['PropositionRight', 'PropositionBonus'],
    ['PropositionRight', 'PropositionBonusB'],
    ['Induction', 'InductionBonus'],
    ['Intro', 'Proposition'],
    ['Intro', 'Rewrite'],
    ['Rewrite', 'Induction'],
    ['Induction', 'InductionJoined'],
    ['Proposition', 'InductionJoined'],
    ['Proposition', 'PropositionRight'],
  ],
  worldSize: {
    Intro: 1,
    Rewrite: 6,
    RewriteBonus: 2,
    Proposition: 7,
    PropositionRight: 7,
    PropositionBonus: 1,
    PropositionBonusB: 3,
    Induction: 3,
    InductionJoined: 1,
    InductionBonus: 1,
  },
}

const node = (layout, world, level) => layout.nodes.find(n => n.world === world && n.level === level)
const segment = (layout, key) => layout.segments.find(s => s.key === key)

test('worlds are columns of their levels, split after the shared opening', () => {
  const layout = computePathMapLayout(nnvg)
  const intro = node(layout, 'Intro', 1)
  assert.equal(intro.x, 0)
  assert.equal(intro.color, 'grey')
  for (let level = 1; level <= 6; level += 1) {
    assert.equal(node(layout, 'Rewrite', level).x, -PATH_MAP_COLUMN_WIDTH)
    assert.equal(node(layout, 'Proposition', level).x, PATH_MAP_COLUMN_WIDTH)
  }
  // Both worlds start on the same row, below the opening.
  assert.equal(node(layout, 'Rewrite', 1).y, node(layout, 'Proposition', 1).y)
  assert.ok(node(layout, 'Rewrite', 1).y > intro.y)
  // Levels go down the column.
  assert.ok(node(layout, 'Rewrite', 2).y > node(layout, 'Rewrite', 1).y)
})

test('a bonus is a row of levels sprouting from its anchor, beside the next level of the path', () => {
  const layout = computePathMapLayout(nnvg)
  const anchor = node(layout, 'Rewrite', 3)
  const next = node(layout, 'Rewrite', 4)
  const first = node(layout, 'RewriteBonus', 1)
  const second = node(layout, 'RewriteBonus', 2)
  // Outward from a left column, one row below the anchor, where the path's next
  // level is listed too.
  assert.ok(first.x < anchor.x)
  assert.ok(second.x < first.x)
  assert.equal(second.y, first.y)
  assert.equal(first.y, anchor.y + PATH_MAP_ROW_HEIGHT)
  assert.equal(next.y, first.y)
  assert.equal(first.color, 'amber')
  const branch = segment(layout, 'bonus:Rewrite:3:RewriteBonus')
  assert.deepEqual(branch.source, { world: 'Rewrite', level: 3 })
  assert.deepEqual(branch.points.at(-1), { x: first.x, y: first.y })
  // It leaves the anchor sideways and runs down a stem, clear of the next level.
  const stemX = branch.points[1].x
  assert.deepEqual(branch.points.slice(0, 3), [
    { x: anchor.x, y: anchor.y }, { x: stemX, y: anchor.y }, { x: stemX, y: first.y },
  ])
  assert.ok(anchor.x - stemX > 31 + 8, 'the stem is clear of the next level, even a boss')
  assert.ok(stemX - first.x > 22 + PATH_MAP_CORNER_RADIUS, 'the branch has room to turn off the stem')
  // The bonus's own levels are joined along the row.
  assert.deepEqual(segment(layout, 'level:RewriteBonus:1').points, [
    { x: first.x, y: first.y },
    { x: second.x, y: second.y },
  ])
  // The edge MakeGame adds from Rewrite to its bonus is not drawn as a world edge.
  assert.equal(layout.segments.some(s => s.key.startsWith('edge:Rewrite:RewriteBonus')), false)
})

test('bonuses go outwards on the right, and to the left from the centre', () => {
  const layout = computePathMapLayout(nnvg)
  assert.ok(node(layout, 'PropositionBonus', 1).x > node(layout, 'PropositionRight', 1).x)
  assert.ok(node(layout, 'InductionBonus', 1).x < node(layout, 'Induction', 3).x)
})

test('a bonus off the last level of a chain is a row below it', () => {
  const layout = computePathMapLayout(nnvg)
  const boss = node(layout, 'PropositionRight', 7)
  const levels = [1, 2, 3].map(level => node(layout, 'PropositionBonusB', level))
  assert.ok(levels.every(level => level.y > boss.y && level.y === levels[0].y))
  assert.ok(levels[0].x > boss.x && levels[1].x > levels[0].x && levels[2].x > levels[1].x)
  assert.ok(segment(layout, 'bonus:PropositionRight:7:PropositionBonusB'))
  assert.ok(layout.bounds.y2 >= levels[0].y)
})

test('the map is centred on its first level, however lopsided it gets below', () => {
  const layout = computePathMapLayout(nnvg)
  const intro = node(layout, 'Intro', 1)
  assert.equal(layout.bounds.x1 + layout.bounds.x2, 2 * intro.x)
  // Everything still fits: the row off the far-right boss sets the width.
  for (const n of layout.nodes) {
    assert.ok(n.x >= layout.bounds.x1 && n.x <= layout.bounds.x2)
  }
  assert.ok(node(layout, 'PropositionBonusB', 3).x + 22 === layout.bounds.x2)
})

test('world titles have room above the path below them', () => {
  const layout = computePathMapLayout(nnvg)
  for (const label of layout.labels) {
    const source = label.world === 'Induction' ? 'Rewrite' : 'Intro'
    const turnY = segment(layout, `edge:${source}:${label.world}:in`).points[1].y
    // The title's middle, less half of its text, clears the top of the path by 22.
    assert.equal(turnY - 8 - (label.y + 8), 22)
  }
})

test('a split leaves in the shared grey and turns in each world colour', () => {
  const layout = computePathMapLayout(nnvg)
  const out = segment(layout, 'edge:Intro:Rewrite:out')
  const into = segment(layout, 'edge:Intro:Rewrite:in')
  assert.equal(out.color, 'grey')
  assert.equal(into.color, 'amber')
  assert.deepEqual(into.source, { world: 'Intro', level: 1 })
  // The colours change where the curve starts, one corner radius above the turn.
  assert.deepEqual(out.points.at(-1), into.points[0])
  assert.equal(into.points[1].y - into.points[0].y, PATH_MAP_CORNER_RADIUS)
  assert.equal(into.points.length, 4)
})

test('a fork leaves its stem at one point, however far down its targets are', () => {
  const layout = computePathMapLayout(nnvg)
  const left = segment(layout, 'edge:Proposition:InductionJoined:in')
  const right = segment(layout, 'edge:Proposition:PropositionRight:in')
  assert.deepEqual(left.points[0], right.points[0])
  assert.equal(left.points[1].y, right.points[1].y)
  assert.equal(node(layout, 'PropositionRight', 1).y, node(layout, 'InductionJoined', 1).y)
  // The stem runs from Proposition World's last level straight down to the fork.
  const stem = segment(layout, 'edge:Proposition:PropositionRight:out')
  assert.equal(stem.points[0].x, stem.points[1].x)
  assert.ok(stem.points[1].y > node(layout, 'Induction', 3).y)
})

test('a world joined by two paths waits below both of them', () => {
  const layout = computePathMapLayout(nnvg)
  const joined = node(layout, 'InductionJoined', 1)
  assert.equal(joined.x, node(layout, 'Induction', 3).x)
  assert.ok(joined.y > node(layout, 'Induction', 3).y)
  assert.ok(joined.y > node(layout, 'Proposition', 7).y)
  // Room is left for the bonus off Induction World's last level.
  assert.ok(joined.y > node(layout, 'InductionBonus', 1).y)
  assert.ok(segment(layout, 'edge:Induction:InductionJoined:in'))
  assert.equal(segment(layout, 'edge:Proposition:InductionJoined:in').color, 'green')
})

test('a continuation takes the colour of the world it carries on', () => {
  const layout = computePathMapLayout(nnvg)
  assert.equal(node(layout, 'PropositionRight', 1).color, 'sky')
  assert.equal(node(layout, 'InductionJoined', 1).color, 'green')
  assert.equal(node(layout, 'PropositionBonus', 1).color, 'sky')
  assert.equal(node(layout, 'PropositionBonusB', 1).color, 'sky')
})

test('named worlds are labelled above their streams; the others are not labelled', () => {
  const layout = computePathMapLayout(nnvg)
  const byWorld = Object.fromEntries(layout.labels.map(label => [label.world, label]))
  assert.deepEqual(Object.keys(byWorld).sort(), ['Induction', 'Proposition', 'Rewrite'])
  assert.equal(byWorld.Rewrite.text, 'Rewrite World')
  for (const world of ['Rewrite', 'Proposition', 'Induction']) {
    assert.equal(byWorld[world].x, node(layout, world, 1).x)
    assert.ok(byWorld[world].y < segment(layout, `edge:${world === 'Induction' ? 'Rewrite' : 'Intro'}:${world}:in`).points[1].y)
  }
})

test('without columns, worlds split off one world spread around it', () => {
  const layout = computePathMapLayout({
    worlds: { A: { title: 'A' }, B: { title: 'B' }, C: { title: 'C' }, D: { title: 'D' } },
    edges: [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']],
    worldSize: { A: 1, B: 2, C: 1, D: 1 },
  })
  assert.equal(node(layout, 'A', 1).x, 0)
  assert.equal(node(layout, 'B', 1).x, -PATH_MAP_COLUMN_WIDTH)
  assert.equal(node(layout, 'C', 1).x, PATH_MAP_COLUMN_WIDTH)
  // A merge sits between its sources, below the longer one.
  assert.equal(node(layout, 'D', 1).x, 0)
  assert.ok(node(layout, 'D', 1).y > node(layout, 'B', 2).y)
  // Worlds without a colour get distinct palette colours.
  assert.notEqual(node(layout, 'B', 1).color, node(layout, 'C', 1).color)
})

test('skipped levels and empty worlds take no place on the map', () => {
  const layout = computePathMapLayout({
    worlds: { A: { title: 'A' }, Hidden: { title: 'Hidden' } },
    edges: [['A', 'Hidden']],
    worldSize: { A: 3, Hidden: 1 },
    skippedLevels: { A: [2], Hidden: [1] },
  })
  assert.deepEqual(layout.nodes.map(n => `${n.world}:${n.level}:${n.index}`), ['A:1:1', 'A:3:2'])
  assert.equal(layout.segments.length, 1)
})

test('corners of a path are rounded', () => {
  const data = roundedPathData([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }], 20)
  assert.equal(data, 'M 0 0 L 0 30 Q 0 50 20 50 L 100 50')
})

test('an end leg gives its whole length to its corner; a shared leg splits between two', () => {
  const wide = roundedPathData([{ x: 0, y: 0 }, { x: 0, y: 26 }, { x: 100, y: 26 }, { x: 100, y: 100 }], 26)
  assert.equal(wide, 'M 0 0 L 0 0 Q 0 26 26 26 L 74 26 Q 100 26 100 52 L 100 100')
  const narrow = roundedPathData([{ x: 0, y: 0 }, { x: 0, y: 26 }, { x: 40, y: 26 }, { x: 40, y: 100 }], 26)
  assert.equal(narrow, 'M 0 0 L 0 6 Q 0 26 20 26 L 20 26 Q 40 26 40 46 L 40 100')
})

test('phones can use narrower columns', () => {
  const layout = computePathMapLayout(nnvg, { columnWidth: 100 })
  assert.equal(node(layout, 'Rewrite', 1).x, -100)
  const rewrite = layout.labels.find(label => label.world === 'Rewrite')
  assert.equal(rewrite.x, -100)
  assert.ok(rewrite.y < node(layout, 'Rewrite', 1).y)
})

test('a path joining from the side turns in below a bonus leaving the level above', () => {
  const layout = computePathMapLayout(nnvg)
  // The bonus leaves Induction World's stem one row below its last level...
  const split = node(layout, 'InductionBonus', 1).y
  // ...and Proposition World's branch turns in on the same stem further down.
  const join = segment(layout, 'edge:Proposition:InductionJoined:in').points[1].y
  assert.ok(join - split >= PATH_MAP_ROW_HEIGHT, `join at ${join}, split at ${split}`)
})

// The map since the 2026-11-09 spec: Successor World (split by Proposition World's
// branch) leads to Induction World on the left and, with all of Proposition World, to
// the ≠ World, whose last levels also wait for Induction World.
const nnvg3 = {
  worlds: {
    Intro: { title: 'Welcome', shared: true, column: 0 },
    Rewrite: { title: 'Rewrite World', color: 'amber', column: -1 },
    RewriteBonus: { title: 'Rewrite World Bonus', bonusOf: { world: 'Rewrite', level: 3 } },
    Proposition: { title: 'Proposition World', color: 'sky', column: 1 },
    PropositionRight: { title: 'Proposition World', continues: 'Proposition', column: 2 },
    PropositionBonus: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 2 } },
    PropositionBonusB: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 7 } },
    Successor: { title: 'Successor World', color: 'green', column: 0 },
    SuccessorJoined: { title: 'Successor World', continues: 'Successor', column: 0 },
    Induction: { title: 'Induction World', color: 'pink', column: -1 },
    Neq: { title: '≠ World', color: 'teal', column: 1 },
    NeqJoined: { title: '≠ World', continues: 'Neq', column: 1 },
  },
  edges: [
    ['Induction', 'NeqJoined'], ['Intro', 'Proposition'], ['Intro', 'Rewrite'], ['Neq', 'NeqJoined'],
    ['Proposition', 'PropositionRight'], ['Proposition', 'SuccessorJoined'], ['PropositionRight', 'Neq'],
    ['PropositionRight', 'PropositionBonus'], ['PropositionRight', 'PropositionBonusB'],
    ['Rewrite', 'RewriteBonus'], ['Rewrite', 'Successor'], ['Successor', 'SuccessorJoined'],
    ['SuccessorJoined', 'Induction'], ['SuccessorJoined', 'Neq'],
  ],
  worldSize: {
    Intro: 1, Rewrite: 6, RewriteBonus: 1, Proposition: 7, PropositionRight: 7, PropositionBonus: 1,
    PropositionBonusB: 3, Successor: 3, SuccessorJoined: 2, Induction: 4, Neq: 8, NeqJoined: 2,
  },
}

test('a path joining a world that carries straight on turns in between its levels', () => {
  const layout = computePathMapLayout(nnvg3)
  for (const [key, above, below] of [
    ['edge:Proposition:SuccessorJoined:in', node(layout, 'Successor', 3), node(layout, 'SuccessorJoined', 1)],
    ['edge:Induction:NeqJoined:in', node(layout, 'Neq', 8), node(layout, 'NeqJoined', 1)],
  ]) {
    const turn = segment(layout, key).points[1].y
    assert.ok(turn - above.y >= PATH_MAP_ROW_HEIGHT, `${key} turns in at ${turn}, under the level at ${above.y}`)
    assert.ok(below.y - turn >= PATH_MAP_ROW_HEIGHT / 2, `${key} turns in at ${turn}, on the level at ${below.y}`)
    assert.equal(below.y - above.y, 2 * PATH_MAP_ROW_HEIGHT)
  }
  // A world nothing joins from the side still carries on one row down.
  const straight = computePathMapLayout({
    worlds: { A: { title: 'A', column: 0 }, B: { title: 'A', continues: 'A', column: 0 } },
    edges: [['A', 'B']],
    worldSize: { A: 2, B: 1 },
  })
  assert.equal(node(straight, 'B', 1).y - node(straight, 'A', 2).y, PATH_MAP_ROW_HEIGHT)
})

test('no path runs over the levels of another world', () => {
  const layout = computePathMapLayout(nnvg3)
  for (const seg of layout.segments) {
    for (let index = 0; index + 1 < seg.points.length; index += 1) {
      const [a, b] = [seg.points[index], seg.points[index + 1]]
      for (const n of layout.nodes) {
        const onVertical = a.x === b.x && n.x === a.x && n.y > Math.min(a.y, b.y) && n.y < Math.max(a.y, b.y)
        const onHorizontal = a.y === b.y && n.y === a.y && n.x > Math.min(a.x, b.x) && n.x < Math.max(a.x, b.x)
        assert.ok(!onVertical && !onHorizontal, `${seg.key} runs over ${n.world} ${n.level}`)
      }
    }
  }
})

test('Successor World forks to Induction World and the ≠ World, which Proposition World joins', () => {
  const layout = computePathMapLayout(nnvg3)
  const toInduction = segment(layout, 'edge:SuccessorJoined:Induction:in')
  const toNeq = segment(layout, 'edge:SuccessorJoined:Neq:in')
  assert.deepEqual(toInduction.points[0], toNeq.points[0])
  assert.ok(node(layout, 'Induction', 1).x < node(layout, 'SuccessorJoined', 2).x)
  assert.ok(node(layout, 'Neq', 1).x > node(layout, 'SuccessorJoined', 2).x)
  assert.ok(node(layout, 'Neq', 1).y > node(layout, 'PropositionBonusB', 1).y)
  assert.equal(node(layout, 'NeqJoined', 1).color, 'teal')
  assert.ok(node(layout, 'NeqJoined', 1).y > node(layout, 'Induction', 4).y)
})

// The map since the second 2026-11-10 spec pull: the ≠ boss off to the side, and the
// worlds ported from NNG4 below: Multiplication and Power World on the far left,
// Advanced Addition World in the middle, ≤ World and Advanced Multiplication World under
// Induction World, and the closing text at the bottom.
const nnvg4 = {
  worlds: {
    ...nnvg3.worlds,
    NeqBoss: { title: '≠ World Boss', bonusOf: { world: 'NeqJoined', level: 1 } },
    Multiplication: { title: 'Multiplication World', color: 'orange', column: -2 },
    Power: { title: 'Power World', color: 'red', column: -2 },
    PowerBonus: { title: 'Power World Bonus', bonusOf: { world: 'Power', level: 9 } },
    AdvAddition: { title: 'Advanced Addition World', color: 'purple', column: 0 },
    LessOrEqual: { title: '≤ World', color: 'blue', column: -1 },
    AdvMultiplication: { title: 'Advanced Multiplication World', color: 'indigo', column: -1 },
    Outro: { title: 'Thank you', shared: true, column: 0 },
  },
  edges: [
    ...nnvg3.edges,
    // As MakeGame writes them: the edges a path already implies are left out.
    ['NeqJoined', 'NeqBoss'], ['Power', 'PowerBonus'],
    ['Induction', 'Multiplication'], ['Multiplication', 'Power'],
    ['NeqJoined', 'AdvAddition'],
    ['AdvAddition', 'LessOrEqual'], ['LessOrEqual', 'AdvMultiplication'], ['Power', 'AdvMultiplication'],
    ['AdvMultiplication', 'Outro'],
  ],
  worldSize: {
    ...nnvg3.worldSize, RewriteBonus: 1, Neq: 8, NeqJoined: 1, NeqBoss: 1,
    Multiplication: 9, Power: 9, PowerBonus: 1, AdvAddition: 6, LessOrEqual: 10, AdvMultiplication: 10, Outro: 1,
  },
}

test('the ported worlds and the closing text keep clear of each other', () => {
  const layout = computePathMapLayout(nnvg4)
  for (const seg of layout.segments) {
    for (let index = 0; index + 1 < seg.points.length; index += 1) {
      const [a, b] = [seg.points[index], seg.points[index + 1]]
      for (const n of layout.nodes) {
        const onVertical = a.x === b.x && n.x === a.x && n.y > Math.min(a.y, b.y) && n.y < Math.max(a.y, b.y)
        const onHorizontal = a.y === b.y && n.y === a.y && n.x > Math.min(a.x, b.x) && n.x < Math.max(a.x, b.x)
        assert.ok(!onVertical && !onHorizontal, `${seg.key} runs over ${n.world} ${n.level}`)
      }
    }
  }
  // No two levels share a spot.
  for (const a of layout.nodes) for (const b of layout.nodes) {
    if (a !== b) assert.ok(a.x !== b.x || a.y !== b.y, `${a.world} ${a.level} on ${b.world} ${b.level}`)
  }
  const outro = node(layout, 'Outro', 1)
  for (const n of layout.nodes) if (n.world !== 'Outro') assert.ok(n.y < outro.y, `${n.world} ${n.level} below the closing text`)
  assert.ok(node(layout, 'Multiplication', 1).x < node(layout, 'Induction', 1).x)
  assert.equal(node(layout, 'Power', 1).x, node(layout, 'Multiplication', 9).x)
  assert.ok(node(layout, 'PowerBonus', 1).x < node(layout, 'Power', 9).x)
  assert.ok(node(layout, 'NeqBoss', 1).x > node(layout, 'NeqJoined', 1).x)
  assert.ok(node(layout, 'LessOrEqual', 1).y > node(layout, 'Induction', 4).y)
  assert.equal(node(layout, 'AdvMultiplication', 10).color, 'indigo')
})

// The map of the 2026-11-11 spec pull (The End then followed Advanced Addition World): ≤ World leaves Advanced Addition World to the
// right, and Advanced Multiplication World carries on below it, needing only that and
// Multiplication World, whose path comes across from the far left. The End sits at the
// bottom, joined by Power World, Advanced Addition World and the ≠ boss, whose path runs
// down column 3.
const nnvg5 = {
  worlds: {
    ...nnvg4.worlds,
    NeqBoss: { title: '≠ World Boss', bonusOf: { world: 'NeqJoined', level: 1 }, column: 3 },
    LessOrEqual: { title: '≤ World', color: 'blue', column: 1 },
    AdvMultiplication: { title: 'Advanced Multiplication World', color: 'indigo', column: 1 },
    Outro: { title: 'The End', shared: true, column: 0, bottom: true },
  },
  edges: [
    ...nnvg3.edges,
    ['NeqJoined', 'NeqBoss'], ['Power', 'PowerBonus'],
    ['Induction', 'Multiplication'], ['Multiplication', 'Power'],
    ['NeqJoined', 'AdvAddition'],
    ['AdvAddition', 'LessOrEqual'], ['LessOrEqual', 'AdvMultiplication'], ['Multiplication', 'AdvMultiplication'],
    ['Power', 'Outro'], ['AdvAddition', 'Outro'], ['NeqBoss', 'Outro'],
  ],
  worldSize: { ...nnvg4.worldSize, AdvAddition: 5 },
}

function assertNoPathOverLevels(layout) {
  for (const seg of layout.segments) {
    for (let index = 0; index + 1 < seg.points.length; index += 1) {
      const [a, b] = [seg.points[index], seg.points[index + 1]]
      for (const n of layout.nodes) {
        const onVertical = a.x === b.x && n.x === a.x && n.y > Math.min(a.y, b.y) && n.y < Math.max(a.y, b.y)
        const onHorizontal = a.y === b.y && n.y === a.y && n.x > Math.min(a.x, b.x) && n.x < Math.max(a.x, b.x)
        assert.ok(!onVertical && !onHorizontal, `${seg.key} runs over ${n.world} ${n.level}`)
      }
    }
  }
}

test('a closing level sits below every world, joined by a path from each world it follows', () => {
  const layout = computePathMapLayout(nnvg5)
  assertNoPathOverLevels(layout)
  const end = node(layout, 'Outro', 1)
  assert.equal(end.x, 0)
  for (const n of layout.nodes) {
    if (n.world !== 'Outro') assert.ok(end.y - n.y >= 2 * PATH_MAP_ROW_HEIGHT, `${n.world} ${n.level} is not above The End`)
  }
  for (const source of ['Power', 'AdvAddition', 'NeqBoss']) {
    const into = segment(layout, `edge:${source}:Outro:in`)
    assert.ok(into, `no path from ${source}`)
    assert.deepEqual(into.points.at(-1), { x: end.x, y: end.y })
    assert.equal(into.color, 'grey')
    const out = segment(layout, `edge:${source}:Outro:out`)
    assert.equal(out.color, node(layout, source, 1).color)
    // The path is grey soon after it leaves, not all the way down in its world's colour.
    const last = node(layout, source, nnvg5.worldSize[source])
    assert.ok(into.points[0].y - last.y <= 2.1 * PATH_MAP_ROW_HEIGHT, `the path from ${source} stays coloured`)
  }
  // Advanced Addition World's path runs straight down the middle.
  assert.equal(segment(layout, 'edge:AdvAddition:Outro:in').points.length, 2)
})

test('a path onwards from a bonus level runs down the column of the bonus world', () => {
  const layout = computePathMapLayout(nnvg5)
  const boss = node(layout, 'NeqBoss', 1)
  const out = segment(layout, 'edge:NeqBoss:Outro:out')
  assert.deepEqual(out.points[0], { x: boss.x, y: boss.y })
  assert.deepEqual(out.points[1], { x: 3 * PATH_MAP_COLUMN_WIDTH, y: boss.y })
  const into = segment(layout, 'edge:NeqBoss:Outro:in')
  assert.ok(into.points.slice(0, 2).every(point => point.x === 3 * PATH_MAP_COLUMN_WIDTH))
  assert.deepEqual(out.source, { world: 'NeqBoss', level: 1 })
  // Without a column, it goes straight down from the bonus level.
  const plain = computePathMapLayout({
    ...nnvg5,
    worlds: { ...nnvg5.worlds, NeqBoss: { ...nnvg5.worlds.NeqBoss, column: undefined } },
  })
  const plainBoss = node(plain, 'NeqBoss', 1)
  assert.ok(segment(plain, 'edge:NeqBoss:Outro:in').points.slice(0, 2).every(point => point.x === plainBoss.x))
  // The edge MakeGame adds from the ≠ World to its boss is still not drawn as a world edge.
  assert.equal(layout.segments.some(s => s.key.startsWith('edge:NeqJoined:NeqBoss')), false)
})

test('a path leaves to the side at once when its world carries straight on below', () => {
  const layout = computePathMapLayout(nnvg5)
  const last = node(layout, 'Multiplication', 9)
  const power = node(layout, 'Power', 1)
  const target = node(layout, 'AdvMultiplication', 1)
  // Power World carries on in the same column, with room for the turn in between.
  assert.equal(power.x, last.x)
  assert.equal(power.y - last.y, 2 * PATH_MAP_ROW_HEIGHT)
  const into = segment(layout, 'edge:Multiplication:AdvMultiplication:in')
  const leaveY = into.points[1].y
  assert.ok(leaveY > last.y && leaveY < power.y)
  // It runs down the next column, which is clear, and crosses to its world above it.
  assert.equal(into.points[2].x, last.x + PATH_MAP_COLUMN_WIDTH)
  assert.equal(into.points[2].y, leaveY)
  assert.equal(into.points[3].x, last.x + PATH_MAP_COLUMN_WIDTH)
  assert.ok(target.y - into.points[3].y < PATH_MAP_ROW_HEIGHT)
  assert.deepEqual(into.points.at(-1), { x: target.x, y: target.y })
  assert.equal(into.color, 'indigo')
  // ≤ World leaves Advanced Addition World to the right, and its successor carries on below.
  assert.ok(node(layout, 'LessOrEqual', 1).x > node(layout, 'AdvAddition', 5).x)
  assert.equal(target.x, node(layout, 'LessOrEqual', 10).x)
  assert.equal(target.y - node(layout, 'LessOrEqual', 10).y, 2 * PATH_MAP_ROW_HEIGHT)
})

test('a path crossing another bridges it', () => {
  const layout = computePathMapLayout(nnvg5)
  const bridges = layout.segments.filter(s => s.bridge)
  assert.equal(bridges.length, 1)
  const [bridge] = bridges
  const into = segment(layout, 'edge:Multiplication:AdvMultiplication:in')
  // Over the path from Advanced Addition World down to The End, in the middle column.
  assert.equal((bridge.points[0].x + bridge.points[1].x) / 2, 0)
  assert.equal(bridge.points[0].y, into.points[3].y)
  assert.equal(bridge.color, into.color)
  assert.deepEqual(bridge.source, into.source)
  // Forks and joins are junctions, not crossings.
  assert.equal(computePathMapLayout(nnvg3).segments.some(s => s.bridge), false)
})

test('world titles keep clear of paths, levels and each other', () => {
  const layout = computePathMapLayout(nnvg5)
  const boxOf = label => {
    const width = label.text.length * 9
    const x1 = label.anchor === 'middle' ? label.x - width / 2 : label.anchor === 'end' ? label.x - width : label.x
    return { x1, x2: x1 + width, y1: label.y - 8, y2: label.y + 8 }
  }
  for (const label of layout.labels) {
    const box = boxOf(label)
    for (const seg of layout.segments) {
      for (let index = 0; index + 1 < seg.points.length; index += 1) {
        const [a, b] = [seg.points[index], seg.points[index + 1]]
        const clear = box.x2 < Math.min(a.x, b.x) - 8 || box.x1 > Math.max(a.x, b.x) + 8 ||
          box.y2 < Math.min(a.y, b.y) - 8 || box.y1 > Math.max(a.y, b.y) + 8
        assert.ok(clear, `${label.text} is on ${seg.key}`)
      }
    }
    for (const n of layout.nodes) {
      const dx = Math.max(box.x1 - n.x, 0, n.x - box.x2)
      const dy = Math.max(box.y1 - n.y, 0, n.y - box.y2)
      assert.ok(Math.hypot(dx, dy) > 31, `${label.text} is on ${n.world} ${n.level}`)
    }
    for (const other of layout.labels) {
      if (other === label) continue
      const otherBox = boxOf(other)
      assert.ok(box.x2 < otherBox.x1 || otherBox.x2 < box.x1 || box.y2 < otherBox.y1 || otherBox.y2 < box.y1,
        `${label.text} is on ${other.text}`)
    }
  }
  const byWorld = Object.fromEntries(layout.labels.map(label => [label.world, label]))
  // A world entered from straight above has its title beside the path, on the outer side.
  assert.equal(byWorld.Power.anchor, 'end')
  assert.ok(byWorld.Power.x < node(layout, 'Power', 1).x)
  assert.equal(byWorld.AdvMultiplication.anchor, 'start')
  assert.ok(byWorld.AdvMultiplication.x > node(layout, 'AdvMultiplication', 1).x)
  // One entered round a bend keeps its title above the bend.
  assert.equal(byWorld.LessOrEqual.anchor, 'middle')
  assert.equal(byWorld.LessOrEqual.x, node(layout, 'LessOrEqual', 1).x)
  assert.ok(byWorld.LessOrEqual.y < segment(layout, 'edge:AdvAddition:LessOrEqual:in').points[1].y)
  // The whole map still fits its bounds.
  for (const label of layout.labels) {
    const box = boxOf(label)
    assert.ok(box.x1 >= layout.bounds.x1 - 20 && box.x2 <= layout.bounds.x2 + 20, `${label.text} leaves the map`)
  }
})

// The map since the 2026-11-12 spec pull: The End follows Advanced Multiplication World
// instead of Advanced Addition World, so nothing runs down the middle column below
// Advanced Addition World any more.
const nnvg6 = {
  ...nnvg5,
  edges: [
    ...nnvg5.edges.filter(([source, target]) => !(source === 'AdvAddition' && target === 'Outro')),
    ['AdvMultiplication', 'Outro'],
  ],
}

test('The End follows the last world of each side of the map, and no path crosses another', () => {
  const layout = computePathMapLayout(nnvg6)
  assertNoPathOverLevels(layout)
  const end = node(layout, 'Outro', 1)
  assert.equal(end.x, 0)
  for (const n of layout.nodes) {
    if (n.world !== 'Outro') assert.ok(end.y - n.y >= 2 * PATH_MAP_ROW_HEIGHT, `${n.world} ${n.level} is not above The End`)
  }
  assert.equal(segment(layout, 'edge:AdvAddition:Outro:in'), undefined)
  for (const source of ['Power', 'AdvMultiplication', 'NeqBoss']) {
    const into = segment(layout, `edge:${source}:Outro:in`)
    assert.ok(into, `no path from ${source}`)
    assert.deepEqual(into.points.at(-1), { x: end.x, y: end.y })
    assert.equal(into.color, 'grey')
  }
  // Advanced Multiplication World's path drops from its boss and turns in to the middle,
  // where the ≠ boss's path, coming along the bottom from the right, joins it.
  const boss = node(layout, 'AdvMultiplication', 10)
  const fromBoss = segment(layout, 'edge:AdvMultiplication:Outro:in')
  assert.equal(fromBoss.points[0].x, boss.x)
  const turnY = fromBoss.points.at(-2).y
  assert.equal(fromBoss.points.at(-2).x, end.x)
  assert.equal(segment(layout, 'edge:NeqBoss:Outro:in').points.at(-2).y, turnY)
  assert.equal(segment(layout, 'edge:Power:Outro:in').points.at(-2).y, turnY)
  // Multiplication World's path now comes across an empty middle column.
  assert.equal(layout.segments.some(s => s.bridge), false)
  // The titles sit where they did.
  const byWorld = Object.fromEntries(layout.labels.map(label => [label.world, label]))
  assert.equal(byWorld.Power.anchor, 'end')
  assert.equal(byWorld.AdvMultiplication.anchor, 'start')
  assert.equal(byWorld.LessOrEqual.anchor, 'middle')
  assert.equal(byWorld.AdvAddition.anchor, 'middle')
})

// The map since the 2026-11-18 spec pull: two bonus branches leave Rewrite World's
// level 2 (A and B), and two leave Proposition World's boss (B and C). Proposition
// World forks after its level 7, so its two parts have eight levels each.
const nnvg7 = {
  ...nnvg6,
  worlds: {
    ...nnvg6.worlds,
    RewriteBonusB: { title: 'Rewrite World Bonus', bonusOf: { world: 'Rewrite', level: 3 } },
    PropositionBonusB: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 8 } },
    PropositionBonusC: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 8 } },
  },
  edges: [...nnvg6.edges, ['Rewrite', 'RewriteBonusB'], ['PropositionRight', 'PropositionBonusC']],
  worldSize: { ...nnvg6.worldSize, RewriteBonusB: 1, Proposition: 8, PropositionRight: 8, PropositionBonusC: 1,
    SuccessorJoined: 3 },
}

test('bonus branches off one level leave its path once and fan out from a stem', () => {
  const layout = computePathMapLayout(nnvg7)
  assertNoPathOverLevels(layout)
  for (const [world, level, branches] of [
    ['Rewrite', 3, ['RewriteBonus', 'RewriteBonusB']],
    ['PropositionRight', 8, ['PropositionBonusB', 'PropositionBonusC']],
  ]) {
    const anchor = node(layout, world, level)
    const [first, second] = branches.map(branch => node(layout, branch, 1))
    const [toFirst, toSecond] = branches.map(branch => segment(layout, `bonus:${world}:${level}:${branch}`))
    const side = Math.sign(first.x - anchor.x)
    // One row each, the first above the second, both starting past the stem.
    assert.equal(second.y, first.y + PATH_MAP_ROW_HEIGHT)
    assert.equal(second.x, first.x)
    const stemX = toFirst.points[1].x
    assert.ok(side * (stemX - anchor.x) > 22, 'the stem is clear of the levels on the path')
    assert.ok(side * (first.x - stemX) > 22 + PATH_MAP_CORNER_RADIUS, 'a branch has room to turn off the stem')
    // Only the first branch touches the path it leaves: sideways out of the level,
    // then down the stem.
    assert.deepEqual(toFirst.points, [
      { x: anchor.x, y: anchor.y }, { x: stemX, y: anchor.y }, { x: stemX, y: first.y }, { x: first.x, y: first.y },
    ])
    // The second carries the stem on from the first one's turn.
    assert.deepEqual(toSecond.points, [
      { x: stemX, y: first.y - PATH_MAP_CORNER_RADIUS }, { x: stemX, y: second.y }, { x: second.x, y: second.y },
    ])
    assert.ok(toSecond.points.every(point => point.x !== anchor.x))
    // Both light up with the level they leave.
    assert.deepEqual(toSecond.source, { world, level })
  }
  // A single branch off the last level of its world still drops straight down from it.
  const lone = segment(layout, 'bonus:NeqJoined:1:NeqBoss')
  assert.equal(lone.points[1].x, node(layout, 'NeqJoined', 1).x)
  // One with the path's next level beside it leaves by a stem too.
  const beside = segment(layout, 'bonus:PropositionRight:2:PropositionBonus')
  assert.notEqual(beside.points[1].x, node(layout, 'PropositionRight', 2).x)
  assert.equal(beside.points[1].y, node(layout, 'PropositionRight', 2).y)
})

test('the levels after a branching level are listed beside its branches', () => {
  const layout = computePathMapLayout(nnvg7)
  assertNoPathOverLevels(layout)
  // Rewrite World's levels are a row apart all the way down, bonuses or not.
  for (let level = 1; level < 6; level += 1) {
    assert.equal(node(layout, 'Rewrite', level + 1).y - node(layout, 'Rewrite', level).y, PATH_MAP_ROW_HEIGHT)
  }
  // Its two branches sit beside the two levels after the one they leave.
  assert.equal(node(layout, 'RewriteBonus', 1).y, node(layout, 'Rewrite', 4).y)
  assert.equal(node(layout, 'RewriteBonusB', 1).y, node(layout, 'Rewrite', 5).y)
  // Branches off a world's last level still have their rows below it, and the next
  // world starts below them.
  const boss = node(layout, 'PropositionRight', 8)
  assert.equal(node(layout, 'PropositionBonusC', 1).y, boss.y + 2 * PATH_MAP_ROW_HEIGHT)
  assert.ok(node(layout, 'Neq', 1).y > node(layout, 'PropositionBonusC', 1).y)
})

test('a level with branches of its own waits for the branches above it', () => {
  const layout = computePathMapLayout({
    worlds: {
      Main: { title: 'Main World' },
      First: { title: 'Bonus', bonusOf: { world: 'Main', level: 1 } },
      Second: { title: 'Bonus', bonusOf: { world: 'Main', level: 1 } },
      Third: { title: 'Bonus', bonusOf: { world: 'Main', level: 2 } },
    },
    edges: [['Main', 'First'], ['Main', 'Second'], ['Main', 'Third']],
    worldSize: { Main: 4, First: 1, Second: 1, Third: 1 },
  })
  const rowOf = (world, level) => node(layout, world, level).y / PATH_MAP_ROW_HEIGHT
  assert.deepEqual([rowOf('First', 1), rowOf('Second', 1)], [1, 2])
  // Level 2 would be beside the first branch, but its own branch needs a free row.
  assert.equal(rowOf('Main', 2), 2)
  assert.equal(rowOf('Third', 1), 3)
  assert.deepEqual([rowOf('Main', 3), rowOf('Main', 4)], [3, 4])
})
