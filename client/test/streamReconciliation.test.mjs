import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  casePathForStream,
  collectActiveStreamIds,
  collectLiveStreamIds,
  completeLeafStream,
  findLeafForStream,
} = require('../../tmp-stream-tests/visual/proofTree.js')
const {
  inferLocalTheoremPremiseApplication,
  reconcileProofTreeAfterInteraction,
} = require('../../tmp-stream-tests/visual/streamReconciliation.js')
const { proofStateToCanvas } = require('../../tmp-stream-tests/visual/leanToCanvas.js')

test('authoritative proof completion discards a stale final focused goal', () => {
  const canvas = proofStateToCanvas({
    completed: true,
    steps: [{
      goals: [{ goal: { mvarId: 'stale-goal', type: { text: 'x = x' }, hyps: [] } }],
    }],
  })

  assert.deepEqual(canvas, { streams: [], completed: true })
})

function hyp(id, name, type, { isTheorem = false } = {}) {
  const displayName = name
  return {
    id,
    isTheorem,
    hyp: {
      names: [displayName],
      ...(displayName !== name ? { playName: name } : {}),
      type: { text: type },
      reductionForms: [],
    },
    position: { x: 0, y: 0 },
  }
}

function stream(id, goalType, userName, hyps) {
  return {
    id,
    goal: {
      type: { text: goalType },
      userName,
      reductionForms: [],
    },
    hyps,
    reductionForms: [],
  }
}

function baseStreams() {
  const splitHypType = 'And B (A -> B -> C)'
  const splitRightType = 'A -> B -> C'

  const streamA = stream('stream-a', 'A', 'left', [
    hyp('hyp-h', 'h', 'A'),
  ])
  const streamB = stream('stream-b', 'B', 'right', [
    hyp('hyp-h', 'h', 'A'),
    hyp('hyp-h2', 'h2', splitHypType),
  ])
  const staleSiblingC = stream('stream-c-old', 'C', 'right', [
    hyp('hyp-h', 'h', 'A'),
    hyp('hyp-left', 'left', 'B'),
    hyp('hyp-right', 'right', splitRightType),
  ])
  const refreshedSiblingC = stream('stream-c-new', 'C', 'right', [
    hyp('hyp-h', 'h', 'A'),
    hyp('hyp-h2', 'h2', splitHypType),
  ])

  return { streamA, streamB, staleSiblingC, refreshedSiblingC }
}

test('every induction branch keeps an explicit case path, including the first branch', () => {
  const tree = {
    id: 'root',
    streamId: null,
    label: null,
    completed: false,
    children: [
      { id: 'zero-node', streamId: 'zero-stream', label: 'zero', completed: false, children: [] },
      { id: 'succ-node', streamId: 'succ-stream', label: 'succ', completed: false, children: [] },
    ],
  }

  assert.deepEqual(casePathForStream(tree, 'zero-stream'), ['zero'])
  assert.deepEqual(casePathForStream(tree, 'succ-stream'), ['succ'])
})

function unicodeStreams() {
  const splitHypType = `B ${String.fromCharCode(0x2227)} (A ${String.fromCharCode(0x2192)} B ${String.fromCharCode(0x2192)} C)`

  const streamA = stream('unicode-stream-a', 'A', 'left', [
    hyp('unicode-hyp-h', 'h', 'A'),
  ])
  const streamB = stream('unicode-stream-b', 'B', 'right', [
    hyp('unicode-hyp-h', 'h', 'A'),
    hyp('unicode-hyp-h2', 'h2', splitHypType),
  ])
  const staleSiblingC = stream('unicode-stream-c-old', 'C', 'right', [
    hyp('unicode-hyp-h', 'h', 'A'),
    hyp('unicode-hyp-h2', 'h2', splitHypType),
  ])
  const refreshedSiblingC = stream('unicode-stream-c-new', 'C', 'right', [
    hyp('unicode-hyp-h', 'h', 'A'),
    hyp('unicode-hyp-h2', 'h2', splitHypType),
  ])

  return { streamA, streamB, staleSiblingC, refreshedSiblingC }
}

function baseTree({ streamA, streamB, staleSiblingC }) {
  return {
    id: 'root',
    streamId: null,
    label: null,
    completed: false,
    children: [
      {
        id: 'leaf-a',
        streamId: streamA.id,
        label: streamA.goal.userName,
        completed: false,
        children: [],
      },
      {
        id: 'branch-right',
        streamId: null,
        label: 'right',
        completed: false,
        children: [
          {
            id: 'leaf-b',
            streamId: streamB.id,
            label: streamB.goal.userName,
            completed: false,
            children: [],
          },
          {
            id: 'leaf-c',
            streamId: staleSiblingC.id,
            label: staleSiblingC.goal.userName,
            completed: false,
            children: [],
          },
        ],
      },
    ],
  }
}

function treeAfterFirstLeafSolved({ streamA, streamB, staleSiblingC }) {
  const tree = baseTree({ streamA, streamB, staleSiblingC })
  tree.children[0].completed = true
  return tree
}

function assertUniqueIds(ids) {
  assert.equal(new Set(ids).size, ids.length)
}

function hypTypeFor(stream, name) {
  return stream.hyps.find(card =>
    card.hyp.names[0] === name || card.hyp.playName === name
  )?.hyp.type.text
}

function findHyp(stream, name) {
  return stream.hyps.find(card =>
    card.hyp.names[0] === name || card.hyp.playName === name
  )
}

