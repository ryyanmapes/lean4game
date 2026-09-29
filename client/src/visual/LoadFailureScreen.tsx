import * as React from 'react'

import { FeedbackReportButton } from '../components/feedback_report'
import type { TelemetryMode } from '../utils/telemetry'
import { unloadedFeedbackState } from './loadDiagnostics'
import type { LoadFailure } from './loadFailure'
import './visual.css'

/** Shown in place of the level when Lean could not start; used by both modes. */
export function LoadFailureScreen({ failure, phonePortrait = false, feedback }: {
  failure: LoadFailure
  phonePortrait?: boolean
  /** Where a feedback report sent from this screen should be filed. */
  feedback?: { gameId: string; worldId: string; levelId: number; mode: TelemetryMode }
}) {
  return (
    <div
      className={`visual-page visual-load-failure${phonePortrait ? ' phone-portrait' : ''}`}
      role="alert"
      data-testid="load-failure"
      data-failure-case={failure.caseId}
    >
      <div className="visual-load-failure-card">
        {failure.lines.map((line, index) => (
          <p className="visual-load-failure-text" key={index}>{line}</p>
        ))}
        <div className="visual-load-failure-actions">
          <button type="button" className="visual-load-failure-retry" onClick={() => window.location.reload()}>
            Try again
          </button>
          <a className="visual-load-failure-home" href="/">Back to start</a>
          {feedback && <FeedbackReportButton
            {...feedback}
            getProofState={() => unloadedFeedbackState(failure)} />}
        </div>
        <details className="visual-load-failure-details">
          <summary>Technical details</summary>
          <pre>{`${failure.caseId}: ${failure.detail}\n${navigator.userAgent}`}</pre>
        </details>
      </div>
    </div>
  )
}
