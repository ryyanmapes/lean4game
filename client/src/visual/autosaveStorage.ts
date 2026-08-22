/**
 * Lossless compression for saved visual proofs.
 *
 * Every recorded step carries a full canvas and proof-tree snapshot so undo can
 * restore it, which makes a saved lategame proof large and extremely
 * repetitive: a 33-step Advanced Multiplication level measures ~437 KB, of
 * which ~254 KB is the step list alone. localStorage allows roughly 5 MB for
 * the whole origin, shared across every level, so a player deep into the game
 * exhausts it, `setItem` throws, and the save is silently lost.
 *
 * gzip suits this data well because the snapshots differ from one another only
 * slightly. Compression is exact -- what comes back out is the same JSON that
 * went in -- so nothing about restoring a proof changes.
 */

/** Marks a stored value as gzip + base64 rather than plain JSON. */
const COMPRESSED_PREFIX = 'gz1:'

// The project's DOM lib predates the compression streams, so reach them through
// `globalThis`. That also makes the availability check and the types agree:
// browsers without them simply fall back to plain JSON.
type ByteStream = ReadableStream<Uint8Array>
interface ByteTransform {
  readonly readable: ByteStream
  readonly writable: WritableStream<Uint8Array>
}
type ByteTransformCtor = new (format: 'gzip') => ByteTransform

const compressionStreams = globalThis as unknown as {
  CompressionStream?: ByteTransformCtor
  DecompressionStream?: ByteTransformCtor
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** Base64 without spreading a large array into `String.fromCharCode`, which
 *  overflows the argument limit on payloads this size. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** Serialize a value for storage, compressing when the browser supports it.
 *  Falls back to plain JSON so a missing `CompressionStream` only costs space. */
export async function encodeAutosave(value: unknown): Promise<string> {
  const json = JSON.stringify(value)
  const Compression = compressionStreams.CompressionStream
  if (!Compression) return json
  try {
    const input = new Blob([json]).stream() as ByteStream
    const compressed = input.pipeThrough(new Compression('gzip'))
    return COMPRESSED_PREFIX + bytesToBase64(await streamToBytes(compressed))
  } catch {
    return json
  }
}

/** Read a stored value written by `encodeAutosave`, or by any earlier build
 *  that stored plain JSON. Returns null when the payload cannot be read. */
export async function decodeAutosave(raw: string): Promise<unknown> {
  if (!raw.startsWith(COMPRESSED_PREFIX)) return JSON.parse(raw)
  const Decompression = compressionStreams.DecompressionStream
  if (!Decompression) throw new Error('compressed autosave needs DecompressionStream')
  const bytes = base64ToBytes(raw.slice(COMPRESSED_PREFIX.length))
  const input = new Blob([bytes as BlobPart]).stream() as ByteStream
  const decompressed = input.pipeThrough(new Decompression('gzip'))
  const json = new TextDecoder().decode(await streamToBytes(decompressed))
  return JSON.parse(json)
}

/** Every autosave key currently held, newest first where a timestamp is
 *  readable. Compressed entries are not opened here: their key order is enough
 *  to evict by, and decoding all of them to free space would be wasteful. */
function autosaveKeys(keyPrefix: string, exceptKey: string): string[] {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith(keyPrefix) && key !== exceptKey) keys.push(key)
  }
  return keys
}

/**
 * Store a value, making room if the quota is reached.
 *
 * A silently dropped save is worse than a lost older one: the level still shows
 * as completed from progress metadata, but reopening it finds no proof to
 * restore, and the classic-mode export then has nothing to hand off. Evict
 * other levels' saves rather than lose the one being written.
 */
export async function writeAutosave(
  key: string,
  keyPrefix: string,
  value: unknown,
): Promise<boolean> {
  const payload = await encodeAutosave(value)
  const candidates = autosaveKeys(keyPrefix, key)
  for (let attempt = 0; ; attempt += 1) {
    try {
      localStorage.setItem(key, payload)
      return true
    } catch {
      const victim = candidates.shift()
      if (!victim) return false
      try { localStorage.removeItem(victim) } catch { return false }
      if (attempt > 64) return false
    }
  }
}