test('completing the middle branch keeps it selected and updates sibling C without duplication', () => {
  const { streamA, streamB, staleSiblingC, refreshedSiblingC } = baseStreams()
  const beforeTree = baseTree({ streamA, streamB, staleSiblingC })
  const beforeCanvas = {
    streams: [streamA, streamB, staleSiblingC],
    completed: false,
  }
  const afterCanvas = {
    streams: [refreshedSiblingC],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    streamB,
    'drag_goal left',
    false,
    streamB.id,
  )

  const activeIds = collectActiveStreamIds(result.nextTree)
  assertUniqueIds(activeIds)
  assert.deepEqual(activeIds, [streamA.id, streamB.id, refreshedSiblingC.id])
  assert.deepEqual(collectLiveStreamIds(result.nextTree), [streamA.id, refreshedSiblingC.id])
  assert.equal(result.nextActiveId, streamB.id)

  const completedMiddleLeaf = findLeafForStream(result.nextTree, streamB.id)
  assert.ok(completedMiddleLeaf)
  assert.equal(completedMiddleLeaf.completed, true)

  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [streamA.id, refreshedSiblingC.id])
})

test('empty Runner goals synthesize the actual induction base and successor states', () => {
  const original = stream('induction-original', '0 + n = n', null, [
    hyp('induction-n', 'n', 'ℕ'),
  ])
  const beforeTree = {
    id: 'induction-leaf',
    streamId: original.id,
    label: null,
    completed: false,
    children: [],
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [original], completed: false },
    { streams: [], completed: false },
    original,
    'induction n with d hd',
    true,
    original.id,
    [],
  )

  assert.equal(result.focusedStreams.length, 2)
  const [base, successor] = result.focusedStreams
  assert.equal(base.goal.type.text, '0 + 0 = 0')
  assert.equal(base.equalityTree, undefined)
  assert.deepEqual(base.hyps.map(card => card.hyp.names[0]), [])
  assert.equal(successor.goal.type.text, '0 + succ(d) = succ(d)')
  assert.equal(successor.equalityTree, undefined)
  assert.deepEqual(successor.hyps.map(card => card.hyp.names[0]), ['d', 'hd'])
  assert.equal(successor.hyps[1].hyp.type.text, '0 + d = d')
})

test('empty Runner goals keep the obligation created by a constructed witness', () => {
  const original = stream('exists-original', 'x ≤ x', null, [hyp('exists-x', 'x', 'ℕ')])
  original.existsInfo = { varName: 'a', body: 'x + a = x' }
  const beforeTree = {
    id: 'exists-leaf', streamId: original.id, label: null, completed: false, children: [],
  }
  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [original], completed: false },
    { streams: [], completed: false },
    original,
    'refine Exists.intro (0) ?_',
    false,
    original.id,
    [],
  )

  assert.equal(result.focusedStreams.length, 1)
  assert.equal(result.focusedStreams[0].goal.type.text, 'x + 0 = x')
  assert.equal(result.focusedStreams[0].existsInfo, undefined)
  assert.equal(result.nextTree.completed, false)
})

test('empty Runner goals synthesize substituted Nat cases branches', () => {
  const original = stream('cases-original', 'a + b = 0 → a = 0', null, [
    hyp('cases-a', 'a', 'ℕ'),
    hyp('cases-b', 'b', 'ℕ'),
  ])
  const beforeTree = {
    id: 'cases-leaf', streamId: original.id, label: null, completed: false, children: [],
  }
  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [original], completed: false },
    { streams: [], completed: false },
    original,
    'cases b',
    true,
    original.id,
    [],
  )

  assert.equal(result.focusedStreams[0].goal.type.text, 'a + 0 = 0 → a = 0')
  assert.equal(result.focusedStreams[1].goal.type.text, 'a + succ(b) = 0 → a = 0')
  assert.deepEqual(result.focusedStreams[1].hyps.map(card => card.hyp.names[0]), ['a', 'b'])
})

test('completed branches can still opt into automatic navigation', () => {
  const { streamA, streamB, staleSiblingC, refreshedSiblingC } = baseStreams()
  const result = reconcileProofTreeAfterInteraction(
    baseTree({ streamA, streamB, staleSiblingC }),
    { streams: [streamA, streamB, staleSiblingC], completed: false },
    { streams: [refreshedSiblingC], completed: false },
    streamB,
    'drag_goal left',
    false,
    streamB.id,
    undefined,
    true,
  )

  assert.equal(result.nextActiveId, refreshedSiblingC.id)
})

test('a sibling-only canvas result does not steal focus from the middle B branch after click_prop', () => {
  const { streamA, streamB, staleSiblingC, refreshedSiblingC } = baseStreams()
  const beforeTree = baseTree({ streamA, streamB, staleSiblingC })
  const beforeCanvas = {
    streams: [streamA, streamB, staleSiblingC],
    completed: false,
  }
  const afterCanvas = {
    streams: [refreshedSiblingC],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    streamB,
    'click_prop h2',
    false,
    streamB.id,
  )

  const activeIds = collectActiveStreamIds(result.nextTree)
  assertUniqueIds(activeIds)
  assert.equal(result.focusedStreams.length, 1)

  const synthesizedMiddleStream = result.focusedStreams[0]
  assert.ok(synthesizedMiddleStream)
  assert.equal(synthesizedMiddleStream.goal.type.text, 'B')
  assert.deepEqual(
    synthesizedMiddleStream.hyps.map(card => card.hyp.names[0]),
    ['h', 'left', 'right'],
  )

  assert.equal(result.nextActiveId, synthesizedMiddleStream.id)
  assert.deepEqual(activeIds, [streamA.id, synthesizedMiddleStream.id, refreshedSiblingC.id])
  const middleLeaf = findLeafForStream(result.nextTree, streamB.id)
  assert.ok(middleLeaf)
  assert.equal(middleLeaf.completed, false)
  assert.ok(findLeafForStream(result.nextTree, refreshedSiblingC.id))
  assert.deepEqual(
    result.nextCanvas.streams.map(stream => stream.id),
    [streamA.id, synthesizedMiddleStream.id, refreshedSiblingC.id],
  )
})

