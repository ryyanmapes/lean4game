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

test('removes obsolete revert guidance and adds the Implication symm lesson', () => {
  const cleaned = goalInfosForLevel('g/local/NNG4', 'Implication', 6, [{
    position: 'below',
    arrow: false,
    text: 'Note that this process can be undone. Use the `revert` tactic to reverse it. Keep this advice.',
  }])
  assert.equal(cleaned.length, 1)
  assert.equal(cleaned[0].text.includes('revert'), false)
  assert.match(cleaned[0].text, /Keep this advice/u)

  const symm = goalInfosForLevel('g/local/NNG4', 'Implication', 10, [])
  assert.equal(symm.at(-1)?.text, NNG4_VISUAL_LESSON_TEXT.symm)
  assert.equal(symm.at(-1)?.position, 'below')
})

test('adds the requested LessOrEqual lesson callouts only to NNG4', () => {
  const expected = new Map([
    [1, NNG4_VISUAL_LESSON_TEXT.useGoal],
    [4, NNG4_VISUAL_LESSON_TEXT.leHyp],
    [7, NNG4_VISUAL_LESSON_TEXT.or],
    [8, NNG4_VISUAL_LESSON_TEXT.induction],
    [10, NNG4_VISUAL_LESSON_TEXT.leTenHint],
  ])
  for (const [level, text] of expected) {
    const infos = goalInfosForLevel('g/local/NNG4', 'LessOrEqual', level, [])
    assert.equal(infos.at(-1)?.text, text)
    assert.equal(infos.at(-1)?.position, 'below')
  }
  assert.deepEqual(goalInfosForLevel('g/local/VisualTest', 'LessOrEqual', 1, []), [])
})

test('adds the cases lesson to Advanced Addition 5', () => {
  const infos = goalInfosForLevel('g/local/NNG4', 'AdvAddition', 5, [])
  assert.equal(infos.at(-1)?.text, NNG4_VISUAL_LESSON_TEXT.cases)
  assert.match(infos.at(-1)?.text ?? '', /\*no\*/u)
  assert.match(infos.at(-1)?.text ?? '', /`False`/u)
})

test('the induction reminder disappears after induction and returns after undo', () => {
  const [info] = goalInfosForLevel('g/local/NNG4', 'LessOrEqual', 8, [])
  assert.ok(info)
  assert.equal(goalInfoVisibleAfterTactics(info, ['intro a']), true)
  assert.equal(goalInfoVisibleAfterTactics(info, ['intro a', 'induction a']), false)
  assert.equal(goalInfoVisibleAfterTactics(info, ['intro a']), true)
})
