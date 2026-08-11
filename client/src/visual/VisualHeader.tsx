import * as React from 'react'
import { AnnotatedLevelTitle, plainLevelTitle } from '../components/annotated_level_title'

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
  const plainTitle = levelTitle ? plainLevelTitle(levelTitle) : ''
  const levelLabel = (worldTitle ?? worldId)
    ? `${worldTitle ?? worldId} - ${shownLevelId}`
    : `Level ${shownLevelId}`
  const splitLongTitle = Boolean(plainTitle && `${levelLabel}: ${plainTitle}`.length > 28)

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
            <span className="visual-header-title"><AnnotatedLevelTitle title={levelTitle} /></span>
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
