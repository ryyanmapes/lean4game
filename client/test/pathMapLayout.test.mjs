import test from 'node:test'
import assert from 'node:assert/strict'

const { computePathMapLayout, roundedPathData, PATH_MAP_COLUMN_WIDTH, PATH_MAP_CORNER_RADIUS } =
  await import('../../tmp-path-map-tests/visual/pathMapLayout.js')

// The Natural Numbers Video Game: a welcome text level, then Rewrite World on the
// left (with a bonus off its third level) and Proposition World on the right.
// Rewrite World leads to Induction World. Proposition World forks: its left branch
// joins the middle of Induction World, and its right branch carries on with a bonus.
const nnvg = {
  worlds: {
    Intro: { title: 'Welcome', shared: true, column: 0 },
    Rewrite: { title: 'Rewrite World', color: 'amber', column: -1 },
    RewriteBonus: { title: 'Rewrite World Bonus', bonusOf: { world: 'Rewrite', level: 3 } },
    Proposition: { title: 'Proposition World', color: 'sky', column: 1 },
    PropositionRight: { title: 'Proposition World', continues: 'Proposition', column: 2 },
    PropositionBonus: { title: 'Proposition World Bonus', bonusOf: { world: 'PropositionRight', level: 1 } },
    Induction: { title: 'Induction World', color: 'green', column: 0 },
    InductionJoined: { title: 'Induction World', continues: 'Induction', column: 0 },
    InductionBonus: { title: 'Induction World Bonus', bonusOf: { world: 'Induction', level: 3 } },
  },
  edges: [
    ['Rewrite', 'RewriteBonus'],
    ['PropositionRight', 'PropositionBonus'],
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
    Proposition: 6,
    PropositionRight: 2,
    PropositionBonus: 1,
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

test('a bonus is a row of levels sprouting from its anchor, pushing the main path down', () => {
  const layout = computePathMapLayout(nnvg)
  const anchor = node(layout, 'Rewrite', 3)
  const next = node(layout, 'Rewrite', 4)
  const first = node(layout, 'RewriteBonus', 1)
  const second = node(layout, 'RewriteBonus', 2)
  // Outward from a left column, between the anchor and the next main level.
  assert.ok(first.x < anchor.x)
  assert.ok(second.x < first.x)
  assert.equal(second.y, first.y)
  assert.ok(first.y > anchor.y && first.y < next.y)
  assert.equal(first.color, 'amber')
  const branch = segment(layout, 'bonus:Rewrite:3:RewriteBonus')
  assert.deepEqual(branch.source, { world: 'Rewrite', level: 3 })
  assert.deepEqual(branch.points.at(-1), { x: first.x, y: first.y })
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
  assert.ok(joined.y > node(layout, 'Proposition', 6).y)
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
