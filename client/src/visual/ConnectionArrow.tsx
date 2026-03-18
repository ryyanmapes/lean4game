import * as React from 'react'

interface Props {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export function ConnectionArrow({ start, end }: Props) {
  const path = `M ${start.x} ${start.y} C ${start.x} ${start.y - 50}, ${end.x} ${end.y + 50}, ${end.x} ${end.y}`

  return (
    <svg className="tr-connection-arrow" style={{ overflow: 'visible' }}>
      <defs>
        <marker id="tr-arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#a78bfa" />
        </marker>
      </defs>
      <path
        d={path}
        stroke="#a78bfa"
        strokeWidth="3"
        fill="none"
        strokeDasharray="5,5"
        markerEnd="url(#tr-arrowhead)"
      />
      <circle cx={start.x} cy={start.y} r="4" fill="#a78bfa" />
    </svg>
  )
}
