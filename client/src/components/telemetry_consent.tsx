import * as React from 'react'
import { getConsentState, setConsent, type ConsentState } from '../utils/telemetry'

export type TelemetryConsentGate = {
  consentState: ConsentState
  visible: boolean
  shouldHold: boolean
  accept: () => void
  refuse: () => void
  postpone: () => void
}

/** Closing the question suppresses it for this loading screen only. */
export function useTelemetryConsentGate(screenKey: string): TelemetryConsentGate {
  const [consentState, setConsentState] = React.useState<ConsentState>(getConsentState)
  const [postponedFor, setPostponedFor] = React.useState<string | null>(null)

  const decide = React.useCallback((accepted: boolean) => {
    setConsent(accepted)
    setConsentState(accepted ? 'accepted' : 'refused')
  }, [])

  const visible = consentState === 'undecided' && postponedFor !== screenKey
  return {
    consentState,
    visible,
    shouldHold: visible,
    accept: () => decide(true),
    refuse: () => decide(false),
    postpone: () => setPostponedFor(screenKey),
  }
}

export function TelemetryConsent({ gate }: { gate: TelemetryConsentGate }) {
  if (!gate.visible) return null

  return (
    <div
      className="telemetry-consent-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Anonymous telemetry permission"
    >
      <button
        type="button"
        className="telemetry-consent-close"
        aria-label="Ask about telemetry later"
        title="Ask later"
        onClick={gate.postpone}
      >×</button>
      <p className="telemetry-consent-text">
        Visual Lean is an experimental prototype; we are still trying to figure out what works and what doesn't. Anonymous telemetry helps us improve the program for future users.
      </p>
      <div className="telemetry-consent-buttons">
        <button
          type="button"
          className="telemetry-consent-button telemetry-consent-refuse"
          onClick={gate.refuse}
        >Refuse</button>
        <button
          type="button"
          className="telemetry-consent-button telemetry-consent-accept"
          onClick={gate.accept}
        >Accept</button>
      </div>
    </div>
  )
}
