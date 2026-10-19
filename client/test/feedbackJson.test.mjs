import assert from 'node:assert/strict'
import test from 'node:test'

const { proofStateJson } = await import('../../tmp-telemetry-tests/feedbackJson.js')

test('an object shared by two parts of the proof state keeps its contents in both', () => {
  // Every hypothesis appears under its goal and again on its canvas card.
  const hyp = { names: ['h'], type: { text: 'x = y' } }
  const state = { goals: [{ hyps: [hyp] }], canvas: { cards: [{ id: 1, hyp }] } }
  assert.deepEqual(JSON.parse(proofStateJson(state)), {
    goals: [{ hyps: [{ names: ['h'], type: { text: 'x = y' } }] }],
    canvas: { cards: [{ id: 1, hyp: { names: ['h'], type: { text: 'x = y' } } }] },
  })
})

test('an object repeated in one array keeps its contents each time', () => {
  const step = { tactic: 'rfl' }
  assert.equal(proofStateJson({ steps: [step, step] }), '{"steps":[{"tactic":"rfl"},{"tactic":"rfl"}]}')
})

test('only a real cycle is cut', () => {
  const node = { name: 'a', children: [] }
  node.children.push(node)
  node.parent = { back: node }
  assert.deepEqual(JSON.parse(proofStateJson({ root: node, again: node.parent })), {
    root: { name: 'a', children: ['[Circular]'], parent: { back: '[Circular]' } },
    again: { back: { name: 'a', children: ['[Circular]'], parent: '[Circular]' } },
  })
})

test('bigints become strings and other values follow JSON', () => {
  assert.equal(
    proofStateJson({ n: 12n, missing: undefined, list: [undefined, 1], when: new Date(0) }),
    '{"n":"12","list":[null,1],"when":"1970-01-01T00:00:00.000Z"}',
  )
  assert.equal(proofStateJson(undefined), 'null')
})
