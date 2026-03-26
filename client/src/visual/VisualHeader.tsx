import * as React from 'react'

function titleCaseLevel(title: string): string {
  return title.split(' ').map(word =>
    word.includes('_') ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ')
}

interface VisualHeaderProps {
  worldId?: string
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
          {worldId ? `${worldId} - ${levelId}` : `Level ${levelId}`}
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
