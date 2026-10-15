// The GitHub Pages copy of the release points the Lean downloads at a remote
// copy through /visual-lean/asset-base.json (lean4.js
// scripts/publish-r2-assets.sh). The release image has no such file, so stub
// one naming an origin that can never resolve: the client must start Lean from
// the same-origin copy instead.
const UNREACHABLE_BASE = 'https://asset-fallback.invalid/visual-lean/0000000000000000'

describe('Visual Lean asset base fallback', () => {
  it('loads a level from the same origin when the configured asset base is unreachable', () => {
    cy.intercept({ method: 'GET', pathname: '/visual-lean/asset-base.json' }, { body: { base: UNREACHABLE_BASE } })
      .as('assetBase')
    cy.visit('/lean4game/index.html#/g/local/VisualTest/world/Prototype/level/1/visual')
    cy.wait('@assetBase', { timeout: 60_000 })
    cy.get('[data-testid="goal-card"]', { timeout: 600_000 })
      .should('be.visible')
      .and('have.attr', 'data-goal-text')
      .and('contain', 'P')
    cy.window().its('__leanAssetBases').should('deep.equal', [UNREACHABLE_BASE, '/visual-lean'])
  })
})
