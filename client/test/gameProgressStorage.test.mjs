import assert from 'node:assert/strict'
import test from 'node:test'

const {
  clearGameVisualProgress,
  exportGameVisualProgress,
  importGameVisualProgress,
} = await import('../../tmp-game-storage-tests/gameProgressStorage.js')

class MemoryStorage {
  constructor(entries) {
    this.entries = new Map(entries)
  }

  get length() { return this.entries.size }
  key(index) { return [...this.entries.keys()][index] ?? null }
  removeItem(key) { this.entries.delete(key) }
  getItem(key) { return this.entries.get(key) ?? null }
  setItem(key, value) { this.entries.set(key, value) }
}

test('erase removes only visual autosaves belonging to the selected game', () => {
  const storage = new MemoryStorage([
    ['visual-proof-autosave/g/local/NNG4/Addition/1', '{}'],
    ['visual-proof-autosave/g/local/NNG4/Addition/2', '{}'],
    ['visual-mobile-order/g/local/NNG4/Addition/2', '{}'],
    ['playlog/g/local/NNG4/Addition/2', '[]'],
    ['visual-proof-autosave/g/local/VisualTest/World/1', '{}'],
    ['visual-mobile-order/g/local/VisualTest/World/1', '{}'],
    ['visual_light_mode', 'true'],
    ['telemetry-consent', 'accepted'],
  ])

  clearGameVisualProgress('g/local/NNG4', storage)

  assert.deepEqual([...storage.entries.keys()], [
    'visual-proof-autosave/g/local/VisualTest/World/1',
    'visual-mobile-order/g/local/VisualTest/World/1',
    'visual_light_mode',
    'telemetry-consent',
  ])
})

test('export and import round-trip one game without touching another game', () => {
  const storage = new MemoryStorage([
    ['visual-proof-autosave/g/local/NNG4/Power/10', '{"proof":"xyzzy"}'],
    ['visual-mobile-order/g/local/NNG4/Power/10', '{"order":[]}'],
    ['visual-proof-autosave/g/local/VisualTest/Prototype/1', '{"proof":"intro"}'],
  ])

  const exported = exportGameVisualProgress('g/local/NNG4', storage)
  assert.deepEqual(Object.keys(exported).sort(), [
    'visual-mobile-order/g/local/NNG4/Power/10',
    'visual-proof-autosave/g/local/NNG4/Power/10',
  ])

  storage.setItem('visual-proof-autosave/g/local/NNG4/Power/9', '{}')
  importGameVisualProgress('g/local/NNG4', exported, storage)

  assert.equal(storage.getItem('visual-proof-autosave/g/local/NNG4/Power/9'), null)
  assert.equal(storage.getItem('visual-proof-autosave/g/local/NNG4/Power/10'), '{"proof":"xyzzy"}')
  assert.equal(storage.getItem('visual-proof-autosave/g/local/VisualTest/Prototype/1'), '{"proof":"intro"}')
})
