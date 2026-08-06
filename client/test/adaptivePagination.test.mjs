import assert from 'node:assert/strict'
import test from 'node:test'
import { packAdaptivePages } from '../../tmp-adaptive-pagination-tests/adaptivePagination.js'

test('packs two small cards together while leaving a wide card alone', () => {
  assert.deepEqual(packAdaptivePages([92, 104, 245, 90, 90], 220, 12), [
    { start: 0, end: 2 },
    { start: 2, end: 3 },
    { start: 3, end: 5 },
  ])
})

test('keeps source order and never drops an oversized card', () => {
  assert.deepEqual(packAdaptivePages([280, 80], 220, 12), [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
  ])
})

test('uses one provisional page until the container has been measured', () => {
  assert.deepEqual(packAdaptivePages([100, 100, 100], 0, 12), [
    { start: 0, end: 3 },
  ])
})