test('click_prop keeps stream 2 on B when Lean reports sibling C with unicode proposition text', () => {
  const { streamA, streamB, staleSiblingC, refreshedSiblingC } = unicodeStreams()
  const beforeTree = baseTree({ streamA, streamB, staleSiblingC })
  const beforeCanvas = {
    streams: [streamA, streamB, staleSiblingC],
    completed: false,
  }
  const afterCanvas = {
    streams: [refreshedSiblingC],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    streamB,
    'click_prop h2',
    false,
    streamB.id,
    [refreshedSiblingC],
  )

  const activeIds = collectActiveStreamIds(result.nextTree)
  assertUniqueIds(activeIds)
  assert.equal(result.focusedStreams.length, 1)

  const synthesizedMiddleStream = result.focusedStreams[0]
  assert.ok(synthesizedMiddleStream)
  assert.equal(synthesizedMiddleStream.goal.type.text, 'B')
  assert.deepEqual(
    synthesizedMiddleStream.hyps.map(card => card.hyp.names[0]),
    ['h', 'left', 'right'],
  )
  assert.equal(result.nextActiveId, synthesizedMiddleStream.id)
  assert.deepEqual(activeIds, [streamA.id, synthesizedMiddleStream.id, refreshedSiblingC.id])
})

test('a sibling C stream from focused goals cannot be reused for both right-hand leaves', () => {
  const { streamA, streamB, staleSiblingC, refreshedSiblingC } = baseStreams()
  const beforeTree = baseTree({ streamA, streamB, staleSiblingC })
  const beforeCanvas = {
    streams: [streamA, streamB, staleSiblingC],
    completed: false,
  }
  const afterCanvas = {
    streams: [refreshedSiblingC],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    streamB,
    'drag_goal left',
    false,
    streamB.id,
    [refreshedSiblingC],
  )

  const activeIds = collectActiveStreamIds(result.nextTree)
  assertUniqueIds(activeIds)
  assert.deepEqual(activeIds, [streamA.id, streamB.id, refreshedSiblingC.id])
  assert.equal(result.nextActiveId, streamB.id)

  const completedMiddleLeaf = findLeafForStream(result.nextTree, streamB.id)
  assert.ok(completedMiddleLeaf)
  assert.equal(completedMiddleLeaf.completed, true)
  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [streamA.id, refreshedSiblingC.id])
})

test('empty focused goals after drag_goal complete stream 2 without auto-navigation', () => {
  const { streamA, streamB, staleSiblingC } = baseStreams()
  const beforeTree = treeAfterFirstLeafSolved({ streamA, streamB, staleSiblingC })
  const beforeCanvas = {
    streams: [streamB, staleSiblingC],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    streamB,
    'drag_goal left',
    false,
    streamB.id,
    [],
  )

  const activeIds = collectActiveStreamIds(result.nextTree)
  assertUniqueIds(activeIds)
  assert.deepEqual(activeIds, [streamA.id, streamB.id, staleSiblingC.id])
  assert.deepEqual(collectLiveStreamIds(result.nextTree), [staleSiblingC.id])
  assert.equal(result.nextActiveId, streamB.id)

  const completedMiddleLeaf = findLeafForStream(result.nextTree, streamB.id)
  assert.ok(completedMiddleLeaf)
  assert.equal(completedMiddleLeaf.completed, true)
  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [staleSiblingC.id])
})

test('empty focused goals after click_prop on the C stream still synthesize the split follow-up stream', () => {
  const splitHypType = 'And B (A -> B -> C)'
  const streamA = stream('followup-stream-a', 'A', 'left', [
    hyp('followup-hyp-h', 'h', 'A'),
  ])
  const splitB = stream('followup-stream-b-split', 'B', 'right', [
    hyp('followup-hyp-h', 'h', 'A'),
    hyp('followup-hyp-left', 'left', 'B'),
    hyp('followup-hyp-right', 'right', 'A -> B -> C'),
  ])
  const streamC = stream('followup-stream-c', 'C', 'right', [
    hyp('followup-hyp-h', 'h', 'A'),
    hyp('followup-hyp-h2', 'h2', splitHypType),
  ])

  const beforeTree = baseTree({ streamA, streamB: splitB, staleSiblingC: streamC })
  const treeAfterA = completeLeafStream(beforeTree, streamA.id)
  const treeAfterB = completeLeafStream(treeAfterA, splitB.id)
  const beforeCanvas = {
    streams: [streamC],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    treeAfterB,
    beforeCanvas,
    afterCanvas,
    streamC,
    'click_prop h2',
    false,
    streamC.id,
    [],
  )

  assert.equal(result.focusedStreams.length, 1)
  const splitC = result.focusedStreams[0]
  assert.equal(splitC.goal.type.text, 'C')
  assert.deepEqual(splitC.hyps.map(card => card.hyp.names[0]), ['h', 'left', 'right'])
  assert.equal(result.nextActiveId, splitC.id)
  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [splitC.id])
  assert.equal(findLeafForStream(result.nextTree, streamC.id)?.completed, false)
})

