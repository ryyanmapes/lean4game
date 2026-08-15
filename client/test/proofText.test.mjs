import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  buildStructuredProof,
  commandForGoalAction,
  coreTacticForVisualCommand,
  goalOrderForAction,
  coreCommandForGoalClick,
  displayedProofLines,
  displayedProofSteps,
  explicitReverseRewriteCommand,
  rotationForGoal,
} = await import('../../tmp-proof-text-tests/proofText.js')

test('a directly completable goal click replays as rfl without reparsing display text', () => {
  assert.equal(coreCommandForGoalClick('click_goal', 'Click to complete'), 'rfl')
  assert.equal(coreCommandForGoalClick('click_goal', undefined, true), 'rfl')
  assert.equal(coreCommandForGoalClick('click_goal', 'Click to introduce variable'), 'click_goal')
  assert.equal(coreCommandForGoalClick('click_goal_left', 'Click to complete'), 'click_goal_left')
})

test('a selected reverse variable rewrite gets an explicit side and theorem argument', () => {
  assert.equal(
    explicitReverseRewriteCommand('MyNat.add_zero', 'x', 'left'),
    'conv =>\n  lhs\n  rw [← MyNat.add_zero (x)]',
  )
  assert.equal(
    explicitReverseRewriteCommand('h', 'x + y', 'right', [2, 1]),
    'conv =>\n  rhs\n  arg 2\n  arg 1\n  rw [← h (x + y)]',
  )
  assert.equal(
    explicitReverseRewriteCommand('MyNat.zero_add', 'n', 'right', undefined, 'h'),
    'conv at h =>\n  rhs\n  rw [← MyNat.zero_add (n)]',
  )
})

test('a path-scoped rewrite keeps the exact player-selected occurrence in Core Lean', () => {
  assert.equal(
    coreTacticForVisualCommand('drag_rw_lhs_at [MyNat.two_eq_succ_one] [1]'),
    'conv =>\n  lhs\n  arg 1\n  rw [MyNat.two_eq_succ_one]',
  )
  assert.equal(
    coreTacticForVisualCommand('drag_rw_hyp_rhs_at h [← MyNat.add_zero] [2,1]'),
    'conv at h =>\n  rhs\n  arg 2\n  arg 1\n  rw [← MyNat.add_zero]',
  )
})

test('the proof sidebar keeps all Lean lines from one player gesture under one step number', () => {
  const steps = [{
    command: 'exfalso\nexact h',
    playTactic: 'drag_goal h',
    leanTactic: 'exfalso\nexact h',
    rotation: null,
  }]
  assert.deepEqual(displayedProofLines(steps, 'lean'), ['exfalso', 'exact h'])
  assert.deepEqual(displayedProofSteps(steps, 'lean'), ['exfalso\nexact h'])
})

test('the interactive proof pane renders existential construction without a metavariable hole', () => {
  const steps = [{
    command: 'refine Exists.intro (0) ?_',
    playTactic: 'refine Exists.intro (0) ?_',
    leanTactic: 'use 0',
    rotation: null,
  }]
  assert.deepEqual(displayedProofSteps(steps, 'play'), ['use 0'])
  assert.equal(displayedProofSteps(steps, 'play')[0].includes('?'), false)
})

// Complete visual solution corresponding to NNG4/Game/Levels/Addition/L04add_assoc.lean:
//   induction c with d hd
//   · rw [add_zero, add_zero]; rfl
//   · rw [add_succ, add_succ, hd, add_succ]; rfl
const completeAdditionFour = [
  { command: 'induction c with d hd', playTactic: 'induction c with d hd', leanTactic: 'induction c with d hd' },
  { command: 'drag_rw_lhs [MyNat.add_zero]', playTactic: 'drag_rw_lhs [MyNat.add_zero]', leanTactic: null },
  { command: 'drag_rw_rhs_at [MyNat.add_zero] [2]', playTactic: 'drag_rw_rhs_at [MyNat.add_zero] [2]', leanTactic: null },
  { command: 'click_goal', playTactic: 'click_goal', leanTactic: 'rfl' },
  { command: 'drag_rw_lhs [MyNat.add_succ]', playTactic: 'drag_rw_lhs [MyNat.add_succ]', leanTactic: null },
  { command: 'drag_rw_rhs_at [MyNat.add_succ] [2]', playTactic: 'drag_rw_rhs_at [MyNat.add_succ] [2]', leanTactic: null },
  { command: 'drag_rw_lhs_at [hd] [1]', playTactic: 'drag_rw_lhs_at [hd] [1]', leanTactic: null },
  { command: 'drag_rw_rhs [MyNat.add_succ]', playTactic: 'drag_rw_rhs [MyNat.add_succ]', leanTactic: null },
  { command: 'click_goal', playTactic: 'click_goal', leanTactic: 'rfl' },
]

