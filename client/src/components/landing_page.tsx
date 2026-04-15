import * as React from 'react'

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import '../css/landing_page.css'

import { ImpressumButton, MenuButton, PreferencesButton, PrivacyButton } from './app_bar'
import { popupAtom, PopupType } from '../store/popup-atoms'
import { useAtom } from 'jotai'
import { GithubIcon } from './navigation/github_icon'
import { navOpenAtom } from '../store/navigation-atoms'
import { getDataBaseUrl } from '../utils/url'

type FeaturedVisualGame = {
  label: string
  candidateGameIds: string[]
}

const FEATURED_VISUAL_GAMES: FeaturedVisualGame[] = [
  {
    label: 'Natural Numbers Game',
    candidateGameIds: ['g/local/nng4', 'g/leanprover-community/nng4'],
  },
  {
    label: 'Real Numbers Game',
    candidateGameIds: ['g/local/rng', 'g/alexkontorovich/realanalysisgame'],
  },
  {
    label: 'Visual Test',
    candidateGameIds: ['g/local/visualtest', 'g/ryyanmapes/visualtest'],
  },
]

function LandingPage() {
  const [, setPopup] = useAtom(popupAtom)
  const [navOpen] = useAtom(navOpenAtom)
  const [visualRoutes, setVisualRoutes] = React.useState<Record<string, string>>({})

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

  React.useEffect(() => {
    const controller = new AbortController()
    const dataBaseUrl = getDataBaseUrl()

    async function resolveGameRoute(candidateGameIds: string[]) {
      for (const gameId of candidateGameIds) {
        try {
          const response = await fetch(`${dataBaseUrl}${gameId}/game.json`, {
            method: 'GET',
            signal: controller.signal,
          })
          if (response.ok) {
            return `/${gameId}/visual`
          }
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            return null
          }
        }
      }

      return null
    }

    void Promise.all(
      FEATURED_VISUAL_GAMES.map(async ({ label, candidateGameIds }) => {
        const route = await resolveGameRoute(candidateGameIds)
        return [label, route] as const
      }),
    ).then((resolvedRoutes) => {
      if (controller.signal.aborted) {
        return
      }

      setVisualRoutes(
        Object.fromEntries(
          resolvedRoutes.filter((entry): entry is [string, string] => entry[1] !== null),
        ),
      )
    })

    return () => controller.abort()
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
          <h1 className="lp-title">{t('Caption.translation', { defaultValue: 'Lean Game Server' })}</h1>
          <p className="lp-subtitle">
            Interactive proof games for{' '}
            <a href="https://leanprover-community.github.io/" target="_blank" rel="noreferrer">Lean 4</a>
          </p>
        </div>
      </header>

      <section className="lp-visual-section">
        <h2 className="lp-section-title">Visual Proof Mode</h2>
        <p className="lp-section-desc">An experimental drag-and-drop interface for working in Lean.</p>
        <div className="lp-visual-links">
          {FEATURED_VISUAL_GAMES.map(({ label }) => {
            const route = visualRoutes[label]
            if (!route) return null

            return (
              <Link key={label} to={route} className="lp-visual-btn">
                {label}
              </Link>
            )
          })}
        </div>
      </section>

      <footer className="lp-footer">
        <a className="link" onClick={() => setPopup(PopupType.impressum)}>Impressum</a>
        <a className="link" onClick={() => setPopup(PopupType.privacy)}>{t('Privacy Policy')}</a>
      </footer>
    </div>
  )
}

export default LandingPage