test('reflexive click_goal ignores a stale continuation and keeps the completed arm selected', () => {
  const zeroStream = stream('refl-zero', '0 = 0', 'zero', [])
  const succStream = stream('refl-succ', 'succ n = succ n', 'succ', [
    hyp('refl-ih', 'ih', 'n = n'),
  ])
  const staleZero = stream('refl-zero-stale', '0 = 0', 'zero', [])
  const refreshedSucc = stream('refl-succ', 'succ n = succ n', 'succ', [
    hyp('refl-ih', 'ih', 'n = n'),
  ])

  const beforeTree = {
    id: 'refl-root',
    streamId: null,
    label: null,
    completed: false,
    children: [
      {
        id: 'refl-zero-leaf',
        streamId: zeroStream.id,
        label: zeroStream.goal.userName,
        completed: false,
        children: [],
      },
      {
        id: 'refl-succ-leaf',
        streamId: succStream.id,
        label: succStream.goal.userName,
        completed: false,
        children: [],
      },
    ],
  }
  const beforeCanvas = {
    streams: [zeroStream, succStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [staleZero, refreshedSucc],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    zeroStream,
    'click_goal',
    false,
    zeroStream.id,
    [staleZero],
  )

  assert.deepEqual(collectLiveStreamIds(result.nextTree), [succStream.id])
  assert.equal(result.nextActiveId, zeroStream.id)
  assert.equal(findLeafForStream(result.nextTree, zeroStream.id)?.completed, true)
  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [refreshedSucc.id])
})

test('reflexive click_goal still completes the final proof when Lean reports a stale 0 = 0 stream', () => {
  const zeroStream = stream('refl-final-zero', '0 = 0', 'zero', [])
  const staleZero = stream('refl-final-zero-stale', '0 = 0', 'zero', [])
  const beforeTree = {
    id: 'refl-final-root',
    streamId: zeroStream.id,
    label: zeroStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [zeroStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [staleZero],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    zeroStream,
    'click_goal',
    false,
    zeroStream.id,
    [staleZero],
  )

  assert.deepEqual(collectLiveStreamIds(result.nextTree), [])
  assert.equal(result.nextActiveId, null)
  assert.equal(findLeafForStream(result.nextTree, zeroStream.id)?.completed, true)
  assert.equal(result.nextCanvas.completed, true)
  assert.deepEqual(result.nextCanvas.streams, [])
})

test('drag_goal applying an induction hypothesis keeps the successor branch live', () => {
  const completedBaseStream = stream('induction-base', '0 = 0', 'zero', [])
  const successorStream = stream('induction-succ', 'a = b', 'succ', [
    hyp('induction-h', 'h', 'succ (a + d) = succ (b + d)'),
    hyp('induction-ih', 'n_ih', 'a + d = b + d -> a = b'),
  ])
  const successorPremiseStream = stream('induction-succ-next', 'a + d = b + d', 'succ', [
    hyp('induction-h', 'h', 'succ (a + d) = succ (b + d)'),
    hyp('induction-ih', 'n_ih', 'a + d = b + d -> a = b'),
  ])

  const beforeTree = {
    id: 'induction-root',
    streamId: null,
    label: null,
    completed: false,
    children: [
      {
        id: 'induction-base-leaf',
        streamId: completedBaseStream.id,
        label: completedBaseStream.goal.userName,
        completed: true,
        children: [],
      },
      {
        id: 'induction-succ-leaf',
        streamId: successorStream.id,
        label: successorStream.goal.userName,
        completed: false,
        children: [],
      },
    ],
  }
  const beforeCanvas = {
    streams: [successorStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [successorPremiseStream],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    successorStream,
    'drag_goal n_ih',
    false,
    successorStream.id,
    [successorPremiseStream],
  )

  assert.deepEqual(collectActiveStreamIds(result.nextTree), [completedBaseStream.id, successorPremiseStream.id])
  assert.deepEqual(collectLiveStreamIds(result.nextTree), [successorPremiseStream.id])
  assert.equal(result.nextActiveId, successorPremiseStream.id)
  assert.equal(findLeafForStream(result.nextTree, successorPremiseStream.id)?.completed, false)
  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [successorPremiseStream.id])
})

test('drag_goal with a tray theorem keeps an explicitly returned harder goal live', () => {
  const before = stream('le-total-succ', 'succ(d2) = succ(d + c)', 'succ', [
    hyp('le-total-h1', 'h1', 'd2 = d + c'),
  ])
  const after = stream('le-total-succ-next', 'succ(succ(d2)) = succ(succ(d + c))', 'succ', [
    hyp('le-total-h1-next', 'h1', 'd2 = d + c'),
  ])
  const beforeTree = {
    id: 'le-total-root',
    streamId: before.id,
    label: before.goal.userName,
    completed: false,
    children: [],
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [before], completed: false },
    { streams: [after], completed: false },
    before,
    'drag_goal succ_inj',
    false,
    before.id,
    [after],
  )

  assert.deepEqual(collectLiveStreamIds(result.nextTree), [after.id])
  assert.equal(result.nextActiveId, after.id)
  assert.equal(findLeafForStream(result.nextTree, after.id)?.completed, false)
  assert.equal(result.nextCanvas.completed, false)
  assert.deepEqual(result.nextCanvas.streams.map(item => item.id), [after.id])
})

