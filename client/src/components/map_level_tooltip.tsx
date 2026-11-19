import * as React from 'react'
import { createPortal } from 'react-dom'

interface TooltipPosition {
  left: number
  top: number
  below: boolean
  /** Shown for keyboard focus, so it does not depend on where the mouse is. */
  byFocus: boolean
}

let nextTooltipId = 0

/** A level on a map whose tooltip follows the mouse while the map scrolls. */
interface TooltipTarget {
  /** The mouse is over the level: show its name where the level now is. */
  show: (element: Element) => void
  /** The mouse is elsewhere: a name shown for it goes, one shown for focus moves along. */
  leave: (element: Element) => void
}

// A browser sends no pointer events while a page scrolls under a still mouse, so
// the name on screen would stay that of the level the mouse was over before, at
// the place where it used to be, until the mouse moved again. One listener for
// all levels keeps track of the mouse and, after a scroll, tells each level
// whether the mouse is over it now.
const targets = new Map<Element, TooltipTarget>()
let mouse: { x: number; y: number } | null = null
let pendingFrame = 0
let listening = false

function syncTooltipsToMouse() {
  pendingFrame = 0
  const under = mouse ? document.elementFromPoint(mouse.x, mouse.y) : null
  for (const [element, target] of targets) {
    if (under && element.contains(under)) target.show(element)
    else target.leave(element)
  }
}

function listenForScrolls() {
  if (listening || typeof window === 'undefined') return
  listening = true
  const trackMouse = (event: PointerEvent) => {
    // A finger scrolls the map itself; only a mouse rests over it meanwhile.
    mouse = event.pointerType === 'mouse' ? { x: event.clientX, y: event.clientY } : null
  }
  window.addEventListener('pointermove', trackMouse, { capture: true, passive: true })
  window.addEventListener('pointerdown', trackMouse, { capture: true, passive: true })
  document.documentElement.addEventListener('pointerleave', () => { mouse = null })
  window.addEventListener('scroll', () => {
    if (targets.size === 0 || pendingFrame) return
    pendingFrame = window.requestAnimationFrame(syncTooltipsToMouse)
  }, { capture: true, passive: true })
}

function positionFor(element: Element, byFocus: boolean): TooltipPosition {
  const bounds = element.getBoundingClientRect()
  const edgePadding = 12
  const halfWidth = Math.min(176, (window.innerWidth - 2 * edgePadding) / 2)
  const left = Math.max(edgePadding + halfWidth,
    Math.min(window.innerWidth - edgePadding - halfWidth, bounds.left + bounds.width / 2))
  const below = bounds.top < 72
  return { left, top: below ? bounds.bottom + 10 : bounds.top - 10, below, byFocus }
}

const samePosition = (a: TooltipPosition | null, b: TooltipPosition) =>
  a !== null && a.left === b.left && a.top === b.top && a.below === b.below && a.byFocus === b.byFocus

/** Render SVG level names in a document-level portal so they are not clipped. */
export function useMapLevelTooltip(label: string) {
  const id = React.useMemo(() => `map-level-tooltip-${++nextTooltipId}`, [])
  const [position, setPosition] = React.useState<TooltipPosition | null>(null)
  const place = React.useCallback((element: Element, byFocus: boolean) => {
    const next = positionFor(element, byFocus)
    setPosition(previous => samePosition(previous, next) ? previous : next)
  }, [])
  const show = React.useCallback((event: React.SyntheticEvent<Element>) => {
    place(event.currentTarget, event.type === 'focus')
  }, [place])
  const hide = React.useCallback(() => setPosition(null), [])
  const elementRef = React.useRef<Element | null>(null)
  const register = React.useCallback((element: Element | null) => {
    if (elementRef.current) targets.delete(elementRef.current)
    elementRef.current = element
    if (!element) return
    listenForScrolls()
    targets.set(element, {
      show: target => setPosition(previous => {
        const next = positionFor(target, previous?.byFocus ?? false)
        return samePosition(previous, next) ? previous : next
      }),
      leave: target => setPosition(previous => {
        if (!previous?.byFocus) return null
        const next = positionFor(target, true)
        return samePosition(previous, next) ? previous : next
      }),
    })
  }, [])
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
      ref: register,
      'aria-describedby': position ? id : undefined,
      onPointerEnter: show,
      onPointerLeave: hide,
      onFocus: show,
      onBlur: hide,
    },
  }
}
