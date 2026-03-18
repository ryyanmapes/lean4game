import * as React from 'react'
import type { ExpressionNode } from './expr-types'
import { useDroppable } from '@dnd-kit/core'

interface Props {
  node: ExpressionNode
  isActive: boolean
  customIsValidDropTarget?: (node: ExpressionNode) => boolean
}

export function ExprRenderer({ node, isActive, customIsValidDropTarget }: Props) {
  const { isOver, setNodeRef } = useDroppable({ id: node.id, data: { node } })

  const isPotentialTarget = customIsValidDropTarget ? customIsValidDropTarget(node) : false

  const showHover = isActive && isOver

  const classes = [
    'tr-expression-node',
    node.type === 'binary' ? 'binary' : '',
    isPotentialTarget ? 'potential-target' : '',
    showHover && isPotentialTarget ? 'droppable-hover' : '',
    showHover && !isPotentialTarget ? 'droppable-invalid' : '',
  ].filter(Boolean).join(' ')

  return (
    <div ref={setNodeRef} className={classes}>
      {node.type === 'binary' ? (
        <>
          <div className="tr-child">
            <ExprRenderer
              node={node.left}
              isActive={isActive}
              customIsValidDropTarget={customIsValidDropTarget}
            />
          </div>
          <span className="tr-op">{node.op}</span>
          <div className="tr-child">
            <ExprRenderer
              node={node.right}
              isActive={isActive}
              customIsValidDropTarget={customIsValidDropTarget}
            />
          </div>
        </>
      ) : node.type === 'app' ? (
        <>
          <span className="tr-node-content">{node.func}(</span>
          <div className="tr-child">
            <ExprRenderer
              node={node.arg}
              isActive={isActive}
              customIsValidDropTarget={customIsValidDropTarget}
            />
          </div>
          <span className="tr-node-content">)</span>
        </>
      ) : (
        <span className="tr-node-content">
          {node.type === 'constant' ? node.value : node.name}
        </span>
      )}
    </div>
  )
}
