/**
 * @fileOverview Feedback payload for reports sent before a level has loaded.
 *
 * There is no proof state yet, so the report instead says it was sent in the
 * 'unloaded' state and carries what is useful for diagnosing a load problem:
 * the error on screen (if any), loading progress, recent worker messages, and
 * the browser/device capabilities that Lean depends on.
 */
import { detectBrowserIncompatibility, type LoadFailure } from './loadFailure'
import { getLeanLoadingProgress, getLeanWorkerLog } from './localWasmRpcClient'

type NavigatorExtras = Navigator & {
  deviceMemory?: number
  connection?: { effectiveType?: string; downlink?: number; saveData?: boolean }
  userAgentData?: { brands?: Array<{ brand: string; version: string }>; mobile?: boolean; platform?: string }
}

function browserDiagnostics() {
  const nav = navigator as NavigatorExtras
  const incompatibility = detectBrowserIncompatibility()
  return {
    userAgent: nav.userAgent,
    brands: nav.userAgentData?.brands,
    platform: nav.userAgentData?.platform ?? nav.platform,
    mobile: nav.userAgentData?.mobile,
    language: nav.language,
    deviceMemoryGb: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    maxTouchPoints: nav.maxTouchPoints,
    connection: nav.connection
      ? { effectiveType: nav.connection.effectiveType, downlink: nav.connection.downlink, saveData: nav.connection.saveData }
      : undefined,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    crossOriginIsolated: window.crossOriginIsolated,
    incompatibility: incompatibility ? { caseId: incompatibility.caseId, message: incompatibility.message } : null,
    msSincePageLoad: Math.round(performance.now()),
    url: window.location.href,
  }
}

export function unloadedFeedbackState(failure?: LoadFailure | null) {
  return {
    state: 'unloaded',
    shownError: failure
      ? { caseId: failure.caseId, text: failure.lines, detail: failure.detail }
      : null,
    loading: getLeanLoadingProgress(),
    workerLog: getLeanWorkerLog(),
    diagnostics: browserDiagnostics(),
  }
}
