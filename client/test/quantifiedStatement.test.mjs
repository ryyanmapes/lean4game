import assert from 'node:assert/strict'
import test from 'node:test'

const {
  buildEqualityTheoremDisplay,
  buildForallSpecificationFromDisplay,
  buildPropositionTheoremDisplay,
} = await import('../../tmp-quantified-tests/quantifiedStatement.js')

const FORALL = '\u2200'
const IMPLIES = '\u2192'
const NAT = '\u2115'
const LE = '\u2264'
const NAT_MOJIBAKE = '\u00e2\u201e\u00a2'
const LE_MOJIBAKE = '\u00e2\u2030\u00a4'

test('proposition theorems keep propositional binders in the body and numeric binders in the footer', () => {
  const display = buildPropositionTheoremDisplay(`(a b : ${NAT}) (h : succ a = succ b) : a = b`)

  assert.equal(display.mainText, `succ a = succ b ${IMPLIES} a = b`)
  assert.equal(display.forallFooter, `${FORALL} (a : ${NAT}) (b : ${NAT})`)
  assert.deepEqual(display.forallSpecification, {
    varName: 'a',
    body: `${FORALL} (b : ${NAT}), succ a = succ b ${IMPLIES} a = b`,
  })
})

test('equality theorems only unpack one grouped forall binder at a time', () => {
  const display = buildEqualityTheoremDisplay(`(a b : ${NAT}) : a + b = b + a`)

  assert.deepEqual(display.forallSpecification, {
    varName: 'a',
    body: `${FORALL} (b : ${NAT}), a + b = b + a`,
  })
})

test('order hypotheses render as implication premises instead of forall binders', () => {
  const display = buildPropositionTheoremDisplay(
    `(x y z : ${NAT}) (hxy : x ${LE} y) (hyz : y ${LE} z) : x ${LE} z`,
  )

  assert.equal(display.mainText, `x ${LE} y ${IMPLIES} y ${LE} z ${IMPLIES} x ${LE} z`)
  assert.equal(display.forallFooter, `${FORALL} (x : ${NAT}) (y : ${NAT}) (z : ${NAT})`)
  assert.deepEqual(display.forallSpecification, {
    varName: 'x',
    body: `${FORALL} (y : ${NAT}) (z : ${NAT}), x ${LE} y ${IMPLIES} y ${LE} z ${IMPLIES} x ${LE} z`,
  })
})

test('order hypotheses still render as implication premises when theorem text is mojibake-encoded', () => {
  const display = buildPropositionTheoremDisplay(
    `(x y z : ${NAT_MOJIBAKE}) (hxy : x ${LE_MOJIBAKE} y) (hyz : y ${LE_MOJIBAKE} z) : x ${LE_MOJIBAKE} z`,
  )

  assert.equal(display.mainText, `x ${LE} y ${IMPLIES} y ${LE} z ${IMPLIES} x ${LE} z`)
  assert.equal(display.forallFooter, `${FORALL} (x : ${NAT}) (y : ${NAT}) (z : ${NAT})`)
})

test('workspace cards can reconstruct the next specification step from displayed text', () => {
  const firstStep = buildForallSpecificationFromDisplay(
    `succ a = succ b ${IMPLIES} a = b`,
    `${FORALL} (a : ${NAT}) (b : ${NAT})`,
  )
  assert.deepEqual(firstStep, {
    varName: 'a',
    body: `${FORALL} (b : ${NAT}), succ a = succ b ${IMPLIES} a = b`,
  })

  const secondStep = buildForallSpecificationFromDisplay(
    `succ chosen = succ b ${IMPLIES} chosen = b`,
    `${FORALL} (b : ${NAT})`,
  )
  assert.deepEqual(secondStep, {
    varName: 'b',
    body: `succ chosen = succ b ${IMPLIES} chosen = b`,
  })
})
