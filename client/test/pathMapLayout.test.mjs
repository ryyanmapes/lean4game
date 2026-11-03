import test from 'node:test'
import assert from 'node:assert/strict'

const { computePathMapLayout, roundedPathData, PATH_MAP_COLUMN_WIDTH } =
  await import('../../tmp-path-map-tests/visual/pathMapLayout.js')

// The Natural Numbers Video Game's opening: a welcome text level, then Rewrite
// World on the left (with a bonus off its third level) and Proposition World
// on the right.
const nnvg = {
  worlds: {
    Intro: { title: 'Welcome', shared: true, column: 0 },
    Rewrite: { title: 'Rewrite World', color: 'amber', column: -1 },
    RewriteBonus: { title: 'Rewrite World Bonus', bonusOf: { world: 'Rewrite', level: 3 } },
    Proposition: { title: 'Proposition World', color: 'sky', column: 1 },
  },
  edges: [['Rewrite', 'RewriteBonus'], ['Intro', 'Proposition'], ['Intro', 'Rewrite']],
  worldSize: { Intro: 1, Rewrite: 5, RewriteBonus: 1, Proposition: 6 },
}

const node = (layout, world, level) => layout.nodes.find(n => n.world === world && n.level === level)

test('worlds are columns of their levels, split after the shared opening', () => {
  const layout = computePathMapLayout(nnvg)
  const intro = node(layout, 'Intro', 1)
  assert.equal(intro.x, 0)
  assert.equal(intro.color, 'grey')
  for (let level = 1; level <= 5; level += 1) {
    assert.equal(node(layout, 'Rewrite', level).x, -PATH_MAP_COLUMN_WIDTH)
  }
  for (let level = 1; level <= 6; level += 1) {
    assert.equal(node(layout, 'Proposition', level).x, PATH_MAP_COLUMN_WIDTH)
  }
  // Both worlds start on the same row, below the opening.
  assert.equal(node(layout, 'Rewrite', 1).y, node(layout, 'Proposition', 1).y)
  assert.ok(node(layout, 'Rewrite', 1).y > intro.y)
  // Levels go down the column.
  assert.ok(node(layout, 'Rewrite', 2).y > node(layout, 'Rewrite', 1).y)
})

test('a bonus sprouts beside its anchor level and pushes the main path down', () => {
  const layout = computePathMapLayout(nnvg)
  const anchor = node(layout, 'Rewrite', 3)
  const next = node(layout, 'Rewrite', 4)
  const bonus = node(layout, 'RewriteBonus', 1)
  // Outward from a left column, between the anchor and the next main level.
  assert.equal(bonus.x, -2 * PATH_MAP_COLUMN_WIDTH)
  assert.ok(bonus.y > anchor.y && bonus.y < next.y)
  assert.equal(bonus.color, 'amber')
  const branch = layout.segments.find(s => s.key === 'bonus:Rewrite:3:RewriteBonus')
  assert.deepEqual(branch.source, { world: 'Rewrite', level: 3 })
  assert.deepEqual(branch.points.at(-1), { x: bonus.x, y: bonus.y })
  // The edge MakeGame adds from Rewrite to its bonus is not drawn as a world edge.
  assert.equal(layout.segments.some(s => s.key.startsWith('edge:Rewrite:RewriteBonus')), false)
})

test('a split leaves in the shared grey and turns in each world colour', () => {
  const layout = computePathMapLayout(nnvg)
  const out = layout.segments.find(s => s.key === 'edge:Intro:Rewrite:out')
  const into = layout.segments.find(s => s.key === 'edge:Intro:Rewrite:in')
  assert.equal(out.color, 'grey')
  assert.equal(into.color, 'amber')
  assert.deepEqual(into.source, { world: 'Intro', level: 1 })
  assert.equal(into.points.length, 3)
})

test('named worlds are labelled on their outer side; shared and bonus worlds are not', () => {
  const layout = computePathMapLayout(nnvg)
  const byWorld = Object.fromEntries(layout.labels.map(label => [label.world, label]))
  assert.deepEqual(Object.keys(byWorld).sort(), ['Proposition', 'Rewrite'])
  assert.equal(byWorld.Rewrite.anchor, 'end')
  assert.equal(byWorld.Proposition.anchor, 'start')
  assert.equal(byWorld.Rewrite.text, 'Rewrite World')
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

test('phones can put world titles above narrower columns', () => {
  const layout = computePathMapLayout(nnvg, { columnWidth: 100, labelPlacement: 'above' })
  assert.equal(node(layout, 'Rewrite', 1).x, -100)
  const rewrite = layout.labels.find(label => label.world === 'Rewrite')
  assert.equal(rewrite.anchor, 'middle')
  assert.equal(rewrite.x, -100)
  assert.ok(rewrite.y < node(layout, 'Rewrite', 1).y)
})
