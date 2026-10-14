import assert from 'node:assert/strict'
import test from 'node:test'

const { classifyPlatform, classifyBrowser, classifyDevice, detectPlatform } = await import('../../tmp-telemetry-tests/telemetryPlatform.js')

// [user agent, extra signals, expected browser, expected device]
const CASES = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', {}, 'chrome', 'desktop'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', {}, 'chrome', 'mobile'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1', {}, 'chrome', 'mobile'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', {}, 'safari', 'desktop'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', {}, 'safari', 'mobile'],
  ['Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', {}, 'safari', 'mobile'],
  // iPadOS requesting the desktop site looks like a Mac, but has a touch screen.
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    { platform: 'MacIntel', maxTouchPoints: 5 }, 'safari', 'mobile'],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', {}, 'firefox', 'desktop'],
  ['Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', {}, 'firefox', 'mobile'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15', {}, 'firefox', 'mobile'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68', {}, 'edge', 'desktop'],
  ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.2849.80', {}, 'edge', 'mobile'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0', {}, 'opera', 'desktop'],
  ['Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', {}, 'samsung', 'mobile'],
  // An Android tablet: "Android" without "Mobile" is still a tablet, so mobile.
  ['Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', {}, 'chrome', 'mobile'],
  // Headless Chrome and Chromium (what Cypress drives) are Chrome; headless Edge stays Edge.
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36', {}, 'chrome', 'desktop'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    { brands: ['Chromium', 'Not(A:Brand'] }, 'chrome', 'desktop'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68', {}, 'edge', 'desktop'],
  // Brave presents as Chrome and is recognised by navigator.brave.
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', { isBrave: true }, 'brave', 'desktop'],
  // An in-app WebKit view is not Safari.
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0', {}, 'unknown', 'mobile'],
  ['', {}, 'unknown', 'desktop'],
  ['curl/8.0', {}, 'unknown', 'desktop'],
]

test('classifies browser families and device types from real user agents', () => {
  for (const [userAgent, extra, browser, device] of CASES) {
    assert.deepEqual(classifyPlatform({ userAgent, ...extra }), { browser, device }, userAgent)
  }
})

test('client hints take precedence for Chromium browsers', () => {
  const chromeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  assert.equal(classifyBrowser({ userAgent: chromeUa, brands: ['Not?A_Brand', 'Chromium', 'Microsoft Edge'] }), 'edge')
  assert.equal(classifyBrowser({ userAgent: chromeUa, brands: ['Chromium', 'Brave'] }), 'brave')
  assert.equal(classifyBrowser({ userAgent: chromeUa, brands: ['Opera', 'Chromium'] }), 'opera')
  assert.equal(classifyBrowser({ userAgent: chromeUa, brands: ['Chromium', 'Not=A?Brand'] }), 'chrome', 'falls back to the user agent')
  assert.equal(classifyDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', mobile: true }), 'mobile')
})

test('only the fixed values are ever produced', () => {
  const browsers = new Set(['chrome', 'safari', 'firefox', 'edge', 'brave', 'samsung', 'opera', 'unknown'])
  for (const [userAgent, extra] of CASES) {
    const platform = classifyPlatform({ userAgent, ...extra })
    assert.deepEqual(Object.keys(platform).sort(), ['browser', 'device'])
    assert.ok(browsers.has(platform.browser))
    assert.ok(['mobile', 'desktop'].includes(platform.device))
  }
})

test('detection never throws and needs a navigator', () => {
  const platform = detectPlatform()
  // Node 21+ has a navigator with a user agent such as "Node.js/22".
  assert.ok(platform === null || platform.browser === 'unknown')
})
