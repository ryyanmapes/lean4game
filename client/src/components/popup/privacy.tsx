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
        Our server collects metadata (such as IP address, browser, operating system)
        and the data that the user enters into the editor. The data is used to
        compute the Lean output and display it to the user. The information will be stored
        as long as the user stays on our website and will be deleted immediately afterwards.
        We keep logs to improve our software, but the contained data is anonymized.
      </p>
      <p>
        We do not use cookies, but your game progress is stored in the browser
        as site data. Your game progress is not saved on the server; if you delete
        your browser storage, it is completely gone.
      </p>
      <p>
        <strong>Anonymous usage statistics.</strong> If you accept the
        statistics banner shown on the landing page, the site stores a random
        identifier (UUID) in your browser and sends a small event to the server
        when you start or successfully complete a level. Each level attempt
        also gets its own random solving UUID. While you solve a visual level,
        the site sends proof-step events containing the new Interactive Lean
        line, or the word "undo" when you undo. Completion events include the
        proof you constructed (both the visual play script and the resulting
        Lean tactic script). No IP address, browser, name, email, or other
        personal data is associated with these events. Refusing the banner
        disables collection entirely; clearing your browser storage also
        resets the identifier.
      </p>
      <p>Our server is located in Germany.</p>
      <p>
        <strong>Contact:</strong><br />
        Marcus Zibrowius<br />
        Mathematisches Institut der Heinrich-Heine-Universität Düsseldorf<br />
        Universitätsstr. 1<br />
        40225 Düsseldorf<br />
        Germany<br />
        +49 211 81 13858<br />
        <a href="https://www.math.uni-duesseldorf.de/~zibrowius/" target="_blank">Contact Details</a><br />
        <a href="mailto:matvey.lorkish@hhu.de?subject=Lean4Game: <Your%20Question>">Technical Contact</a>
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
