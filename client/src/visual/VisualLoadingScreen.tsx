import * as React from 'react'

import { TelemetryConsent, type TelemetryConsentGate } from '../components/telemetry_consent'
import { VisualHeader } from './VisualHeader'
import './visual.css'

type VisualLoadingScreenProps = {
  worldId?: string
  worldTitle?: string
  levelId?: number
  displayLevelId?: number | string
  levelTitle?: string | null
  message?: string
  progress?: number | null
  showChrome?: boolean
  onWorldMap?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  nextLocked?: boolean
  previouslyCompleted?: boolean
  onPrev?: () => void
  onNext?: () => void
  phonePortrait?: boolean
  telemetryConsent?: TelemetryConsentGate
  /** Enables the header's feedback (!) button while the level loads. */
  gameId?: string
  getFeedbackProofState?: () => unknown
  /** See VisualHeader. */
  titlePending?: boolean
}

export function HopLoadingIndicator({
  message,
  progress = 0,
}: {
  message: string
  progress?: number | null
}) {
  const displayedProgress = Math.max(0, Math.min(100, progress ?? 0))
  return <>
    <div className="visual-loading-anim">
      <div className="hop-mask">
        <div className="hop-dots" />
      </div>
      <div className="hop-left-cover" />
      <div className="hop-ball-wrapper">
        <div className="hop-ball" />
      </div>
    </div>
    <div className="visual-loading-progress-region">
      <p className="visual-loading-text">{message}</p>
      <div
        className="visual-loading-progress"
        role="progressbar"
        aria-label={message}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayedProgress)}
      >
        <div
          className="visual-loading-progress-fill"
          style={{ width: `${displayedProgress}%` }}
        />
      </div>
    </div>
  </>
}

/** The shared loading chrome used by both visual and classic play. */
export function VisualLoadingScreen({
  worldId,
  worldTitle,
  levelId,
  displayLevelId,
  levelTitle,
  message = 'Connecting to Lean…',
  progress = null,
  showChrome,
  onWorldMap,
  hasPrev = false,
  hasNext = false,
  nextLocked = false,
  previouslyCompleted = false,
  onPrev = () => {},
  onNext = () => {},
  phonePortrait = false,
  telemetryConsent,
  gameId,
  getFeedbackProofState,
  titlePending = false,
}: VisualLoadingScreenProps) {
  const [delayElapsed, setDelayElapsed] = React.useState(false)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDelayElapsed(true), 200)
    return () => window.clearTimeout(timer)
  }, [])
  // Only the animation waits, so a quick load doesn't flash it. The header is on every
  // page of a level, so hiding it here would make it blink on each level change.
  const animationVisible = showChrome ?? delayElapsed

  return (
    <div className={`visual-page visual-loading${phonePortrait ? ' phone-portrait' : ''}`} aria-busy="true">
      {levelId != null && (
        <VisualHeader
          worldId={worldId}
          worldTitle={worldTitle}
          levelId={levelId}
          displayLevelId={displayLevelId}
          levelTitle={levelTitle}
          hasPrev={hasPrev}
          hasNext={hasNext}
          nextLocked={nextLocked}
          isCompleted={false}
          previouslyCompleted={previouslyCompleted}
          onPrev={onPrev}
          onNext={onNext}
          onWorldMap={onWorldMap ?? (() => {})}
          hideNav={!onWorldMap}
          gameId={gameId}
          getFeedbackProofState={getFeedbackProofState}
          titlePending={titlePending}
        />
      )}
      {animationVisible && <HopLoadingIndicator message={message} progress={progress} />}
      {telemetryConsent && <TelemetryConsent gate={telemetryConsent} />}
    </div>
  )
}
