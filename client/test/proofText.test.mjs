import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const {
  buildStructuredProof,
  displayedProofLines,
} = await import('../../tmp-proof-text-tests/proofText.js')

// Complete visual solution corresponding to NNG4/Game/Levels/Addition/L04add_assoc.lean:
//   induction c with d hd
//   · rw [add_zero, add_zero]; rfl
//   · rw [add_succ, add_succ, hd, add_succ]; rfl
const completeAdditionFour = [
  { command: 'induction c with d hd', playTactic: 'induction c with d hd', leanTactic: 'induction c with d hd' },
  { command: 'case zero => drag_rw_lhs [MyNat.add_zero]', playTactic: 'drag_rw_lhs [MyNat.add_zero]', leanTactic: null },
  { command: 'case zero => drag_rw_rhs_at [MyNat.add_zero] [2]', playTactic: 'drag_rw_rhs_at [MyNat.add_zero] [2]', leanTactic: null },
  { command: 'case zero => click_goal', playTactic: 'click_goal', leanTactic: 'rfl' },
  { command: 'case succ => drag_rw_lhs [MyNat.add_succ]', playTactic: 'drag_rw_lhs [MyNat.add_succ]', leanTactic: null },
  { command: 'case succ => drag_rw_rhs_at [MyNat.add_succ] [2]', playTactic: 'drag_rw_rhs_at [MyNat.add_succ] [2]', leanTactic: null },
  { command: 'case succ => drag_rw_lhs_at [hd] [1]', playTactic: 'drag_rw_lhs_at [hd] [1]', leanTactic: null },
  { command: 'case succ => drag_rw_rhs [MyNat.add_succ]', playTactic: 'drag_rw_rhs [MyNat.add_succ]', leanTactic: null },
  { command: 'case succ => click_goal', playTactic: 'click_goal', leanTactic: 'rfl' },
]

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

test('interactive proof text groups a complete solution into one block per authored case', () => {
  assert.equal(
    buildStructuredProof(completeAdditionFour, 'play'),
    `induction c with d hd
case zero =>
  drag_rw_lhs [MyNat.add_zero]
  drag_rw_rhs_at [MyNat.add_zero] [2]
  click_goal
case succ =>
  drag_rw_lhs [MyNat.add_succ]
  drag_rw_rhs_at [MyNat.add_succ] [2]
  drag_rw_lhs_at [hd] [1]
  drag_rw_rhs [MyNat.add_succ]
  click_goal`,
  )
})

test('core proof text contains the same atomic tactics as the authored NNG4 solution', async () => {
  const displayed = displayedProofLines(completeAdditionFour, 'lean')
  assert.deepEqual(displayed, [
    'induction c with d hd',
    'case zero =>',
    '  rw [add_zero]',
    '  rw [add_zero]',
    '  rfl',
    'case succ =>',
    '  rw [add_succ]',
    '  rw [add_succ]',
    '  rw [hd]',
    '  rw [add_succ]',
    '  rfl',
  ])

  assert.deepEqual(
    displayed.map(line => line.trim()).filter(line => line && !line.startsWith('case ')),
    await authoredAtomicTactics(),
  )
  assert.equal(displayed.some(line => line.includes('?')), false)
})
