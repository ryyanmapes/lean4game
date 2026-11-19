import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The visual interface keeps every colour in palette.css. These tests hold the
// rest of it to that, and the palette file to the layout that the palette picker
// (NNG2/palette-picker) reads and writes.
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const palette = read('visual/palette.css')
const visual = read('visual/visual.css')

/** The declarations of the rule with exactly this selector, in order. */
function block(text, selector) {
  const rule = /(^|\n)([^\n{}]+)\{([^}]*)\}/g
  let match
  while ((match = rule.exec(text))) {
    if (match[2].trim() !== selector) continue
    return [...match[3].matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);[ \t]*(?:\/\*\s*(.*?)\s*\*\/)?/gm)]
      .map(([, name, value, comment]) => ({ name, value: value.trim(), comment: comment ?? '' }))
  }
  return null
}

const dark = block(palette, '.app')
const light = block(palette, ".app[data-visual-theme='light']")
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '')
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\((?!var\(--pal-)|\bhsla?\(/

test('the palette has a dark and a light scheme with the same colours in the same order', () => {
  assert.ok(dark && dark.length > 40, 'the dark scheme')
  assert.ok(light, 'the light scheme')
  assert.deepEqual(light.map(entry => entry.name), dark.map(entry => entry.name))
})

test('every colour is its red, green and blue, with its hex and what it is for beside it', () => {
  for (const scheme of [dark, light]) {
    for (const { name, value, comment } of scheme) {
      assert.match(name, /^--pal-[a-z0-9-]+$/)
      const channels = /^(\d+), (\d+), (\d+)$/.exec(value)
      assert.ok(channels, `${name}: ${value}`)
      const numbers = channels.slice(1).map(Number)
      assert.ok(numbers.every(channel => channel <= 255), `${name}: ${value}`)
      const hex = `#${numbers.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
      assert.ok(comment.startsWith(`${hex}  `), `${name} is ${hex}, but its comment reads "${comment}"`)
      assert.ok(comment.length > hex.length + 4, `${name} says what it is for`)
    }
  }
})

test('a game recolours the accent only with colours the palette has', () => {
  const names = new Set(dark.map(entry => entry.name))
  for (const selector of [
    ".app[data-game-id='g/local/VisualTest']",
    ".app[data-visual-theme='light'][data-game-id='g/local/VisualTest']",
  ]) {
    const entries = block(palette, selector)
    assert.ok(entries && entries.length > 0, selector)
    for (const { name, value } of entries) {
      assert.ok(names.has(name), `${name} in ${selector}`)
      assert.match(value, /^\d+, \d+, \d+$/)
    }
  }
})

test('the stylesheet has no colour of its own', () => {
  const offending = withoutComments(visual).split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    // The loading animation fades with an alpha mask, which is not a colour.
    .filter(({ line }) => COLOUR_LITERAL.test(line) && !/rgba\(0,0,0,0\.6\)/.test(line))
  assert.deepEqual(offending, [])
})

test('the maps and the app shell take their colours from the palette', () => {
  for (const path of ['visual/VisualPathMap.tsx', 'visual/VisualWorldMap.tsx', 'app.tsx']) {
    const code = read(path).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.equal(/#[0-9a-fA-F]{6}\b/.test(code), false, `${path} has a hex colour`)
    assert.equal(/\brgba?\(\s*\d/.test(code), false, `${path} has an rgb colour`)
  }
})

test('every palette colour that is used exists', () => {
  const names = new Set(dark.map(entry => entry.name))
  const used = new Set()
  for (const path of ['visual/visual.css', 'visual/VisualPathMap.tsx', 'visual/VisualWorldMap.tsx', 'app.tsx']) {
    for (const [name] of read(path).matchAll(/--pal-[a-z0-9]+(?:-[a-z0-9]+)*/g)) used.add(name)
  }
  // The path map builds its world colours' names from the colour's name.
  used.delete('--pal-world')
  const worlds = /WORLD_COLOR_NAMES = new Set\(\[([^\]]+)\]/.exec(read('visual/VisualPathMap.tsx'))[1]
    .match(/'([a-z]+)'/g).map(quoted => quoted.slice(1, -1))
  assert.ok(worlds.length >= 12)
  for (const world of worlds) used.add(`--pal-world-${world}`).add(`--pal-world-${world}-edge`)
  assert.deepEqual([...used].filter(name => !names.has(name)), [])
  // And nothing in the palette is left over.
  assert.deepEqual([...names].filter(name => !used.has(name)), [])
})

test('the tokens of the stylesheet are all derived from the palette', () => {
  for (const selector of ['.app', ".app[data-visual-theme='light']"]) {
    const tokens = block(visual, selector)
    assert.ok(tokens && tokens.length > 0, selector)
    for (const { name, value } of tokens) {
      assert.match(value, /^rgba?\(var\(--pal-[a-z0-9-]+\)(?:, [\d.]+)?\)$/, `${name}: ${value}`)
    }
  }
})
