import * as React from 'react'

// Always lowercase regardless of position (tactic names, etc.)
const ALWAYS_LOWERCASE = new Set(['rfl', 'rw'])
// Lowercase in the middle of a title, but capitalize as first word
const SMALL_WORDS = new Set(['of', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'with', 'and', 'but', 'or', 'nor'])

function titleCaseLevel(title: string): string {
  return title.split(' ').map((word, index) => {
    const lower = word.toLowerCase()
    // Identifiers with underscores stay as-is
    if (word.includes('_')) return word
    // Strip surrounding punctuation to get the bare word for lookup
    const alpha = lower.replace(/[^a-z]/g, '')
    if (ALWAYS_LOWERCASE.has(alpha)) return lower
    if (index > 0 && SMALL_WORDS.has(alpha)) return lower
    // Capitalize first alphabetic character (handles leading punctuation like '(')
    return lower.replace(/[a-z]/, c => c.toUpperCase())
  }).join(' ')
}

interface VisualHeaderProps {
  worldId?: string
  worldTitle?: string
  levelId: number
  levelTitle?: string | null
  hasPrev: boolean
  hasNext: boolean
  isCompleted: boolean
  previouslyCompleted: boolean
  onPrev: () => void
  onNext: () => void
  onWorldMap: () => void
  /** When true, suppress all navigation buttons (back to map, prev, next). */
  hideNav?: boolean
}

export function VisualHeader({
  worldId,
  worldTitle,
  levelId,
  levelTitle,
  hasPrev,
  hasNext,
  isCompleted,
  previouslyCompleted,
  onPrev,
  onNext,
  onWorldMap,
  hideNav,
}: VisualHeaderProps) {
  const emphasizeMap = isCompleted && !hasNext

  return (
    <div className={`visual-header${isCompleted ? ' completed' : ''}`}>
      <div className="visual-header-side">
        {!hideNav && (
          <button
            className={`visual-header-nav-btn${emphasizeMap ? ' emphasized' : ''}`}
            onClick={onWorldMap}
          >
            ← Back to map
          </button>
        )}
      </div>
      <div className="visual-header-center">
        {previouslyCompleted && <span className="visual-header-check">✓</span>}
        <span className="visual-header-level">
          {(worldTitle ?? worldId) ? `${worldTitle ?? worldId} - ${levelId}` : `Level ${levelId}`}
        </span>
        {levelTitle && (
          <span className="visual-header-title">: {titleCaseLevel(levelTitle)}</span>
        )}
      </div>
      <div className="visual-header-side right">
        {!hideNav && hasPrev && (
          <button className="visual-header-nav-btn" onClick={onPrev}>
            ← Previous level
          </button>
        )}
        {!hideNav && hasNext && (
          <button
            className={`visual-header-nav-btn${isCompleted ? ' emphasized' : ''}`}
            onClick={onNext}
          >
            Next level →
          </button>
        )}
      </div>
    </div>
  )
}
