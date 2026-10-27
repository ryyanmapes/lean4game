import test from 'node:test'
import assert from 'node:assert/strict'
import {
  goalInfosForLevel,
  goalInfoVisibleAfterTactics,
  hintTextForInput,
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

test('the induction reminder only disappears for the general induction and returns after undo', () => {
  const [info] = goalInfosForLevel('g/local/NNG4', 'LessOrEqual', 8, [])
  assert.ok(info)
  assert.equal(goalInfoVisibleAfterTactics(info, ['click_goal']), true)
  assert.equal(
    goalInfoVisibleAfterTactics(info, ['click_goal', 'click_goal', 'induction x with d hd']),
    true,
    'the warning remains after introducing y and getting the less-general hypothesis',
  )
  assert.equal(
    goalInfoVisibleAfterTactics(info, ['click_goal', 'induction x with d hd generalizing y']),
    false,
  )
  assert.equal(goalInfoVisibleAfterTactics(info, ['click_goal']), true)
})

test('words gestures for a mouse on PC and a finger on mobile', () => {
  const text = '{pc: Double-click | mobile: Double-tap} the goal.\nSwap by ' +
    '{pc: clicking this button (or by right-clicking the menu) | mobile: tapping this button}.'
  assert.equal(
    hintTextForInput(text, 'pc'),
    'Double-click the goal.\nSwap by clicking this button (or by right-clicking the menu).',
  )
  assert.equal(hintTextForInput(text, 'mobile'), 'Double-tap the goal.\nSwap by tapping this button.')
  assert.equal(hintTextForInput('Drag h onto the goal. {pc: Or press Enter. | mobile:}', 'mobile'), 'Drag h onto the goal. ')
  assert.equal(hintTextForInput('The set {x | x = 0} stays as written.', 'mobile'), 'The set {x | x = 0} stays as written.')
})

test('every NNG4 lesson that mentions clicking has a mobile wording', () => {
  for (const text of Object.values(NNG4_VISUAL_LESSON_TEXT)) {
    // `[Click to reveal: …]` is markup; the button it becomes says "Tap" on mobile.
    const shown = hintTextForInput(text, 'mobile').replace('[Click to reveal:', '[')
    assert.doesNotMatch(shown, /click/iu, text)
  }
})
