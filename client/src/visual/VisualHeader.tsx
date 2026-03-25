import * as React from 'react'

interface VisualHeaderProps {
  levelId: number
  levelTitle?: string | null
  hasPrev: boolean
  hasNext: boolean
  isCompleted: boolean
  previouslyCompleted: boolean
  onPrev: () => void
  onNext: () => void
  onWorldMap: () => void
}

export function VisualHeader({
  levelId,
  levelTitle,
  hasPrev,
  hasNext,
  isCompleted,
  previouslyCompleted,
  onPrev,
  onNext,
  onWorldMap,
}: VisualHeaderProps) {
  const emphasizeMap = isCompleted && !hasNext

  return (
    <div className={`visual-header${isCompleted ? ' completed' : ''}`}>
      <div className="visual-header-side">
        <button
          className={`visual-header-nav-btn${emphasizeMap ? ' emphasized' : ''}`}
          onClick={onWorldMap}
        >
          ← Back to map
        </button>
      </div>
      <div className="visual-header-center">
        {previouslyCompleted && <span className="visual-header-check">✓</span>}
        <span className="visual-header-level">Level {levelId}</span>
        {levelTitle && <span className="visual-header-title">: {levelTitle}</span>}
      </div>
      <div className="visual-header-side right">
        {hasPrev && (
          <button className="visual-header-nav-btn" onClick={onPrev}>
            ← Previous level
          </button>
        )}
        {hasNext && (
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
