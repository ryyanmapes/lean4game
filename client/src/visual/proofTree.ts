import { v4 as uuidv4 } from 'uuid'
import type { GoalStream } from './types'

export interface ProofStreamTreeNode {
  id: string
  streamId: string | null
  label: string | null
  completed: boolean
  children: ProofStreamTreeNode[]
}

export function streamLabel(stream: GoalStream): string | null {
  return stream.goal.userName ?? null
}

export function createInitialProofTree(stream?: GoalStream): ProofStreamTreeNode {
  return {
    id: uuidv4(),
    streamId: stream?.id ?? null,
    label: stream ? streamLabel(stream) : null,
    completed: stream === undefined,
    children: [],
  }
}

export function cloneProofTree(node: ProofStreamTreeNode): ProofStreamTreeNode {
  return {
    ...node,
    children: node.children.map(cloneProofTree),
  }
}

export function replaceLeafStream(
  tree: ProofStreamTreeNode,
  oldStreamId: string,
  nextStream: GoalStream,
): ProofStreamTreeNode {
  if (tree.streamId === oldStreamId && tree.children.length === 0) {
    const nextLabel = streamLabel(nextStream) ?? tree.label
    return {
      ...tree,
      streamId: nextStream.id,
      label: nextLabel,
      completed: false,
    }
  }

  return {
    ...tree,
    children: tree.children.map(child => replaceLeafStream(child, oldStreamId, nextStream)),
  }
}

export function branchLeafStream(
  tree: ProofStreamTreeNode,
  oldStreamId: string,
  childStreams: GoalStream[],
): ProofStreamTreeNode {
  if (tree.streamId === oldStreamId && tree.children.length === 0) {
    return {
      ...tree,
      streamId: null,
      completed: false,
      children: childStreams.map(childStream => ({
        id: uuidv4(),
        streamId: childStream.id,
        label: streamLabel(childStream),
        completed: false,
        children: [],
      })),
    }
  }

  return {
    ...tree,
    children: tree.children.map(child => branchLeafStream(child, oldStreamId, childStreams)),
  }
}

export function splitLeafStream(
  tree: ProofStreamTreeNode,
  oldStreamId: string,
  leftStream: GoalStream,
  rightStream: GoalStream,
): ProofStreamTreeNode {
  return branchLeafStream(tree, oldStreamId, [leftStream, rightStream])
}

export function completeLeafStream(
  tree: ProofStreamTreeNode,
  oldStreamId: string,
): ProofStreamTreeNode {
  if (tree.streamId === oldStreamId && tree.children.length === 0) {
    return {
      ...tree,
      completed: true,
    }
  }

  return {
    ...tree,
    children: tree.children.map(child => completeLeafStream(child, oldStreamId)),
  }
}

export function collectActiveStreamIds(tree: ProofStreamTreeNode): string[] {
  if (tree.children.length === 0) {
    return tree.streamId ? [tree.streamId] : []
  }

  return tree.children.flatMap(collectActiveStreamIds)
}

export function collectLiveStreamIds(tree: ProofStreamTreeNode): string[] {
  if (tree.children.length === 0) {
    return tree.streamId && !tree.completed ? [tree.streamId] : []
  }

  return tree.children.flatMap(collectLiveStreamIds)
}

export function casePathForStream(tree: ProofStreamTreeNode, streamId: string): string[] | null {
  function isLive(node: ProofStreamTreeNode): boolean {
    if (node.children.length === 0) return !node.completed && node.streamId !== null
    return node.children.some(isLive)
  }

  // liveBeforeCount: number of live sibling subtrees that appear before this node.
  // A `case X =>` label is only needed when there is at least one live goal
  // that precedes this one — otherwise this stream is already the focused goal.
  function visit(node: ProofStreamTreeNode, path: string[], liveBeforeCount: number): string[] | null {
    const nextPath = (node.label && liveBeforeCount > 0) ? [...path, node.label] : path
    if (node.children.length === 0) {
      return node.streamId === streamId ? nextPath : null
    }

    let liveBefore = 0
    for (const child of node.children) {
      const result = visit(child, nextPath, liveBefore)
      if (result) return result
      if (isLive(child)) liveBefore++
    }

    return null
  }

  return visit(tree, [], 0)
}

export function findLeafForStream(tree: ProofStreamTreeNode, streamId: string): ProofStreamTreeNode | null {
  if (tree.children.length === 0) {
    return tree.streamId === streamId ? tree : null
  }

  for (const child of tree.children) {
    const result = findLeafForStream(child, streamId)
    if (result) return result
  }

  return null
}

export function leafCount(tree: ProofStreamTreeNode): number {
  if (tree.children.length === 0) return 1
  return tree.children.reduce((sum, child) => sum + leafCount(child), 0)
}

export function treeDepth(tree: ProofStreamTreeNode): number {
  if (tree.children.length === 0) return 0
  return 1 + Math.max(...tree.children.map(treeDepth))
}
