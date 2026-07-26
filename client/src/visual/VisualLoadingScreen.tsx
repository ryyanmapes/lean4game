import * as React from 'react'

import { VisualHeader } from './VisualHeader'
import './visual.css'

type VisualLoadingScreenProps = {
  worldId?: string
  worldTitle?: string
  levelId?: number
  displayLevelId?: number
  levelTitle?: string | null
  message?: string
  showChrome?: boolean
  onWorldMap?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  previouslyCompleted?: boolean
  onPrev?: () => void
  onNext?: () => void
  phonePortrait?: boolean
}

export function HopLoadingIndicator({ message }: { message: string }) {
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
    <p className="visual-loading-text">{message}</p>
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
  showChrome,
  onWorldMap,
  hasPrev = false,
  hasNext = false,
  previouslyCompleted = false,
  onPrev = () => {},
  onNext = () => {},
  phonePortrait = false,
}: VisualLoadingScreenProps) {
  const [delayElapsed, setDelayElapsed] = React.useState(false)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDelayElapsed(true), 200)
    return () => window.clearTimeout(timer)
  }, [])
  const chromeVisible = showChrome ?? delayElapsed

  if (!chromeVisible) {
    return <div className={`visual-page visual-loading${phonePortrait ? ' phone-portrait' : ''}`} aria-busy="true" />
  }

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
          isCompleted={false}
          previouslyCompleted={previouslyCompleted}
          onPrev={onPrev}
          onNext={onNext}
          onWorldMap={onWorldMap ?? (() => {})}
          hideNav={!onWorldMap}
        />
      )}
      <HopLoadingIndicator message={message} />
    </div>
  )
}
