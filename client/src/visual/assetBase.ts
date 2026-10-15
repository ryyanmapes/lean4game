/**
 * @fileOverview Where the Lean runtime and module bundle are downloaded from.
 *
 * The GitHub Pages copy of the release adds `/visual-lean/asset-base.json`,
 * pointing at a content-addressed copy of the same files on Cloudflare R2
 * (lean4.js `scripts/publish-r2-assets.sh`):
 *
 *     { "base": "https://assets.example.com/visual-lean/3f9c0a1b2c3d4e5f" }
 *
 * Everywhere else (the Docker image, local development, Cypress) the file is
 * absent and the same-origin `/visual-lean` copy is used, as it always was.
 */

export const SAME_ORIGIN_ASSET_BASE = '/visual-lean'
export const ASSET_BASE_CONFIG_URL = `${SAME_ORIGIN_ASSET_BASE}/asset-base.json`

/**
 * The remote base named by an asset-base.json document, without a trailing
 * slash, or null when it should be ignored: anything but an object whose
 * `base` is an absolute `https:` URL with no query or fragment (paths are
 * appended to it). Exported for tests.
 */
export function parseAssetBaseConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const base = (config as { base?: unknown }).base
  if (typeof base !== 'string') return null
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.search || url.hash) return null
  return url.href.replace(/\/+$/u, '')
}

/**
 * Fetch and parse the config. A missing or unreadable file means the
 * same-origin copy; development servers answer the missing file with their
 * HTML fallback page, which fails to parse and lands here too. Exported for
 * tests.
 */
export async function fetchAssetBase(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    // The file is tiny and revalidates by ETag, so a new deploy is picked up
    // despite the static host's max-age.
    const response = await fetchImpl(ASSET_BASE_CONFIG_URL, { cache: 'no-cache' })
    if (!response.ok) return SAME_ORIGIN_ASSET_BASE
    return parseAssetBaseConfig(await response.json()) ?? SAME_ORIGIN_ASSET_BASE
  } catch {
    return SAME_ORIGIN_ASSET_BASE
  }
}

let resolvedAssetBase: Promise<string> | null = null

/** The asset base for this page, fetched once. */
export function resolveAssetBase(): Promise<string> {
  if (!resolvedAssetBase) resolvedAssetBase = fetchAssetBase()
  return resolvedAssetBase
}
