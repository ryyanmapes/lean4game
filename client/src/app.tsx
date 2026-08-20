import * as React from 'react';
import { Outlet, useParams } from "react-router-dom";

import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

import './css/reset.css';
import './css/app.css';
import { PreferencesContext, WorldLevelIdContext} from './components/infoview/context';
import UsePreferences from "./state/hooks/use_preferences"
import i18n from './i18n';
import { Popup } from './components/popup/popup';
import { VisualRpcProvider } from './visual/VisualRpcProvider'

export const GameIdContext = React.createContext<string>(undefined);

function App() {

  const params = useParams()
  const gameId = "g/" + params.owner + "/" + params.repo
  const levelId = parseInt(params.levelId)
  const worldId = params.worldId

  const {
    mobile,
    layout,
    isSavePreferences,
    language,
    isSuggestionsMobileMode,
    isVisualLightMode,
    isVisualAutoBranchSwitching,
    isVisualFastExfalso,
    setLayout,
    setIsSavePreferences,
    setLanguage,
    setIsSuggestionsMobileMode,
    setIsVisualLightMode,
    setIsVisualAutoBranchSwitching,
    setIsVisualFastExfalso,
  } = UsePreferences()

  React.useEffect(() => {
    i18n.changeLanguage(language)
  }, [language])

  React.useEffect(() => {
    const background = isVisualLightMode ? '#f8fafc' : '#0f172a'
    const scheme = isVisualLightMode ? 'light' : 'dark'
    document.documentElement.style.backgroundColor = background
    document.documentElement.style.colorScheme = scheme
    document.body.style.backgroundColor = background
    let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!theme) {
      theme = document.createElement('meta')
      theme.name = 'theme-color'
      document.head.appendChild(theme)
    }
    theme.content = background
    let colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    if (!colorScheme) {
      colorScheme = document.createElement('meta')
      colorScheme.name = 'color-scheme'
      document.head.appendChild(colorScheme)
    }
    colorScheme.content = scheme
  }, [isVisualLightMode])

  return (
    <div className="app" data-visual-theme={isVisualLightMode ? 'light' : 'dark'} data-game-id={gameId}>
      <GameIdContext.Provider value={gameId}>
          <WorldLevelIdContext.Provider value={{worldId, levelId}}>
          <PreferencesContext.Provider value={{
            mobile,
            layout,
            isSavePreferences,
            language,
            isSuggestionsMobileMode,
            isVisualLightMode,
            isVisualAutoBranchSwitching,
            isVisualFastExfalso,
            setLayout,
            setIsSavePreferences,
            setLanguage,
            setIsSuggestionsMobileMode,
            setIsVisualLightMode,
            setIsVisualAutoBranchSwitching,
            setIsVisualFastExfalso,
          }}>
            <VisualRpcProvider>
              <React.Suspense>
                <Outlet />
              </React.Suspense>
              <Popup />
            </VisualRpcProvider>
          </PreferencesContext.Provider>
          </WorldLevelIdContext.Provider>
      </GameIdContext.Provider>
    </div>
  )
}

export default App
