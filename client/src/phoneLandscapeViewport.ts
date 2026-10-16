// A phone in landscape is only about 390 CSS px tall, which squashes the
// desktop layout. Scale the whole page down through the viewport meta tag
// instead, so it lays out like a short desktop window and the browser shrinks
// it to fit. Unlike CSS zoom, this keeps pointer coordinates and CSS px in the
// same space, which dragging relies on.

/** Layout height, in CSS px, that a phone in landscape is scaled to. */
const PHONE_LANDSCAPE_LAYOUT_HEIGHT = 640
/** Touch screens whose short side is at most this are phones, not tablets. */
const PHONE_MAX_SHORT_SIDE = 500

function isLandscape(): boolean {
  const type = screen.orientation?.type
  return type ? type.startsWith('landscape') : window.matchMedia('(orientation: landscape)').matches
}

/** 1 except on a phone in landscape. Uses the screen, not the window, so
 *  browser bars showing and hiding never rescale the page. */
function phoneLandscapeScale(): number {
  if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return 1
  const shortSide = Math.min(screen.width, screen.height)
  if (shortSide > PHONE_MAX_SHORT_SIDE || !isLandscape()) return 1
  return Math.min(1, Math.round(shortSide / PHONE_LANDSCAPE_LAYOUT_HEIGHT * 100) / 100)
}

export function installPhoneLandscapeViewport() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  const defaultContent = meta.content
  const update = () => {
    const scale = phoneLandscapeScale()
    const content = scale < 1
      ? `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, viewport-fit=cover`
      : defaultContent
    if (meta.content !== content) meta.content = content
  }
  update()
  screen.orientation?.addEventListener('change', update)
  window.matchMedia('(orientation: landscape)').addEventListener('change', update)
}
