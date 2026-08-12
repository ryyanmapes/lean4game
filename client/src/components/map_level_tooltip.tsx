import * as React from 'react'
import { createPortal } from 'react-dom'

interface TooltipPosition {
  left: number
  top: number
  below: boolean
}

let nextTooltipId = 0

/** Render SVG level names in a document-level portal so they are not clipped. */
export function useMapLevelTooltip(label: string) {
  const id = React.useMemo(() => `map-level-tooltip-${++nextTooltipId}`, [])
  const [position, setPosition] = React.useState<TooltipPosition | null>(null)
  const show = React.useCallback((event: React.SyntheticEvent<Element>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const edgePadding = 12
    const halfWidth = Math.min(176, (window.innerWidth - 2 * edgePadding) / 2)
    const left = Math.max(edgePadding + halfWidth,
      Math.min(window.innerWidth - edgePadding - halfWidth, bounds.left + bounds.width / 2))
    const below = bounds.top < 72
    setPosition({ left, top: below ? bounds.bottom + 10 : bounds.top - 10, below })
  }, [])
  const hide = React.useCallback(() => setPosition(null), [])
  const tooltip = position && typeof document !== 'undefined'
    ? createPortal(
      <div id={id} className={`map-level-name-tooltip${position.below ? ' is-below' : ''}`}
        role="tooltip" style={{ left: position.left, top: position.top }}>
        {label}
      </div>, document.body)
    : null
  return {
    tooltip,
    triggerProps: {
      'aria-describedby': position ? id : undefined,
      onPointerEnter: show,
      onPointerLeave: hide,
      onFocus: show,
      onBlur: hide,
    },
  }
}
