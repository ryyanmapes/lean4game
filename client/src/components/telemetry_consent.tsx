import * as React from 'react'
import { useAtom } from 'jotai'
import { getConsentState, setConsent } from '../utils/telemetry'
import { popupAtom, PopupType } from '../store/popup-atoms'

export function TelemetryConsent() {
  const [visible, setVisible] = React.useState(() => getConsentState() === 'undecided')
  const [, setPopup] = useAtom(popupAtom)

  if (!visible) return null

  const decide = (accepted: boolean) => {
    setConsent(accepted)
    setVisible(false)
  }

  return (
    <div className="telemetry-banner" role="dialog" aria-label="Anonymous usage statistics">
      <p className="telemetry-banner-text">
        Help us improve the games by sharing anonymous usage statistics (level
        starts, completions, and the proofs you build). No personal data is
        collected. See our{' '}
        <a
          className="telemetry-banner-link"
          onClick={(e) => { e.preventDefault(); setPopup(PopupType.privacy) }}
          href="#"
        >Privacy Policy</a>.
      </p>
      <div className="telemetry-banner-buttons">
        <button
          type="button"
          className="telemetry-banner-btn telemetry-banner-btn-refuse"
          onClick={() => decide(false)}
        >Refuse</button>
        <button
          type="button"
          className="telemetry-banner-btn telemetry-banner-btn-accept"
          onClick={() => decide(true)}
        >Accept</button>
      </div>
    </div>
  )
}
