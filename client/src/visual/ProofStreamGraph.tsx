import * as React from 'react'
import type { ReactElement } from 'react'
import type { ProofStreamTreeNode } from './proofTree'
import { treeDepth } from './proofTree'

interface Props {
  tree: ProofStreamTreeNode
  currentStreamId: string | null
  onNavigate: (streamId: string) => void
}

interface LayoutNode {
  treeNode: ProofStreamTreeNode
  x: number
  y: number
  children: LayoutNode[]
}

const NODE_RADIUS = 8
const LEVEL_HEIGHT = 40
const LEAF_SPACING = 36
const PADDING = 20
const MAX_DEPTH = 3

function layoutTree(node: ProofStreamTreeNode, depth: number, leafCounter: { value: number }): LayoutNode {
  if (node.children.length === 0) {
    const x = leafCounter.value * LEAF_SPACING
    leafCounter.value++
    return { treeNode: node, x, y: depth * LEVEL_HEIGHT, children: [] }
  }

  const children = node.children.map(child => layoutTree(child, depth + 1, leafCounter))
  const minX = Math.min(...children.map(child => child.x))
  const maxX = Math.max(...children.map(child => child.x))

  return {
    treeNode: node,
    x: (minX + maxX) / 2,
    y: depth * LEVEL_HEIGHT,
    children,
  }
}

function renderEdges(node: LayoutNode): ReactElement[] {
  const edges: ReactElement[] = []
  for (const child of node.children) {
    edges.push(
      <line
        key={`${node.treeNode.id}-${child.treeNode.id}`}
        x1={node.x + PADDING}
        y1={node.y + PADDING + NODE_RADIUS}
        x2={child.x + PADDING}
        y2={child.y + PADDING - NODE_RADIUS}
        stroke="var(--visual-tree-edge)"
        strokeWidth={2}
      />,
    )
    edges.push(...renderEdges(child))
  }
  return edges
}

export function ProofStreamGraph({ tree, currentStreamId, onNavigate }: Props) {
  const leafCounter = { value: 0 }
  const layout = layoutTree(tree, 0, leafCounter)
  const totalLeaves = leafCounter.value
  const depth = treeDepth(tree)

  const svgWidth = Math.max((totalLeaves - 1) * LEAF_SPACING, 0) + PADDING * 2
  const svgHeight = depth * LEVEL_HEIGHT + PADDING * 2
  const scaleFactor = depth > MAX_DEPTH ? MAX_DEPTH / depth : 1
  const displayWidth = Math.round(svgWidth * scaleFactor)
  const displayHeight = Math.round(svgHeight * scaleFactor)

  function renderNodes(node: LayoutNode): ReactElement[] {
    const items: ReactElement[] = []
    const isLeaf = node.treeNode.children.length === 0
    const streamId = node.treeNode.streamId
    const isCurrent = streamId !== null && streamId === currentStreamId
    const isComplete = node.treeNode.completed

    const cx = node.x + PADDING
    const cy = node.y + PADDING

    if (isLeaf) {
      const color = isComplete ? 'var(--visual-stream-complete)' : 'var(--visual-stream-pending)'
      items.push(
        <g
          key={node.treeNode.id}
          data-testid="proof-stream-leaf"
          data-node-id={node.treeNode.id}
          data-stream-id={streamId ?? undefined}
          data-current={isCurrent}
          data-completed={isComplete}
          onClick={streamId ? () => onNavigate(streamId) : undefined}
          style={{ cursor: streamId ? 'pointer' : undefined }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={NODE_RADIUS + 4}
            fill="none"
            stroke={color}
            strokeWidth={2}
            opacity={isCurrent ? 0.8 : 0.3}
          />
          {isCurrent && (
            <circle
              cx={cx}
              cy={cy}
              r={NODE_RADIUS + 8}
              fill="none"
              stroke="var(--visual-stream-current-ring)"
              strokeWidth={2}
              opacity={0.8}
            />
          )}
          <circle cx={cx} cy={cy} r={NODE_RADIUS} fill={color} />
        </g>,
      )
    } else {
      items.push(
        <circle
          key={node.treeNode.id}
          data-testid="proof-stream-branch"
          data-node-id={node.treeNode.id}
          cx={cx}
          cy={cy}
          r={NODE_RADIUS * 0.5}
          fill="var(--visual-tree-branch)"
        />,
      )
    }

    for (const child of node.children) {
      items.push(...renderNodes(child))
    }

    return items
  }

  return (
    <div className="proof-tree-diagram" data-testid="proof-stream-graph">
      <svg width={displayWidth} height={displayHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
        {renderEdges(layout)}
        {renderNodes(layout)}
      </svg>
    </div>
  )
}
