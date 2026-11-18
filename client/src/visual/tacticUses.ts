import { findLeafForStream } from './proofTree'
import type { ProofStreamTreeNode } from './proofTree'

/** One step of the proof, as far as counting a tactic's uses needs it. */
export interface TacticUseStep {
  playTactic: string
  /** The proof tree once the step was taken. */
  treeSnapshot: ProofStreamTreeNode
  /** The stream the player was working in when the step was taken. */
  activeStreamIdBefore: string | null
}

/** The tactic a play command uses: its first word. */
export function playTacticName(playTactic: string): string {
  return playTactic.trim().split(/\s+/u, 1)[0] ?? ''
}

function nodePathToStream(tree: ProofStreamTreeNode, streamId: string): string[] | null {
  if (tree.children.length === 0) return tree.streamId === streamId ? [tree.id] : null
  for (const child of tree.children) {
    const path = nodePathToStream(child, streamId)
    if (path) return [tree.id, ...path]
  }
  return null
}

/**
 * How often `tactic` was used on the way to the branch `streamId` is the leaf of:
 * on the branch itself or on a branch it came from. Uses in other branches
 * don't count (`VisualTacticUses`).
 *
 * A tree node keeps its id while its stream moves on and when it branches, so
 * the node a step acted on is an ancestor of every branch that came from it.
 */
export function tacticUsesOnBranch(
  steps: TacticUseStep[],
  initialTree: ProofStreamTreeNode,
  currentTree: ProofStreamTreeNode,
  streamId: string,
  tactic: string,
): number {
  const lineage = new Set(nodePathToStream(currentTree, streamId) ?? [])
  if (lineage.size === 0) return 0
  let uses = 0
  steps.forEach((step, index) => {
    if (playTacticName(step.playTactic) !== tactic || !step.activeStreamIdBefore) return
    const treeBefore = index > 0 ? steps[index - 1]!.treeSnapshot : initialTree
    const node = findLeafForStream(treeBefore, step.activeStreamIdBefore)
    if (node && lineage.has(node.id)) uses += 1
  })
  return uses
}
