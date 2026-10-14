import assert from 'node:assert/strict'
import test from 'node:test'

import { detectPlatform } from '../../tmp-telemetry-tests/telemetry.js'

const cases = [
  ['Windows Chrome',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    { browser: 'chrome', device: 'desktop' }],
  ['Windows Edge',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    { browser: 'edge', device: 'desktop' }],
  ['macOS Safari',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    { browser: 'safari', device: 'desktop' }],
  ['Linux Firefox',
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    { browser: 'firefox', device: 'desktop' }],
  ['Windows Opera',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
    { browser: 'opera', device: 'desktop' }],
  ['iPhone Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    { browser: 'safari', device: 'mobile' }],
  ['iPhone Chrome',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1',
    { browser: 'chrome', device: 'mobile' }],
  ['iPhone Firefox',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
    { browser: 'firefox', device: 'mobile' }],
  ['Android Chrome',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    { browser: 'chrome', device: 'mobile' }],
  ['Android tablet Chrome (no "Mobile" token)',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    { browser: 'chrome', device: 'mobile' }],
  ['Samsung Internet',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    { browser: 'samsung', device: 'mobile' }],
  ['Cypress Electron',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Cypress/14.5.0 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36',
    { browser: 'chrome', device: 'desktop' }],
  ['headless Chrome (cypress run)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    { browser: 'chrome', device: 'desktop' }],
  ['unrecognised browser', 'curl/8.4.0', { browser: 'unknown', device: 'desktop' }],
]

for (const [name, userAgent, expected] of cases) {
  test(`classifies ${name}`, () => {
    assert.deepEqual(detectPlatform(userAgent), expected)
  })
}

test('an iPad presenting desktop Safari is a mobile device', () => {
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  assert.deepEqual(detectPlatform(ipad, undefined, 5), { browser: 'safari', device: 'mobile' })
  assert.deepEqual(detectPlatform(ipad, undefined, 0), { browser: 'safari', device: 'desktop' })
})

test('Brave is recognised from navigator.brave, since its user agent is Chrome\'s', () => {
  const desktopChrome = cases[0][1]
  const androidChrome = cases.find(([name]) => name === 'Android Chrome')[1]
  assert.deepEqual(detectPlatform(desktopChrome, undefined, 0, true), { browser: 'brave', device: 'desktop' })
  assert.deepEqual(detectPlatform(androidChrome, true, 5, true), { browser: 'brave', device: 'mobile' })
  assert.equal(detectPlatform(desktopChrome, undefined, 0, false).browser, 'chrome')
  // A few Brave builds do name themselves in the user agent.
  assert.equal(detectPlatform(`${desktopChrome} Brave/141`).browser, 'brave')
})

test('the browser mobile hint marks a device without a mobile user agent token', () => {
  const desktopChrome = cases[0][1]
  assert.equal(detectPlatform(desktopChrome, true).device, 'mobile')
  assert.equal(detectPlatform(desktopChrome, false).device, 'desktop')
})
