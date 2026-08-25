import assert from 'node:assert/strict'
import test from 'node:test'

import { gameMapPath } from '../../tmp-game-routes-tests/gameRoutes.js'

test('NNG4 maps use the public release routes', () => {
  assert.equal(gameMapPath('g/local/NNG4', 'visual'), '/visualNNG')
  assert.equal(gameMapPath('g/local/NNG4', 'classic'), '/classicNNG')
})

test('the pitch and generic games keep their correct map routes', () => {
  assert.equal(gameMapPath('g/local/VisualTest', 'visual'), '/pitch')
  assert.equal(gameMapPath('g/local/VisualTest', 'classic'), '/g/local/VisualTest')
  assert.equal(gameMapPath('g/example/Game', 'visual'), '/g/example/Game/visual')
  assert.equal(gameMapPath('g/example/Game', 'classic'), '/g/example/Game')
})
