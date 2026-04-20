import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseTransformTarget } = require('../../tmp-transformation-tests/visual/TransformationView.js')
const { parse, printExpression } = require('../../tmp-transformation-tests/visual/expr-engine.js')

console.log(String(parse).slice(0, 200))
console.log('abs', parseTransformTarget('|x - x₀| ≤ δ'))
console.log('negEq', parseTransformTarget('a - b = a + -b'))
console.log('negCmp', parseTransformTarget('-b ≤ a'))

for (const input of ['|x - x₀| ≤ δ', 'a - b = a + -b', '-b ≤ a']) {
  try {
    const parsed = parse(input)
    console.log('raw', input, parsed.type, printExpression(parsed))
  } catch (error) {
    console.log('parseError', input, String(error))
    console.log(error?.stack)
  }
}
