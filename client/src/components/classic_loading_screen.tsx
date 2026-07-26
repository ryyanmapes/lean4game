import * as React from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHome, faSun } from '@fortawesome/free-solid-svg-icons'
import { useNavigate } from 'react-router-dom'

import { GameIdContext } from '../app'
import { PreferencesContext } from './infoview/context'
import { HopLoadingIndicator } from '../visual/VisualLoadingScreen'

import '../css/classic-loading.css'

export function ClassicLoadingScreen({
  worldTitle,
  levelTitle,
  message = 'Connecting to Lean…',
  showChrome,
}: {
  worldTitle?: string | null
  levelTitle?: string | null
  message?: string
  showChrome?: boolean
}) {
  const navigate = useNavigate()
  const gameId = React.useContext(GameIdContext)
  const { isVisualLightMode, setIsVisualLightMode } = React.useContext(PreferencesContext)
  const [delayElapsed, setDelayElapsed] = React.useState(false)

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDelayElapsed(true), 200)
    return () => window.clearTimeout(timer)
  }, [])

  const chromeVisible = showChrome ?? delayElapsed
  const themeLabel = isVisualLightMode ? 'Switch to dark mode' : 'Switch to light mode'

  return (
    <div className="classic-loading-page" aria-busy="true">
      <div className="app-bar classic-loading-app-bar">
        <div className="app-bar-left">
          <button className="btn btn-inverted" type="button"
            title="Home" aria-label="Home" onClick={() => navigate(`/${gameId}`)}>
            <FontAwesomeIcon icon={faHome} />
          </button>
          <span className="app-bar-title">{worldTitle ?? ''}</span>
        </div>
        <span className="app-bar-title classic-loading-title">
          {levelTitle ?? 'The Natural Numbers Game'}
        </span>
        <div className="nav-btns">
          <button
            type="button"
            className={`btn btn-inverted theme-mode-btn${isVisualLightMode ? ' active' : ''}`}
            title={themeLabel}
            aria-label={themeLabel}
            aria-pressed={isVisualLightMode}
            onClick={() => setIsVisualLightMode(!isVisualLightMode)}>
            <FontAwesomeIcon icon={faSun} />
          </button>
        </div>
      </div>
      <div className={`classic-loading-content${chromeVisible ? ' visible' : ''}`}>
        {chromeVisible && <HopLoadingIndicator message={message} />}
      </div>
    </div>
  )
}