test('goal navigation is deferred until an action and records the shortest left rotation', () => {
  assert.equal(rotationForGoal(['zero', 'succ', 'other'], 'zero'), null)
  assert.equal(rotationForGoal(['zero', 'succ', 'other'], 'succ'), 'rotate_left')
  assert.equal(rotationForGoal(['zero', 'succ', 'other'], 'other'), 'rotate_left 2')

  assert.deepEqual(
    commandForGoalAction('drag_rw_lhs [add_succ]', 'succ', ['zero', 'succ']),
    {
      command: 'rotate_left\ndrag_rw_lhs [add_succ]',
      rotation: 'rotate_left',
    },
  )
})

test('actions retain Lean goal order after the UI selects a different proof-tree branch', () => {
  assert.deepEqual(
    goalOrderForAction(['succ', 'zero'], ['zero', 'succ'], 'succ'),
    ['succ', 'zero'],
  )
  assert.equal(rotationForGoal(
    goalOrderForAction(['succ', 'zero'], ['zero', 'succ'], 'succ'),
    'succ',
  ), null)
  assert.deepEqual(
    goalOrderForAction(['old-succ', 'old-zero'], ['zero', 'succ'], 'succ'),
    ['zero', 'succ'],
  )
})

test('both proof views show the committed rotation immediately before the cross-branch action', () => {
  const steps = [
    completeAdditionFour[0],
    {
      command: 'rotate_left\ndrag_rw_lhs [MyNat.add_succ]',
      rotation: 'rotate_left',
      playTactic: 'drag_rw_lhs [MyNat.add_succ]',
      leanTactic: 'rw [MyNat.add_succ]',
    },
  ]

  assert.deepEqual(displayedProofLines(steps, 'play'), [
    'induction c with d hd',
    'rotate_left',
    'drag_rw_lhs [add_succ]',
  ])
  assert.deepEqual(displayedProofLines(steps, 'lean'), [
    'induction c with d hd',
    'rotate_left',
    'rw [add_succ]',
  ])
  assert.equal(buildStructuredProof(steps, 'play').includes('case '), false)
  assert.equal(buildStructuredProof(steps, 'lean').includes('case '), false)
})

async function authoredAtomicTactics() {
  const source = await readFile(new URL('./fixtures/nng4-addition-4-solution.lean', import.meta.url), 'utf8')
  const tactics = []
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim().replace(/^·\s*/u, '')
    if (line.startsWith('induction ')) tactics.push(line)
    const rewrite = /^rw \[([^\]]+)\]$/u.exec(line)
    if (rewrite) {
      for (const theorem of rewrite[1].split(',').map(value => value.trim())) {
        tactics.push(`rw [${theorem}]`)
      }
    }
    if (line === 'rfl') tactics.push('rfl')
  }
  return tactics
}

test('interactive proof log contains one case-free line per player action', () => {
  assert.deepEqual(displayedProofLines(completeAdditionFour, 'play'), [
    'induction c with d hd',
    'drag_rw_lhs [add_zero]',
    'drag_rw_rhs_at [add_zero] [2]',
    'click_goal',
    'drag_rw_lhs [add_succ]',
    'drag_rw_rhs_at [add_succ] [2]',
    'drag_rw_lhs_at [hd] [1]',
    'drag_rw_rhs [add_succ]',
    'click_goal',
  ])
})

test('core proof text preserves path-scoped player rewrites without holes', async () => {
  const displayed = displayedProofLines(completeAdditionFour, 'lean')
  assert.deepEqual(displayed, [
    'induction c with d hd',
    'rw [add_zero]',
    'conv =>',
    '  rhs',
    '  arg 2',
    '  rw [add_zero]',
    'rfl',
    'rw [add_succ]',
    'conv =>',
    '  rhs',
    '  arg 2',
    '  rw [add_succ]',
    'conv =>',
    '  lhs',
    '  arg 1',
    '  rw [hd]',
    'rw [add_succ]',
    'rfl',
  ])
  assert.deepEqual(await authoredAtomicTactics(), [
    'induction c with d hd',
    'rw [add_zero]',
    'rw [add_zero]',
    'rfl',
    'rw [add_succ]',
    'rw [add_succ]',
    'rw [hd]',
    'rw [add_succ]',
    'rfl',
  ])
  assert.equal(displayed.some(line => line.includes('?')), false)
})
