import assert from 'node:assert/strict'
import test from 'node:test'

import { computeVisualProgressFrontier } from '../../tmp-visual-world-progress-tests/visualWorldProgress.js'

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
