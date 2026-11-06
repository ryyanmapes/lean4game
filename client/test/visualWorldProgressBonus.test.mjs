import test from 'node:test'
import assert from 'node:assert/strict'

const { bonusAnchorsOf, computeVisualProgressFrontier, isVisualLevelUnlocked } =
  await import('../../tmp-path-map-tests/visual/visualWorldProgress.js')

const worldIds = ['Intro', 'Rewrite', 'RewriteBonus', 'Proposition', 'PropositionRight', 'Induction', 'InductionJoined']
const edges = [
  ['Rewrite', 'RewriteBonus'],
  ['Intro', 'Proposition'],
  ['Intro', 'Rewrite'],
  ['Rewrite', 'Induction'],
  ['Induction', 'InductionJoined'],
  ['Proposition', 'InductionJoined'],
  ['Proposition', 'PropositionRight'],
]
const worldSizes = {
  Intro: 1,
  Rewrite: 5,
  RewriteBonus: 1,
  Proposition: 6,
  PropositionRight: 2,
  Induction: 3,
  InductionJoined: 1,
}
const bonusAnchors = bonusAnchorsOf({
  Intro: {},
  Rewrite: {},
  RewriteBonus: { visualBonusOf: { world: 'Rewrite', level: 3 } },
  Proposition: {},
})

function allLevels(world) {
  return Array.from({ length: worldSizes[world] }, (_, index) => `${world}:${index + 1}`)
}

function frontier(done) {
  return computeVisualProgressFrontier({
    worldIds,
    edges,
    worldSizes,
    skippedLevels: {},
    bonusAnchors,
    isCompleted: (world, level) => done.includes(`${world}:${level}`),
  })
}

test('bonus anchors are read from the world nodes', () => {
  assert.deepEqual(bonusAnchors, { RewriteBonus: { world: 'Rewrite', level: 3 } })
})

test('a bonus unlocks with its anchor level, not with its whole world', () => {
  const before = frontier(['Intro:1', 'Rewrite:1', 'Rewrite:2'])
  assert.equal(isVisualLevelUnlocked(before, 'RewriteBonus', 1), false)
  const after = frontier(['Intro:1', 'Rewrite:1', 'Rewrite:2', 'Rewrite:3'])
  assert.equal(isVisualLevelUnlocked(after, 'RewriteBonus', 1), true)
  // The main path goes on without it.
  assert.equal(isVisualLevelUnlocked(after, 'Rewrite', 4), true)
})

test('both worlds open after the opening text level', () => {
  const start = frontier([])
  assert.equal(isVisualLevelUnlocked(start, 'Intro', 1), true)
  assert.equal(isVisualLevelUnlocked(start, 'Rewrite', 1), false)
  const opened = frontier(['Intro:1'])
  assert.equal(isVisualLevelUnlocked(opened, 'Rewrite', 1), true)
  assert.equal(isVisualLevelUnlocked(opened, 'Proposition', 1), true)
  assert.equal(isVisualLevelUnlocked(opened, 'Proposition', 2), false)
})

test('a joined world stays locked until both paths into it are finished', () => {
  const inductionOnly = frontier(['Intro:1', ...allLevels('Rewrite'), ...allLevels('Induction')])
  assert.equal(isVisualLevelUnlocked(inductionOnly, 'InductionJoined', 1), false)
  const propositionOnly = frontier(['Intro:1', ...allLevels('Proposition')])
  assert.equal(isVisualLevelUnlocked(propositionOnly, 'InductionJoined', 1), false)
  const both = frontier([
    'Intro:1',
    ...allLevels('Rewrite'),
    ...allLevels('Induction'),
    ...allLevels('Proposition'),
  ])
  assert.equal(isVisualLevelUnlocked(both, 'InductionJoined', 1), true)
})

test('the right branch of a fork opens with its source, without waiting for the join', () => {
  const done = frontier(['Intro:1', ...allLevels('Proposition')])
  assert.equal(isVisualLevelUnlocked(done, 'PropositionRight', 1), true)
  const notYet = frontier(['Intro:1', 'Proposition:1'])
  assert.equal(isVisualLevelUnlocked(notYet, 'PropositionRight', 1), false)
})
