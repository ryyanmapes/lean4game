import * as React from 'react'
import { submitFeedbackReport, type TelemetryMode } from '../utils/telemetry'

import '../css/feedback-report.css'

export function FeedbackReportButton({
  gameId,
  worldId,
  levelId,
  mode,
  getProofState,
}: {
  gameId: string
  worldId: string
  levelId: number
  mode: TelemetryMode
  getProofState: () => unknown
}) {
  const [open, setOpen] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [status, setStatus] = React.useState<'idle' | 'sent' | 'error'>('idle')
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const textRef = React.useRef<HTMLTextAreaElement>(null)
  const trimmed = message.trim()
  const invalid = !trimmed || message.length > 1000

  React.useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      window.setTimeout(() => textRef.current?.focus(), 0)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  function close() {
    if (submitting) return
    setOpen(false)
    setStatus('idle')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (invalid || submitting) return
    setSubmitting(true)
    setStatus('idle')
    try {
      const sent = await submitFeedbackReport({
        message,
        game_id: gameId,
        world_id: worldId,
        level_id: levelId,
        mode,
        proof_state: getProofState(),
      })
      if (sent) {
        setStatus('sent')
        setMessage('')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <button type="button" className="feedback-report-open" aria-label="Send feedback"
      onClick={() => { setStatus('idle'); setOpen(true) }}>
      !
    </button>
    <dialog ref={dialogRef} className="feedback-report-dialog" aria-label="Send feedback"
      onCancel={event => { event.preventDefault(); close() }}
      onClose={() => setOpen(false)}>
      <form onSubmit={submit}>
        <button type="button" className="feedback-report-close" aria-label="Close feedback form"
          onClick={close}>×</button>
        <label htmlFor={`feedback-message-${mode}`}>
          This form will send a feedback report along with your game state.
        </label>
        <textarea ref={textRef} id={`feedback-message-${mode}`} value={message}
          onChange={event => { setMessage(event.target.value); setStatus('idle') }}
          maxLength={1000} aria-describedby={`feedback-count-${mode}`}
          disabled={submitting} />
        <div id={`feedback-count-${mode}`} className={`feedback-report-count${message.length > 1000 ? ' invalid' : ''}`}>
          {message.length}/1000
        </div>
        <button type="submit" className="feedback-report-submit" disabled={invalid || submitting}>
          {submitting ? 'Sending…' : 'Submit feedback'}
        </button>
        {status === 'sent' && <p className="feedback-report-status success" role="status">Feedback sent. Thank you!</p>}
        {status === 'error' && <p className="feedback-report-status error" role="alert">Feedback could not be sent. Please try again.</p>}
      </form>
    </dialog>
  </>
}