test('the full nested conjunction proof can reconcile from A through final C completion', () => {
  const splitHypType = 'And B (A -> B -> C)'
  const splitRightType = 'A -> B -> C'
  const streamA = stream('full-stream-a', 'A', 'left', [
    hyp('full-hyp-h', 'h', 'A'),
  ])
  const streamB = stream('full-stream-b', 'B', 'right', [
    hyp('full-hyp-h', 'h', 'A'),
    hyp('full-hyp-h2', 'h2', splitHypType),
  ])
  const streamC = stream('full-stream-c', 'C', 'right', [
    hyp('full-hyp-h', 'h', 'A'),
    hyp('full-hyp-h2', 'h2', splitHypType),
  ])

  const initialTree = baseTree({ streamA, streamB, staleSiblingC: streamC })
  const initialCanvas = {
    streams: [streamA, streamB, streamC],
    completed: false,
  }

  const afterA = reconcileProofTreeAfterInteraction(
    initialTree,
    initialCanvas,
    {
      streams: [streamB, streamC],
      completed: false,
    },
    streamA,
    'drag_goal h',
    false,
    streamA.id,
    [streamB],
  )

  assert.deepEqual(collectLiveStreamIds(afterA.nextTree), [streamB.id, streamC.id])
  assert.deepEqual(afterA.nextCanvas.streams.map(stream => stream.id), [streamB.id, streamC.id])
  assert.equal(afterA.nextActiveId, streamA.id)
  assert.equal(findLeafForStream(afterA.nextTree, streamA.id)?.completed, true)

  const afterBSplit = reconcileProofTreeAfterInteraction(
    afterA.nextTree,
    afterA.nextCanvas,
    {
      streams: [streamC],
      completed: false,
    },
    streamB,
    'click_prop h2',
    false,
    streamB.id,
    [streamC],
  )

  assert.equal(afterBSplit.focusedStreams.length, 1)
  const splitB = afterBSplit.focusedStreams[0]
  assert.equal(splitB.goal.type.text, 'B')
  assert.deepEqual(splitB.hyps.map(card => card.hyp.names[0]), ['h', 'left', 'right'])
  assert.deepEqual(afterBSplit.nextCanvas.streams.map(stream => stream.id), [splitB.id, streamC.id])
  assert.equal(afterBSplit.nextActiveId, splitB.id)

  const afterBComplete = reconcileProofTreeAfterInteraction(
    afterBSplit.nextTree,
    afterBSplit.nextCanvas,
    {
      streams: [streamC],
      completed: false,
    },
    splitB,
    'drag_goal left',
    false,
    splitB.id,
    [streamC],
  )

  assert.deepEqual(collectLiveStreamIds(afterBComplete.nextTree), [streamC.id])
  assert.deepEqual(afterBComplete.nextCanvas.streams.map(stream => stream.id), [streamC.id])
  assert.equal(afterBComplete.nextActiveId, splitB.id)
  assert.equal(findLeafForStream(afterBComplete.nextTree, splitB.id)?.completed, true)

  const afterCSplit = reconcileProofTreeAfterInteraction(
    afterBComplete.nextTree,
    afterBComplete.nextCanvas,
    {
      streams: [],
      completed: false,
    },
    streamC,
    'click_prop h2',
    false,
    streamC.id,
  )

  assert.equal(afterCSplit.focusedStreams.length, 1)
  const splitC = afterCSplit.focusedStreams[0]
  assert.equal(splitC.goal.type.text, 'C')
  assert.deepEqual(splitC.hyps.map(card => card.hyp.names[0]), ['h', 'left', 'right'])
  assert.equal(afterCSplit.nextCanvas.streams.length, 1)
  assert.equal(afterCSplit.nextCanvas.streams[0]?.id, splitC.id)
  assert.equal(afterCSplit.nextActiveId, splitC.id)

  const afterApplyH = reconcileProofTreeAfterInteraction(
    afterCSplit.nextTree,
    afterCSplit.nextCanvas,
    {
      streams: [],
      completed: false,
    },
    splitC,
    'drag_to h right',
    false,
    afterCSplit.nextActiveId,
  )

  assert.equal(afterApplyH.focusedStreams.length, 1)
  const appliedH = afterApplyH.focusedStreams[0]
  assert.equal(appliedH.goal.type.text, 'C')
  assert.equal(hypTypeFor(appliedH, 'h'), 'A')
  assert.equal(hypTypeFor(appliedH, 'h1'), splitRightType.replace('A -> ', ''))
  assert.equal(hypTypeFor(appliedH, 'right'), splitRightType)
  assert.equal(hypTypeFor(appliedH, 'left'), 'B')
  assert.equal(afterApplyH.nextCanvas.streams[0]?.id, appliedH.id)
  assert.equal(afterApplyH.nextActiveId, appliedH.id)

  const afterApplyB = reconcileProofTreeAfterInteraction(
    afterApplyH.nextTree,
    afterApplyH.nextCanvas,
    {
      streams: [],
      completed: false,
    },
    appliedH,
    'drag_to left h1',
    false,
    afterApplyH.nextActiveId,
  )

  assert.equal(afterApplyB.focusedStreams.length, 1)
  const appliedB = afterApplyB.focusedStreams[0]
  assert.equal(appliedB.goal.type.text, 'C')
  assert.equal(hypTypeFor(appliedB, 'left'), 'B')
  assert.equal(hypTypeFor(appliedB, 'h1'), 'B -> C')
  assert.equal(hypTypeFor(appliedB, 'h2'), 'C')
  assert.equal(afterApplyB.nextCanvas.streams[0]?.id, appliedB.id)
  assert.equal(afterApplyB.nextActiveId, appliedB.id)

  const afterCComplete = reconcileProofTreeAfterInteraction(
    afterApplyB.nextTree,
    afterApplyB.nextCanvas,
    {
      streams: [],
      completed: true,
    },
    appliedB,
    'drag_goal h2',
    false,
    afterApplyB.nextActiveId,
    [],
  )

  const activeIds = collectActiveStreamIds(afterCComplete.nextTree)
  assertUniqueIds(activeIds)
  assert.deepEqual(collectLiveStreamIds(afterCComplete.nextTree), [])
  assert.equal(afterCComplete.nextActiveId, null)
  assert.equal(afterCComplete.nextCanvas.completed, true)
  assert.deepEqual(afterCComplete.nextCanvas.streams, [])
  assert.equal(findLeafForStream(afterCComplete.nextTree, appliedB.id)?.completed, true)
})

