import * as React from 'react'
import { isRouteErrorResponse, useRouteError } from "react-router-dom"
import { useAppSelector } from '../hooks'
import '../css/error_page.css'

function stringifyErrorData(data: unknown): string | null {
  if (data == null) return null
  if (typeof data === 'string') return data.replace(/^Error:\s*/, '')
  if (data instanceof Error) return data.message

  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function routeErrorText(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    const status = [error.status, error.statusText].filter(Boolean).join(' ')
    const data = stringifyErrorData(error.data)
    return data ? `${status}\n${data}` : status
  }

  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

/** The fallback error page */
export default function ErrorPage() {
  const error = useRouteError()
  const isVisualLightMode = useAppSelector(state => state.preferences.isVisualLightMode)
  const message = routeErrorText(error)
  console.error(error)

  return (
    <div id="error-page" data-visual-theme={isVisualLightMode ? 'light' : 'dark'}>
      <p className="error-message" role="alert">{message}</p>
    </div>
  )
}
