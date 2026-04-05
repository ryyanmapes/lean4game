import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
  collectActiveStreamIds,
  collectLiveStreamIds,
  completeLeafStream,
  findLeafForStream,
} = require('../../tmp-stream-tests/visual/proofTree.js')
const { reconcileProofTreeAfterInteraction } = require('../../tmp-stream-tests/visual/streamReconciliation.js')

function hyp(id, name, type) {
  return {
    id,
    hyp: {
      names: [name],
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
  return stream.hyps.find(card => card.hyp.names[0] === name)?.hyp.type.text
}

test('completing the middle branch updates the sibling C stream instead of duplicating it', () => {
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
  assert.equal(result.nextActiveId, refreshedSiblingC.id)

  const completedMiddleLeaf = findLeafForStream(result.nextTree, streamB.id)
  assert.ok(completedMiddleLeaf)
  assert.equal(completedMiddleLeaf.completed, true)

  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [streamA.id, refreshedSiblingC.id])
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
  assert.equal(result.nextActiveId, refreshedSiblingC.id)

  const completedMiddleLeaf = findLeafForStream(result.nextTree, streamB.id)
  assert.ok(completedMiddleLeaf)
  assert.equal(completedMiddleLeaf.completed, true)
  assert.deepEqual(result.nextCanvas.streams.map(stream => stream.id), [streamA.id, refreshedSiblingC.id])
})

test('empty focused goals after drag_goal still complete stream 2 and advance to C', () => {
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
  assert.equal(result.nextActiveId, staleSiblingC.id)

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

test('reflexive click_goal ignores a stale 0 = 0 continuation and advances to the sibling stream', () => {
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
  assert.equal(result.nextActiveId, succStream.id)
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
  assert.equal(afterA.nextActiveId, streamB.id)
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
    afterA.nextActiveId,
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
    afterBSplit.nextActiveId,
    [streamC],
  )

  assert.deepEqual(collectLiveStreamIds(afterBComplete.nextTree), [streamC.id])
  assert.deepEqual(afterBComplete.nextCanvas.streams.map(stream => stream.id), [streamC.id])
  assert.equal(afterBComplete.nextActiveId, streamC.id)
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
    afterBComplete.nextActiveId,
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
  assert.equal(hypTypeFor(appliedH, 'h'), splitRightType.replace('A -> ', ''))
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
    'drag_to left h',
    false,
    afterApplyH.nextActiveId,
  )

  assert.equal(afterApplyB.focusedStreams.length, 1)
  const appliedB = afterApplyB.focusedStreams[0]
  assert.equal(appliedB.goal.type.text, 'C')
  assert.equal(hypTypeFor(appliedB, 'h'), 'B -> C')
  assert.equal(hypTypeFor(appliedB, 'left'), 'C')
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
    'drag_goal left',
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