test('final drag_goal completes the tree when Lean returns an empty incomplete canvas', () => {
  const streamA = stream('fallback-stream-a', 'A', 'left', [
    hyp('fallback-hyp-h', 'h', 'A'),
  ])
  const splitB = stream('fallback-stream-b', 'B', 'left', [
    hyp('fallback-hyp-h', 'h', 'A'),
    hyp('fallback-hyp-left', 'left', 'B'),
  ])
  const streamC = stream('fallback-stream-c', 'C', 'right', [
    hyp('fallback-hyp-h', 'h', 'A'),
    hyp('fallback-hyp-left', 'left', 'B'),
    hyp('fallback-hyp-h2', 'h2', 'C'),
  ])
  const beforeTree = {
    id: 'fallback-root',
    streamId: null,
    label: null,
    completed: false,
    children: [
      {
        id: 'fallback-leaf-a',
        streamId: streamA.id,
        label: streamA.goal.userName,
        completed: true,
        children: [],
      },
      {
        id: 'fallback-branch-right',
        streamId: null,
        label: 'right',
        completed: false,
        children: [
          {
            id: 'fallback-leaf-b',
            streamId: splitB.id,
            label: splitB.goal.userName,
            completed: true,
            children: [],
          },
          {
            id: 'fallback-leaf-c',
            streamId: streamC.id,
            label: streamC.goal.userName,
            completed: false,
            children: [],
          },
        ],
      },
    ],
  }
  const beforeCanvas = {
    streams: [streamA, splitB, streamC],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    {
      streams: [],
      completed: false,
    },
    streamC,
    'drag_goal h2',
    false,
    streamC.id,
    [],
  )

  assert.deepEqual(collectLiveStreamIds(result.nextTree), [])
  assert.equal(result.nextCanvas.completed, true)
  assert.equal(findLeafForStream(result.nextTree, streamC.id)?.completed, true)
})

test('click_prop specializes a reflexive-equality implication hypothesis in place', () => {
  const focusedStream = stream('stream-rfl', 'Goal', 'main', [
    hyp('hyp-rfl', 'h', 'a = a → B'),
    hyp('hyp-q', 'hq', 'Q'),
  ])
  const beforeTree = {
    id: 'leaf-rfl',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'click_prop h',
    false,
    focusedStream.id,
  )

  assert.equal(result.focusedStreams.length, 1)
  const specializedStream = result.focusedStreams[0]
  assert.ok(specializedStream)
  assert.equal(specializedStream.goal.type.text, 'Goal')
  assert.equal(hypTypeFor(specializedStream, 'h'), 'B')
  assert.equal(hypTypeFor(specializedStream, 'hq'), 'Q')
  assert.equal(result.nextCanvas.streams.length, 1)
  assert.equal(result.nextCanvas.streams[0]?.id, specializedStream.id)

  const leaf = findLeafForStream(result.nextTree, specializedStream.id)
  assert.ok(leaf)
  assert.equal(leaf?.completed, false)
})

test('right goal choice keeps the selected disjunction continuation among sibling branches', () => {
  const sibling = stream('sibling', 'Already pending', 'left', [])
  const focused = stream('focused', 'succ(d) ≤ succ(d2) ∨ succ(d2) ≤ succ(d)', 'right', [])
  const continuation = stream('focused-next', 'succ(d2) ≤ succ(d)', 'right', [])
  const beforeTree = {
    id: 'root',
    streamId: null,
    label: null,
    completed: false,
    children: [
      { id: 'sibling-leaf', streamId: sibling.id, label: sibling.goal.userName, completed: false, children: [] },
      { id: 'focused-leaf', streamId: focused.id, label: focused.goal.userName, completed: false, children: [] },
    ],
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [sibling, focused], completed: false },
    { streams: [sibling, continuation], completed: false },
    focused,
    'click_goal_right',
    false,
    focused.id,
    [continuation],
  )

  assert.equal(result.focusedStreams.length, 1)
  assert.equal(result.focusedStreams[0]?.id, continuation.id)
  assert.equal(result.focusedStreams[0]?.goal.type.text, 'succ(d2) ≤ succ(d)')
  assert.equal(result.nextActiveId, continuation.id)
  assert.deepEqual(result.nextCanvas.streams.map(item => item.id), [sibling.id, continuation.id])
  assert.equal(findLeafForStream(result.nextTree, continuation.id)?.completed, false)
})

test('click_goal on an explicit forall goal introduces the bound variable before the implication', () => {
  const focusedStream = stream('stream-forall', '∀ (c : ℕ), a * 0 = a * c → 0 = c', 'main', [])
  const beforeTree = {
    id: 'leaf-forall',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'click_goal',
    false,
    focusedStream.id,
  )

  assert.equal(result.focusedStreams.length, 1)
  const introducedStream = result.focusedStreams[0]
  assert.ok(introducedStream)
  assert.equal(introducedStream.goal.type.text, 'a * 0 = a * c → 0 = c')
  assert.equal(introducedStream.goal.clickAction?.playTactic, 'click_goal')
  assert.equal(introducedStream.goal.clickAction?.tooltip, 'Click to introduce assumption')
  assert.equal(hypTypeFor(introducedStream, 'c'), 'ℕ')
  assert.equal(result.nextCanvas.streams.length, 1)
  assert.equal(result.nextCanvas.streams[0]?.id, introducedStream.id)
})

