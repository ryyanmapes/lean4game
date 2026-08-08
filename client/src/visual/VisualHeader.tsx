import * as React from 'react'

// Always lowercase regardless of position (tactic names, etc.)
const ALWAYS_LOWERCASE = new Set(['rfl', 'rw'])
// Lowercase in the middle of a title, but capitalize as first word
const SMALL_WORDS = new Set(['of', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'with', 'and', 'but', 'or', 'nor'])

export function titleCaseLevel(title: string): string {
  let capitalizeNext = true

  return title.split(' ').map((word) => {
    const lower = word.toLowerCase()
    const alpha = lower.replace(/[^a-z]/g, '')
    const startsQuotedIdentifier =
      word.startsWith('`') ||
      word.startsWith("'") ||
      word.startsWith('"')
    const endsSegment = /[:.!?]$/.test(word)
    let formatted: string

    // Identifiers with underscores stay as-is
    if (word.includes('_') || startsQuotedIdentifier) {
      formatted = word
    } else if (ALWAYS_LOWERCASE.has(alpha)) {
      formatted = lower
    } else if (!capitalizeNext && SMALL_WORDS.has(alpha)) {
      formatted = lower
    } else {
      // Capitalize first alphabetic character (handles leading punctuation like '(')
      formatted = lower.replace(/[a-z]/, c => c.toUpperCase())
    }

    if (alpha.length > 0) capitalizeNext = false
    if (endsSegment) capitalizeNext = true

    return formatted
  }).join(' ')
}

interface VisualHeaderProps {
  worldId?: string
  worldTitle?: string
  levelId: number
  displayLevelId?: number
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
  displayLevelId,
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
  const shownLevelId = displayLevelId ?? levelId
  const formattedTitle = levelTitle ? titleCaseLevel(levelTitle) : ''
  const levelLabel = (worldTitle ?? worldId)
    ? `${worldTitle ?? worldId} - ${shownLevelId}`
    : `Level ${shownLevelId}`
  const splitLongTitle = Boolean(formattedTitle && `${levelLabel}: ${formattedTitle}`.length > 28)

  return (
    <div className={`visual-header${isCompleted ? ' completed' : ''}`}>
      <div className="visual-header-side">
        {!hideNav && (
          <button
            className={`visual-header-nav-btn visual-header-map-btn${emphasizeMap ? ' emphasized' : ''}`}
            onClick={onWorldMap}
          >
            ← Back to map
          </button>
        )}
      </div>
      <div className={`visual-header-center${splitLongTitle ? ' split-title' : ''}`}>
        {previouslyCompleted && <span className="visual-header-check">✓</span>}
        <span className="visual-header-level">
          {levelLabel}
        </span>
        {levelTitle && (
          <>
            <span className="visual-header-separator">:</span>
            <span className="visual-header-title">{formattedTitle}</span>
          </>
        )}
      </div>
      <div className="visual-header-side right">
        {!hideNav && (
          <button className="visual-header-nav-btn visual-header-prev-btn" onClick={onPrev} disabled={!hasPrev} aria-label={hasPrev ? 'Previous level' : 'No previous level'}>
            {hasPrev ? '← Previous level' : null}
          </button>
        )}
        {!hideNav && (
          <button
            className={`visual-header-nav-btn visual-header-next-btn${isCompleted ? ' emphasized' : ''}`}
            onClick={onNext}
            disabled={!hasNext}
            aria-label={hasNext ? 'Next level' : 'No next level'}
          >
            {hasNext ? 'Next level →' : null}
          </button>
        )}
      </div>
    </div>
  )
}
