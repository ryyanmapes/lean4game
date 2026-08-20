import * as React from 'react'
import { AnnotatedLevelTitle, plainLevelTitle } from '../components/annotated_level_title'
import { FeedbackReportButton } from '../components/feedback_report'

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
  gameId?: string
  getFeedbackProofState?: () => unknown
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
  gameId,
  getFeedbackProofState,
  hideNav,
}: VisualHeaderProps) {
  // A level the player already finished opens green, with no replay of the
  // completion flourish. `previouslyCompleted` alone cannot say that: solving
  // the level marks it completed straight away, so remember the value this
  // level was entered with and refresh it only when the level changes.
  const entryKey = `${worldId ?? ''}/${levelId}`
  const entryRef = React.useRef<{ key: string; completed: boolean } | null>(null)
  if (entryRef.current?.key !== entryKey) {
    entryRef.current = { key: entryKey, completed: previouslyCompleted }
  }
  const completedOnEntry = entryRef.current.completed
  const emphasizeMap = isCompleted && !hasNext
  const shownLevelId = displayLevelId ?? levelId
  const plainTitle = levelTitle ? plainLevelTitle(levelTitle) : ''
  const levelLabel = (worldTitle ?? worldId)
    ? `${worldTitle ?? worldId} - ${shownLevelId}`
    : `Level ${shownLevelId}`
  const splitLongTitle = Boolean(plainTitle && `${levelLabel}: ${plainTitle}`.length > 28)

  return (
    <div className={`visual-header${isCompleted || completedOnEntry ? ' completed' : ''}${completedOnEntry ? ' precompleted' : ''}`}>
      <div className="visual-header-side">
        {!hideNav && <>
          <button
            className={`visual-header-nav-btn visual-header-map-btn${emphasizeMap ? ' emphasized' : ''}`}
            onClick={onWorldMap}
          >
            ← Back to map
          </button>
          {gameId && getFeedbackProofState && <FeedbackReportButton
            gameId={gameId} worldId={worldId ?? ''} levelId={levelId}
            mode="visual" getProofState={getFeedbackProofState} />}
        </>}
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
            ← Previous level
          </button>
        )}
        {!hideNav && (
          <button
            className={`visual-header-nav-btn visual-header-next-btn${isCompleted ? ' emphasized' : ''}`}
            onClick={onNext}
            disabled={!hasNext}
            aria-label={hasNext ? 'Next level' : 'No next level'}
          >
            Next level →
          </button>
        )}
      </div>
    </div>
  )
}
