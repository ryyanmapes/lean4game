import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ASSET_BASE_CONFIG_URL,
  fetchAssetBase,
  parseAssetBaseConfig,
  SAME_ORIGIN_ASSET_BASE,
} from '../../tmp-asset-base-tests/assetBase.js'

const R2_BASE = 'https://assets.autumnofautumn.com/visual-lean/3f9c0a1b2c3d4e5f'

function fetchReturning(status, body) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response(body, { status })
  }
  return { calls, fetchImpl }
}

test('a valid config names its https base without a trailing slash', () => {
  assert.equal(parseAssetBaseConfig({ base: R2_BASE }), R2_BASE)
  assert.equal(parseAssetBaseConfig({ base: `${R2_BASE}/` }), R2_BASE)
  assert.equal(parseAssetBaseConfig({ base: 'https://assets.example.com' }), 'https://assets.example.com')
})

test('a malformed config is ignored', () => {
  for (const config of [null, undefined, 'https://assets.example.com', [R2_BASE], {}, { base: 42 }, { base: '' }, { base: 'not a url' }]) {
    assert.equal(parseAssetBaseConfig(config), null, JSON.stringify(config))
  }
})

test('a base that is not an absolute https URL is ignored', () => {
  for (const base of [
    'http://assets.example.com/visual-lean/v',
    '//assets.example.com/visual-lean/v',
    '/visual-lean',
    'javascript:alert(1)',
    'data:text/plain,x',
    `${R2_BASE}?v=1`,
    `${R2_BASE}#runtime`,
  ]) {
    assert.equal(parseAssetBaseConfig({ base }), null, base)
  }
})

test('the config is fetched without a stale cache and its base is used', async () => {
  const { calls, fetchImpl } = fetchReturning(200, JSON.stringify({ base: R2_BASE }))
  assert.equal(await fetchAssetBase(fetchImpl), R2_BASE)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, ASSET_BASE_CONFIG_URL)
  assert.equal(calls[0].init.cache, 'no-cache')
})

test('a missing config means the same-origin copy', async () => {
  assert.equal(await fetchAssetBase(fetchReturning(404, 'Not found').fetchImpl), SAME_ORIGIN_ASSET_BASE)
})

test('an unreadable config means the same-origin copy', async () => {
  // Development servers answer a missing file with their HTML page.
  assert.equal(await fetchAssetBase(fetchReturning(200, '<!doctype html><html></html>').fetchImpl), SAME_ORIGIN_ASSET_BASE)
  assert.equal(await fetchAssetBase(fetchReturning(200, JSON.stringify({ base: 'http://insecure.example.com' })).fetchImpl), SAME_ORIGIN_ASSET_BASE)
  const offline = async () => { throw new TypeError('Failed to fetch') }
  assert.equal(await fetchAssetBase(offline), SAME_ORIGIN_ASSET_BASE)
})
