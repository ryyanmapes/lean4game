/**
 * How much a large window scales the visual interface: the scale `visual.css`
 * gives its root font, for the parts sized in pixels by code. Up to 1440x810
 * nothing changes, so phones and small windows always get 1.
 */
export function visualInterfaceScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(2, Math.max(1, Math.min(viewportWidth / 1440, viewportHeight / 810)))
}

export function currentVisualInterfaceScale(): number {
  return typeof window === 'undefined' ? 1 : visualInterfaceScale(window.innerWidth, window.innerHeight)
}
