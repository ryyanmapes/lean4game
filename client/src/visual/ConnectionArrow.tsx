import * as React from 'react'

interface Props {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export function ConnectionArrow({ start, end }: Props) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const scale = 50
  // CP1: exit start going up; CP2: arrive at end from the direction of start
  const cp2x = end.x - (dx / len) * scale
  const cp2y = end.y - (dy / len) * scale
  const path = `M ${start.x} ${start.y} C ${start.x} ${start.y - scale}, ${cp2x} ${cp2y}, ${end.x} ${end.y}`

  return (
    <svg className="tr-connection-arrow" style={{ overflow: 'visible' }}>
      <defs>
        <marker id="tr-arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="var(--visual-accent-soft)" />
        </marker>
      </defs>
      <path
        d={path}
        stroke="var(--visual-accent-soft)"
        strokeWidth="3"
        fill="none"
        strokeDasharray="5,5"
        markerEnd="url(#tr-arrowhead)"
      />
      <circle cx={start.x} cy={start.y} r="4" fill="var(--visual-accent-soft)" />
    </svg>
  )
}
