import test from 'node:test'
import assert from 'node:assert/strict'
import {
  goalInfosForLevel,
  goalInfoVisibleAfterTactics,
  NNG4_VISUAL_LESSON_TEXT,
} from '../../tmp-level-presentation-tests/visual/levelPresentation.js'

test('replaces the verbose Implication 3 callout with the requested instruction', () => {
  const infos = goalInfosForLevel('g/local/NNG4', 'Implication', 3, [{
    position: 'below',
    arrow: false,
    text: 'old text',
  }])
  assert.deepEqual(infos.map(info => info.text), [NNG4_VISUAL_LESSON_TEXT.implicationThree])
})

test('adds the requested LessOrEqual lesson callouts only to NNG4', () => {
  const expected = new Map([
    [1, NNG4_VISUAL_LESSON_TEXT.useGoal],
    [4, NNG4_VISUAL_LESSON_TEXT.leHyp],
    [7, NNG4_VISUAL_LESSON_TEXT.or],
    [8, NNG4_VISUAL_LESSON_TEXT.induction],
  ])
  for (const [level, text] of expected) {
    const infos = goalInfosForLevel('g/local/NNG4', 'LessOrEqual', level, [])
    assert.equal(infos.at(-1)?.text, text)
    assert.equal(infos.at(-1)?.position, 'below')
  }
  assert.deepEqual(goalInfosForLevel('g/local/VisualTest', 'LessOrEqual', 1, []), [])
})

test('the induction reminder disappears after induction and returns after undo', () => {
  const [info] = goalInfosForLevel('g/local/NNG4', 'LessOrEqual', 8, [])
  assert.ok(info)
  assert.equal(goalInfoVisibleAfterTactics(info, ['intro a']), true)
  assert.equal(goalInfoVisibleAfterTactics(info, ['intro a', 'induction a']), false)
  assert.equal(goalInfoVisibleAfterTactics(info, ['intro a']), true)
})