test('click_goal on a bounded comparison forall introduces the variable and assumption together', () => {
  const focusedStream = stream('stream-bounded-forall', '∀ a > 0, P a', 'main', [])
  const beforeTree = {
    id: 'leaf-bounded-forall',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'click_goal',
    false,
    focusedStream.id,
  )

  assert.equal(result.focusedStreams.length, 1)
  const introducedStream = result.focusedStreams[0]
  assert.ok(introducedStream)
  assert.equal(introducedStream.goal.type.text, 'P a')
  assert.equal(introducedStream.goal.clickAction?.playTactic, undefined)
  assert.equal(introducedStream.goal.clickAction?.tooltip, undefined)
  assert.equal(hypTypeFor(introducedStream, 'a'), '…')
  assert.equal(hypTypeFor(introducedStream, 'ha'), 'a > 0')
  assert.equal(result.nextCanvas.streams.length, 1)
  assert.equal(result.nextCanvas.streams[0]?.id, introducedStream.id)
})

test('drag_to keeps a local theorem card green and overwrites it regardless of drag direction', () => {
  const focusedStream = stream('stream-thm-overwrite', 'Goal', 'main', [
    hyp('hyp-theorem', 'thm_apply', 'P → Q', { isTheorem: true }),
    hyp('hyp-p', 'hp', 'P'),
  ])
  const beforeTree = {
    id: 'leaf-thm-overwrite',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const resultA = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'drag_to thm_apply hp',
    false,
    focusedStream.id,
  )
  const streamA = resultA.focusedStreams[0]
  assert.ok(streamA)
  assert.equal(hypTypeFor(streamA, 'thm_apply'), 'Q')
  assert.equal(findHyp(streamA, 'thm_apply')?.isTheorem, true)
  assert.equal(hypTypeFor(streamA, 'hp'), 'P')

  const resultB = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'drag_to hp thm_apply',
    false,
    focusedStream.id,
  )
  const streamB = resultB.focusedStreams[0]
  assert.ok(streamB)
  assert.equal(hypTypeFor(streamB, 'thm_apply'), 'Q')
  assert.equal(findHyp(streamB, 'thm_apply')?.isTheorem, true)
  assert.equal(hypTypeFor(streamB, 'hp'), 'P')
})

test('drag_to specializes a forall hypothesis without completing its goal', () => {
  const focusedStream = stream('stream-forall-drag', 'Goal', 'main', [
    hyp('hyp-x', 'x', 'ℕ'),
    hyp('hyp-all', 'hall', '∀ (y : ℕ), y ≤ x ∨ x ≤ y'),
  ])
  const beforeTree = {
    id: 'leaf-forall-drag',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [focusedStream], completed: false },
    { streams: [], completed: true },
    focusedStream,
    'drag_to x hall',
    false,
    focusedStream.id,
  )

  assert.equal(result.nextCanvas.completed, false)
  assert.equal(result.focusedStreams.length, 1)
  assert.equal(result.focusedStreams[0].goal.type.text, 'Goal')
  assert.ok(result.focusedStreams[0].hyps.some(card =>
    card.isTheorem && card.hyp.type.text === 'x ≤ x ∨ x ≤ x'
  ))
})

test('an unrecognized hypothesis click never marks the live goal complete', () => {
  const focusedStream = stream('stream-click-follow-up', 'Goal', 'main', [
    hyp('hyp-clicked', 'h', 'OpaqueProposition'),
  ])
  const beforeTree = {
    id: 'leaf-click-follow-up',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [focusedStream], completed: false },
    { streams: [], completed: true },
    focusedStream,
    'click_prop h',
    false,
    focusedStream.id,
  )

  assert.equal(result.nextCanvas.completed, false)
  assert.equal(result.focusedStreams[0]?.id, focusedStream.id)
  assert.equal(findLeafForStream(result.nextTree, focusedStream.id)?.completed, false)
})

test('local theorem premise drags always produce valid shadowing Lean', () => {
  const focusedStream = stream('stream-thm-proof', 'a = b', 'main', [
    hyp('hyp-theorem', 'thm_succ_inj', 'succ(a) = succ(b) → a = b', { isTheorem: true }),
    hyp('hyp-p', 'h', 'succ(a) = succ(b)'),
  ])

  assert.equal(
    inferLocalTheoremPremiseApplication(focusedStream, 'thm_succ_inj', 'h'),
    'have thm_succ_inj := thm_succ_inj h',
  )
  assert.equal(
    inferLocalTheoremPremiseApplication(focusedStream, 'h', 'thm_succ_inj'),
    'have thm_succ_inj := thm_succ_inj h',
  )
  const preReconciliationStream = stream('stream-thm-proof-raw', 'a = b', 'main', [
    hyp('hyp-theorem', 'thm_succ_inj', 'succ(a) = succ(b) → a = b'),
    hyp('hyp-p', 'h', 'succ(a) = succ(b)'),
  ])
  assert.equal(
    inferLocalTheoremPremiseApplication(preReconciliationStream, 'thm_succ_inj', 'h'),
    'have thm_succ_inj := thm_succ_inj h',
  )
})

test('drag_to keeps both theorem cards and adds a fresh theorem result card', () => {
  const focusedStream = stream('stream-thm-fresh', 'Goal', 'main', [
    hyp('hyp-theorem-f', 'thm_f', 'P → Q', { isTheorem: true }),
    hyp('hyp-theorem-p', 'thm_p', 'P', { isTheorem: true }),
  ])
  const beforeTree = {
    id: 'leaf-thm-fresh',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'drag_to thm_f thm_p',
    false,
    focusedStream.id,
  )

  const nextStream = result.focusedStreams[0]
  assert.ok(nextStream)
  assert.equal(nextStream.hyps.length, 3)
  assert.equal(hypTypeFor(nextStream, 'thm_f'), 'P → Q')
  assert.equal(hypTypeFor(nextStream, 'thm_p'), 'P')
  assert.equal(hypTypeFor(nextStream, 'thm_f1'), 'Q')
  assert.equal(findHyp(nextStream, 'thm_f')?.isTheorem, true)
  assert.equal(findHyp(nextStream, 'thm_p')?.isTheorem, true)
  assert.equal(findHyp(nextStream, 'thm_f1')?.isTheorem, true)
})

