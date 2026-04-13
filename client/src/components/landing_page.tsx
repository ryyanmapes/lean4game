import * as React from 'react';

import { Link } from "react-router-dom";
import { useTranslation } from 'react-i18next';

import '../css/landing_page.css'

import { ImpressumButton, MenuButton, PreferencesButton, PrivacyButton } from './app_bar';
import { popupAtom, PopupType } from '../store/popup-atoms';
import { useAtom } from 'jotai';
import { GithubIcon } from './navigation/github_icon';
import { navOpenAtom } from '../store/navigation-atoms';


function LandingPage() {
  const [, setPopup] = useAtom(popupAtom)
  const [navOpen, setNavOpen] = useAtom(navOpenAtom)

  const { t } = useTranslation()

  React.useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const gradient = 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)'
    const prevHtmlBackground = html.style.background
    const prevBodyBackground = body.style.background
    const prevHtmlBackgroundColor = html.style.backgroundColor
    const prevBodyBackgroundColor = body.style.backgroundColor
    const prevBodyOverscrollBehaviorY = body.style.overscrollBehaviorY

    html.style.background = gradient
    body.style.background = gradient
    html.style.backgroundColor = '#0f172a'
    body.style.backgroundColor = '#0f172a'
    body.style.overscrollBehaviorY = 'none'

    return () => {
      html.style.background = prevHtmlBackground
      body.style.background = prevBodyBackground
      html.style.backgroundColor = prevHtmlBackgroundColor
      body.style.backgroundColor = prevBodyBackgroundColor
      body.style.overscrollBehaviorY = prevBodyOverscrollBehaviorY
    }
  }, [])

  return (
    <div className="landing-page landing-page-dark">
      <header className="lp-header">
        <nav className="landing-page-nav">
          <GithubIcon url="https://github.com/leanprover-community/lean4game"/>
          <MenuButton />
          <div className={'menu dropdown' + (navOpen ? '' : ' hidden')}>
            <ImpressumButton isDropdown={true} />
            <PrivacyButton isDropdown={true} />
            <PreferencesButton />
          </div>
        </nav>
        <div className="lp-title-area">
          <h1 className="lp-title">{t("Caption.translation", { defaultValue: "Lean Game Server"})}</h1>
          <p className="lp-subtitle">
            Interactive proof games for{' '}
            <a href="https://leanprover-community.github.io/" target="_blank" rel="noreferrer">Lean 4</a>
          </p>
        </div>
      </header>

      {/* Visual Mode feature section */}
      <section className="lp-visual-section">
        <h2 className="lp-section-title">Visual Proof Mode</h2>
        <p className="lp-section-desc">An experimental drag-and-drop interface for working in Lean.</p>
        <div className="lp-visual-links">
          <Link to="/g/leanprover-community/nng4/visual" className="lp-visual-btn">
            Natural Numbers Game
          </Link>
          <Link to="/g/leanprover-community/VisualTest/visual" className="lp-visual-btn">
            Visual Test
          </Link>
        </div>
      </section>

      <footer className="lp-footer">
        <a className="link" onClick={() => setPopup(PopupType.impressum)}>Impressum</a>
        <a className="link" onClick={() => setPopup(PopupType.privacy)}>{t("Privacy Policy")}</a>
      </footer>
    </div>
  )
}

export default LandingPage
