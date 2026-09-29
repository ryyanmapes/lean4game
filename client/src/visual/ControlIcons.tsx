/**
 * @fileOverview Icons for the round canvas control buttons.
 *
 * These used to be text glyphs (↩ ⟲ ↕). iOS Safari renders ↩ and ↕ as colour
 * emoji and draws ⟲ from a tiny fallback font, so the buttons looked different
 * on every platform. Inline SVG stroked with `currentColor` renders the same
 * everywhere and keeps the per-button colour from CSS.
 */
import * as React from 'react'

function ControlIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="tr-ctrl-icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Leftwards arrow with hook, like ↩. */
export function UndoIcon() {
  return (
    <ControlIcon>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </ControlIcon>
  )
}

/** Anticlockwise open-circle arrow, like ⟲. */
export function ResetIcon() {
  return (
    <ControlIcon>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M6 2v4h4" />
    </ControlIcon>
  )
}

/** Up-down arrow, like ↕. */
export function ReverseIcon() {
  return (
    <ControlIcon>
      <path d="M12 3v18" />
      <path d="m7 8 5-5 5 5" />
      <path d="m7 16 5 5 5-5" />
    </ControlIcon>
  )
}
