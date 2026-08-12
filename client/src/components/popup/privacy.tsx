import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next';

/** Pop-up that is displayed when opening the privacy policy. */
export function PrivacyPolicyPopup () {
  let {t, i18n} = useTranslation()
  function content (lng = i18n.language) {
    const tt = i18n.getFixedT(lng);
    return <Trans t={tt} >
      <h2>Privacy Policy</h2>
      <p>
        Lean runs locally in your browser. Proofs are not sent to a server for
        validation.
      </p>
      <p>
        Your game progress is stored in the browser as site data. If you accept
        anonymous usage statistics, one first-party cookie stores a random UUID.
      </p>
      <p>
        <strong>Anonymous usage statistics.</strong> If you accept the
        permission prompt shown before a level loads, the site stores a random
        identifier (UUID) in a cookie and sends events when you start or finish
        a level. Each attempt has a separate random UUID. Ordered proof actions
        are collected in both Visual and classic mode; completion events include
        the final proof scripts. The collector does not store names, email
        addresses, IP addresses, or browser identifiers. Refusing disables
        collection and deletes the telemetry UUID and queued events.
      </p>
      <p>
        <strong>Feedback reports.</strong> If you choose to submit the in-level
        feedback form, the message, current level, mode, and current proof state
        are sent to the collector. If anonymous usage statistics are enabled,
        the report also includes your random telemetry UUID; otherwise it is
        stored without a user identifier.
      </p>
    </Trans>
  }

  return <>
    {i18n.language != 'en' && <>
      <p><i>(English version below)</i></p>
      {content()}
      <hr />
    </>}
    {content('en')}
  </>
}