test('click_prop keeps conjunction split children green when the source card is a theorem', () => {
  const focusedStream = stream('stream-thm-and', 'Goal', 'main', [
    hyp('hyp-theorem-and', 'thm_h', 'P ∧ Q', { isTheorem: true }),
    hyp('hyp-r', 'hr', 'R'),
  ])
  const beforeTree = {
    id: 'leaf-thm-and',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'click_prop thm_h',
    false,
    focusedStream.id,
  )

  const nextStream = result.focusedStreams[0]
  assert.ok(nextStream)
  assert.equal(hypTypeFor(nextStream, 'thm_left'), 'P')
  assert.equal(hypTypeFor(nextStream, 'thm_right'), 'Q')
  assert.equal(findHyp(nextStream, 'thm_left')?.isTheorem, true)
  assert.equal(findHyp(nextStream, 'thm_right')?.isTheorem, true)
  assert.equal(findHyp(nextStream, 'thm_h'), undefined)
})

test('click_prop keeps disjunction case hypotheses green when the source card is a theorem', () => {
  const focusedStream = stream('stream-thm-or', 'Goal', 'main', [
    hyp('hyp-theorem-or', 'thm_h', 'P ∨ Q', { isTheorem: true }),
    hyp('hyp-r', 'hr', 'R'),
  ])
  const beforeTree = {
    id: 'leaf-thm-or',
    streamId: focusedStream.id,
    label: focusedStream.goal.userName,
    completed: false,
    children: [],
  }
  const beforeCanvas = {
    streams: [focusedStream],
    completed: false,
  }
  const afterCanvas = {
    streams: [],
    completed: false,
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'click_prop thm_h',
    true,
    focusedStream.id,
    [],
  )

  assert.equal(result.focusedStreams.length, 2)
  const leftBranch = result.focusedStreams[0]
  const rightBranch = result.focusedStreams[1]
  assert.equal(hypTypeFor(leftBranch, 'thm_left'), 'P')
  assert.equal(hypTypeFor(rightBranch, 'thm_right'), 'Q')
  assert.equal(findHyp(leftBranch, 'thm_left')?.isTheorem, true)
  assert.equal(findHyp(rightBranch, 'thm_right')?.isTheorem, true)
  assert.equal(leftBranch.goal.userName, 'inl thm_left')
  assert.equal(rightBranch.goal.userName, 'inr thm_right')
})

test('cases on False completes only the focused branch without synthesizing case streams', () => {
  const focusedStream = stream('stream-false', 'A', 'false-branch', [
    hyp('hyp-false', 'h', 'False'),
  ])
  const siblingStream = stream('stream-sibling', 'B', 'sibling', [])
  const beforeTree = {
    id: 'root-false',
    streamId: null,
    label: null,
    completed: false,
    children: [
      { id: 'leaf-false', streamId: focusedStream.id, label: 'false-branch', completed: false, children: [] },
      { id: 'leaf-sibling', streamId: siblingStream.id, label: 'sibling', completed: false, children: [] },
    ],
  }
  const beforeCanvas = { streams: [focusedStream, siblingStream], completed: false }
  const afterCanvas = { streams: [siblingStream], completed: false }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    beforeCanvas,
    afterCanvas,
    focusedStream,
    'cases h',
    false,
    focusedStream.id,
    [],
  )

  assert.deepEqual(result.focusedStreams, [])
  assert.deepEqual(collectLiveStreamIds(result.nextTree), [siblingStream.id])
  assert.deepEqual(result.nextCanvas.streams.map(candidate => candidate.id), [siblingStream.id])
  assert.equal(result.nextCanvas.completed, false)
  assert.equal(result.nextActiveId, focusedStream.id)
})

test('symm at a hypothesis stays on the selected branch when the browser reports only its sibling', () => {
  const focusedStream = stream('stream-symm', 'a = 0', 'succ', [
    hyp('hyp-a', 'a', '\u2115'),
    hyp('hyp-h', 'h', 'succ(a) = 0'),
  ])
  const siblingStream = stream('stream-zero', 'a = 0', 'zero', [
    hyp('hyp-a', 'a', '\u2115'),
    hyp('hyp-h', 'h', 'a + 0 = 0'),
  ])
  const beforeTree = {
    id: 'root-symm',
    streamId: null,
    label: null,
    completed: false,
    children: [
      { id: 'leaf-zero', streamId: siblingStream.id, label: 'zero', completed: false, children: [] },
      { id: 'leaf-symm', streamId: focusedStream.id, label: 'succ', completed: false, children: [] },
    ],
  }

  const result = reconcileProofTreeAfterInteraction(
    beforeTree,
    { streams: [siblingStream, focusedStream], completed: false },
    { streams: [siblingStream], completed: false },
    focusedStream,
    'symm at h',
    false,
    focusedStream.id,
  )

  assert.equal(result.focusedStreams.length, 1)
  assert.equal(hypTypeFor(result.focusedStreams[0], 'h'), '0 = succ(a)')
  assert.deepEqual(result.nextCanvas.streams.map(candidate => candidate.id), [
    siblingStream.id,
    focusedStream.id,
  ])
})
