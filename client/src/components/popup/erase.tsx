/**
 * @fileOverview
*/
import * as React from 'react'
import { GameIdContext } from '../../app'
import { useAppDispatch } from '../../hooks'
import { deleteProgress } from '../../state/progress'
import { clearGameVisualProgress } from '../../state/gameProgressStorage'
import { exportGameVisualProgress } from '../../state/gameProgressStorage'
import { downloadFile } from '../world_tree'
import { Trans, useTranslation } from 'react-i18next'
import { useContext } from 'react'
import { useAtom } from 'jotai'
import { popupAtom } from '../../store/popup-atoms'

/** download the current progress (i.e. what's saved in the browser store) */
export function downloadProgress(gameId: string, gameProgress: any, ev: React.MouseEvent) {
  ev.preventDefault()
  const progress = gameProgress ?? {
    inventory: [],
    difficulty: 2,
    readIntro: false,
    data: {},
    unlockLevels: false,
  }
  const bundle = {
    version: 2,
    gameId,
    progress,
    visualStorage: exportGameVisualProgress(gameId),
  }
  downloadFile({
    data: JSON.stringify(bundle, null, 2),
    fileName: `lean4game-${gameId.replace(/[^a-z0-9_-]+/giu, '-')}-${new Date().toISOString().slice(0, 10)}.json`,
    fileType: 'text/json',
  })
}

export function ErasePopup () {
  let { t } = useTranslation()
  const gameId = useContext(GameIdContext)
  const dispatch = useAppDispatch()
  const [, setPopup] = useAtom(popupAtom)

  const eraseProgress = () => {
    dispatch(deleteProgress({game: gameId}))
    try { clearGameVisualProgress(gameId) } catch {}
    setPopup(null)
  }

  return <>
    <h2>{t("Reset Progress?")}</h2>
    <Trans>
      <p>Do you want to reset your saved progress?</p>
      <p>This clears progress for this game only. Saves and settings for other games are not affected.</p>
    </Trans>
    <div className='settings-buttons'>
      <button type="button" className="visual-modal-button danger" onClick={eraseProgress}>
        {t("Reset Progress")}
      </button>
      <button type="button" className="visual-modal-button secondary" onClick={() => setPopup(null)}>
        {t("Cancel")}
      </button>
    </div>
  </>
}
