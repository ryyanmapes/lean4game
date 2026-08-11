/**
 * @fileOverview
*/
import * as React from 'react'
import { useSelector } from 'react-redux'
import { useAppDispatch } from '../../hooks'
import { GameProgressState, loadProgress, selectProgress } from '../../state/progress'
import { importGameVisualProgress } from '../../state/gameProgressStorage'
import { downloadFile } from '../world_tree'
import { Button } from '../utils'
import { Trans, useTranslation } from 'react-i18next'
import { GameIdContext } from '../../app'
import { popupAtom } from '../../store/popup-atoms'
import { useAtom } from 'jotai'

type ProgressBundle = {
  version: 2
  gameId: string
  progress: GameProgressState
  visualStorage?: Record<string, string>
}

function isProgressBundle(value: unknown): value is ProgressBundle {
  return typeof value === 'object' && value !== null &&
    'version' in value && value.version === 2 &&
    'gameId' in value && typeof value.gameId === 'string' &&
    'progress' in value
}

/** Pop-up that is displaying the Game Info.
 *
 * `handleClose` is the function to close it again because it's open/closed state is
 * controlled by the containing element.
 */
export function UploadPopup () {
  let { t } = useTranslation()

  const [file, setFile] = React.useState<File>();
  const [error, setError] = React.useState('')
  const gameId = React.useContext(GameIdContext)
  const gameProgress = useSelector(selectProgress(gameId))
  const dispatch = useAppDispatch()

  const [, setPopup] = useAtom(popupAtom)

  const handleFileChange = (e) => {
    setError('')
    if (e.target.files) {
      setFile(e.target.files[0])
    }
  }

  /** Upload progress from a  */
  const uploadProgress = (e) => {
    e.preventDefault()
    if (!file) {return}
    const fileReader = new FileReader()
    fileReader.readAsText(file, "UTF-8")
    fileReader.onload = (e) => {
      try {
        const parsed: unknown = JSON.parse(String(e.target?.result ?? ''))
        const isBundle = isProgressBundle(parsed)
        if (isBundle && parsed.gameId !== gameId) {
          throw new Error(`This save belongs to ${parsed.gameId}, not ${gameId}.`)
        }
        const progress = isBundle ? parsed.progress : parsed as GameProgressState
        if (!progress || !Array.isArray(progress.inventory) ||
            typeof progress.data !== 'object' || progress.data === null) {
          throw new Error('This file is not a valid Lean game save.')
        }
        dispatch(loadProgress({game: gameId, data: progress}))
        if (isBundle) importGameVisualProgress(gameId, parsed.visualStorage ?? {})
        setPopup(null)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load this save file.')
      }
    }
    fileReader.onerror = () => setError('Could not read this save file.')
  }

  /** Download the current progress (i.e. what's saved in the browser store) */
  const downloadProgress = (e) => {
    e.preventDefault()
    downloadFile({
      data: JSON.stringify(gameProgress, null, 2),
      fileName: `lean4game-${gameId}-${new Date().toLocaleDateString()}.json`,
      fileType: 'text/json',
    })
  }


  return <>
    <h2>{t("Upload Saved Progress")}</h2>
    <Trans>
      <p>Select a JSON file with the saved game progress to load your progress.</p>

      <p><b>Warning:</b> This will delete your current game progress!
        Consider <a className="download-link" onClick={downloadProgress} >downloading your current progress</a> first!
      </p>
    </Trans>
    <p>
      <input type="file" accept="application/json,.json" onChange={handleFileChange}/>
    </p>

    {error && <p className="message error" role="alert">{error}</p>}

    {/* TODO: apperently clicking this redirects the user back to the landing page... */}
    <Button to="" onClick={uploadProgress} disabled={!file}>{t("Load selected file")}</Button>
  </>
}
