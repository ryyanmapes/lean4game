/** The coarse platform sent with telemetry: a browser family and whether the
 * device is a phone/tablet or a computer (doc/telemetry-client.md). It is
 * classified here, in the browser, so only these fixed values ever leave it;
 * the user-agent string itself is never sent. The collector accepts exactly
 * these values and drops anything else. */

export type TelemetryBrowser = 'chrome' | 'safari' | 'firefox' | 'edge' | 'brave' | 'samsung' | 'opera' | 'unknown'
export type TelemetryDevice = 'mobile' | 'desktop'
export type TelemetryPlatform = { browser: TelemetryBrowser; device: TelemetryDevice }

/** What the classification looks at; detectPlatform() reads it from navigator. */
export type PlatformSignals = {
  userAgent: string
  /** navigator.userAgentData.brands (Chromium browsers only). */
  brands?: string[]
  /** navigator.userAgentData.mobile (Chromium browsers only; false for tablets). */
  mobile?: boolean
  /** navigator.platform, used only to recognise iPads that present as Macs. */
  platform?: string
  maxTouchPoints?: number
  /** Brave exposes navigator.brave and otherwise presents as Chrome. */
  isBrave?: boolean
}

// Brand names reported by userAgentData, most specific first.
const BRANDS: Array<[RegExp, TelemetryBrowser]> = [
  [/^Brave$/u, 'brave'],
  [/^Microsoft Edge$/u, 'edge'],
  [/^Opera/u, 'opera'],
  [/^Samsung Internet$/u, 'samsung'],
  [/^Google Chrome$/u, 'chrome'],
]

// User-agent tokens, most specific first: every Chromium browser also says
// "Chrome", and almost every browser also says "Safari". Headless Chrome and
// Chromium say "HeadlessChrome" instead and are still Chrome.
const TOKENS: Array<[RegExp, TelemetryBrowser]> = [
  [/\bSamsungBrowser\//u, 'samsung'],
  [/\b(?:Edg|EdgA|EdgiOS|Edge)\//u, 'edge'],
  [/\b(?:OPR|OPT|OPiOS|OPX)\/|\bOpera\b/u, 'opera'],
  [/\b(?:Firefox|FxiOS)\//u, 'firefox'],
  [/\b(?:CriOS|Chrome|HeadlessChrome|Chromium)\//u, 'chrome'],
]

export function classifyBrowser(signals: PlatformSignals): TelemetryBrowser {
  if (signals.isBrave) return 'brave'
  for (const brand of signals.brands ?? []) {
    const match = BRANDS.find(([pattern]) => pattern.test(brand))
    if (match) return match[1]
  }
  const userAgent = signals.userAgent
  const token = TOKENS.find(([pattern]) => pattern.test(userAgent))
  if (token) return token[1]
  // Safari itself carries "Version/x Safari/y"; WebKit views inside other apps
  // (social apps, embedded browsers) do not, and are not Safari.
  if (/\bVersion\/[\d.]+.*\bSafari\//u.test(userAgent) && /AppleWebKit\//u.test(userAgent)) return 'safari'
  return 'unknown'
}

export function classifyDevice(signals: PlatformSignals): TelemetryDevice {
  const userAgent = signals.userAgent
  // Phones and tablets alike count as mobile; Android tablets lack "Mobile".
  if (/Mobi|Android|iPhone|iPad|iPod|Silk|Kindle|webOS|BlackBerry|Opera Mini|IEMobile/u.test(userAgent)) return 'mobile'
  // iPadOS asks for desktop sites and presents itself as a Mac with a touch screen.
  if (signals.platform === 'MacIntel' && (signals.maxTouchPoints ?? 0) > 1) return 'mobile'
  if (signals.mobile === true) return 'mobile'
  return 'desktop'
}

export function classifyPlatform(signals: PlatformSignals): TelemetryPlatform {
  return { browser: classifyBrowser(signals), device: classifyDevice(signals) }
}

type NavigatorWithHints = Navigator & {
  userAgentData?: { brands?: Array<{ brand: string }>; mobile?: boolean }
  brave?: unknown
}

/** The platform of this browser, or null where there is no navigator. */
export function detectPlatform(): TelemetryPlatform | null {
  try {
    if (typeof navigator === 'undefined') return null
    const hints = navigator as NavigatorWithHints
    return classifyPlatform({
      userAgent: String(navigator.userAgent ?? ''),
      brands: hints.userAgentData?.brands?.map(item => item.brand),
      mobile: hints.userAgentData?.mobile,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      isBrave: hints.brave !== undefined && hints.brave !== null,
    })
  } catch {
    return null
  }
}
