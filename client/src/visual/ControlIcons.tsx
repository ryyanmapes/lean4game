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

/** "⇐ / ⇒", with the rewrite direction in use emphasised. Forward rewrites
 * turn an equation's left side into its right (⇒), as the rule cards print
 * it; reverse goes the other way (⇐). */
export function RewriteDirectionIcon({ reverse }: { reverse: boolean }) {
  return (
    <svg
      className="tr-ctrl-icon tr-direction-icon"
      viewBox="0 0 60 24"
      width="2.5em"
      height="1em"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g className={`tr-direction-arrow${reverse ? ' current' : ''}`}>
        <path d="M9 5 2 12l7 7" />
        <path d="M5 9h15M5 15h15" />
      </g>
      <path className="tr-direction-slash" d="M32.5 3 27.5 21" />
      <g className={`tr-direction-arrow${reverse ? '' : ' current'}`}>
        <path d="m51 5 7 7-7 7" />
        <path d="M40 9h15M40 15h15" />
      </g>
    </svg>
  )
}
