import assert from 'node:assert/strict'
import test from 'node:test'

const { clearGameVisualProgress } = await import('../../tmp-game-storage-tests/gameProgressStorage.js')

class MemoryStorage {
  constructor(entries) {
    this.entries = new Map(entries)
  }

  get length() { return this.entries.size }
  key(index) { return [...this.entries.keys()][index] ?? null }
  removeItem(key) { this.entries.delete(key) }
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
