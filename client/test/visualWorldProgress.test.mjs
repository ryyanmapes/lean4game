import assert from 'node:assert/strict'
import test from 'node:test'

import { computeVisualProgressFrontier, isVisualLevelUnlocked } from '../../tmp-visual-world-progress-tests/visualWorldProgress.js'

test('a level opens once every level before it is done, and a solved level always opens', () => {
  // Addition 2 was solved before levels were locked, skipping ahead.
  const completed = new Set(['Tutorial/1', 'Addition/2'])
  const frontier = computeVisualProgressFrontier({
    worldIds: ['Tutorial', 'Addition'],
    edges: [['Tutorial', 'Addition']],
    worldSizes: { Tutorial: 3, Addition: 2 },
    skippedLevels: {},
    isCompleted: (world, level) => completed.has(`${world}/${level}`),
  })

  assert.deepEqual(frontier.unlockedWorlds, { Tutorial: true, Addition: false })
  const unlocked = (world, level) => isVisualLevelUnlocked(frontier, world, level)
  assert.deepEqual([1, 2, 3].map(level => unlocked('Tutorial', level)), [true, true, false])
  assert.deepEqual([1, 2].map(level => unlocked('Addition', level)), [false, true])
  assert.equal(unlocked('Unknown', 1), false)
})

test('skipped and completion-neutral levels do not hold back the levels after them', () => {
  const input = {
    worldIds: ['Power'],
    edges: [],
    worldSizes: { Power: 4 },
    skippedLevels: { Power: [2] },
    completionNeutralLevels: { Power: [3] },
  }

  const fresh = computeVisualProgressFrontier({ ...input, isCompleted: () => false })
  assert.deepEqual([1, 3, 4].map(level => isVisualLevelUnlocked(fresh, 'Power', level)), [true, false, false])

  const afterFirst = computeVisualProgressFrontier({ ...input, isCompleted: (_world, level) => level === 1 })
  assert.deepEqual([1, 3, 4].map(level => isVisualLevelUnlocked(afterFirst, 'Power', level)), [true, true, true])
})

test('a world unlocks when every world leading to it is done', () => {
  const edges = [['Tutorial', 'Addition'], ['Addition', 'Implication'], ['Tutorial', 'Implication']]
  const input = {
    worldIds: ['Tutorial', 'Addition', 'Implication'],
    edges,
    worldSizes: { Tutorial: 1, Addition: 1, Implication: 2 },
    skippedLevels: {},
  }

  const tutorialDone = computeVisualProgressFrontier({ ...input, isCompleted: world => world === 'Tutorial' })
  assert.equal(isVisualLevelUnlocked(tutorialDone, 'Implication', 1), false)

  const bothDone = computeVisualProgressFrontier({ ...input, isCompleted: world => world !== 'Implication' })
  assert.deepEqual([1, 2].map(level => isVisualLevelUnlocked(bothDone, 'Implication', level)), [true, false])
})

test('skipped opening levels do not unlock several raw levels at once', () => {
  const result = computeVisualProgressFrontier({
    worldIds: ['Tutorial'],
    edges: [],
    worldSizes: { Tutorial: 5 },
    skippedLevels: { Tutorial: [1, 2] },
    isCompleted: () => false,
  })

  assert.deepEqual(result.frontierWorlds, ['Tutorial'])
  assert.equal(result.nextLevels.Tutorial, 3)
  assert.deepEqual(result.highlightedLevels, { Tutorial: 3 })
})

test('only bottommost incomplete worlds highlight their first incomplete visible level', () => {
  const completed = new Set(['Tutorial/2', 'Addition/1'])
  const result = computeVisualProgressFrontier({
    worldIds: ['Tutorial', 'Addition', 'Multiplication', 'Implication'],
    edges: [
      ['Tutorial', 'Addition'],
      ['Addition', 'Multiplication'],
      ['Addition', 'Implication'],
    ],
    worldSizes: { Tutorial: 2, Addition: 2, Multiplication: 2, Implication: 2 },
    skippedLevels: { Tutorial: [1] },
    isCompleted: (world, level) => completed.has(`${world}/${level}`),
  })

  assert.deepEqual(result.frontierWorlds, ['Addition'])
  assert.deepEqual(result.highlightedLevels, { Addition: 2 })
})

test('parallel bottom worlds are both frontier nodes after completed ancestors are removed', () => {
  const completed = new Set(['Tutorial/1', 'Addition/1'])
  const result = computeVisualProgressFrontier({
    worldIds: ['Tutorial', 'Addition', 'Multiplication', 'Implication'],
    edges: [
      ['Tutorial', 'Addition'],
      ['Addition', 'Multiplication'],
      ['Addition', 'Implication'],
    ],
    worldSizes: { Tutorial: 1, Addition: 1, Multiplication: 2, Implication: 2 },
    skippedLevels: {},
    isCompleted: (world, level) => completed.has(`${world}/${level}`),
  })

  assert.deepEqual(result.frontierWorlds.sort(), ['Implication', 'Multiplication'])
  assert.deepEqual(result.highlightedLevels, { Multiplication: 1, Implication: 1 })
})

test('completion-neutral levels become map-complete after entry without becoming solved', () => {
  const input = {
    worldIds: ['Power'],
    edges: [],
    worldSizes: { Power: 3 },
    skippedLevels: {},
    completionNeutralLevels: { Power: [3] },
    isCompleted: (_world, level) => level < 3,
  }

  const beforeEntry = computeVisualProgressFrontier(input)
  assert.equal(beforeEntry.actualCompletedLevels.Power[3], false)
  assert.equal(beforeEntry.mapCompletedLevels.Power[3], false)
  assert.equal(beforeEntry.completedLevels.Power[3], true)
  assert.equal(beforeEntry.completedWorlds.Power, true)
  assert.equal(beforeEntry.nextLevels.Power, null)

  const afterEntry = computeVisualProgressFrontier({
    ...input,
    isEntered: (world, level) => world === 'Power' && level === 3,
  })

  assert.equal(afterEntry.actualCompletedLevels.Power[3], false)
  assert.equal(afterEntry.mapCompletedLevels.Power[3], true)
  assert.equal(afterEntry.completedLevels.Power[3], true)
})
