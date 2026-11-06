// The Natural Numbers Video Game (Lean4Game/NNVG) against the native dev relay:
// the path-style world map, the opening text level, and Rewrite-only levels
// played with rule-card clicks and the check mark.
const base = Cypress.env('LEAN4GAME_MOUNT') ?? ''
const MAP = `${base}/g/local/NNVG/visual`
const level = (world: string, n: number) => `${base}/g/local/NNVG/world/${world}/level/${n}/visual`
const LOAD_TIMEOUT = Number(Cypress.env('VISUAL_TIMEOUT') ?? 180000)

type HarnessWindow = Cypress.AUTWindow & {
  __visualTestHarness?: {
    rewriteGoalInTransform(theoremName: string, workingSide?: 'left' | 'right', path?: number[], isReverse?: boolean): Promise<void>
    dragHypToGoal(hypName: string): Promise<void>
    dragTacticToHyp(tacticName: string, hypName: string): Promise<void>
    clickGoal(playTactic?: string): Promise<void>
    clickHyp(hypName: string): Promise<void>
    getCurrentStreamSnapshot(): { goalType: string }
    getProofAudit(): { completed: boolean; processing: boolean }
  }
}

function visit(url: string, options: { fresh?: boolean } = {}) {
  cy.visit(url, {
    onBeforeLoad(win) {
      if (options.fresh) win.localStorage.clear()
      win.localStorage.setItem('telemetryConsent', 'refused')
    },
  })
}

function mapLevel(world: string, n: number) {
  return cy.get(`[data-testid="path-map-level"][data-world="${world}"][data-level="${n}"]`, { timeout: LOAD_TIMEOUT })
}

function relationText($row: JQuery<HTMLElement>) {
  return $row.children('[data-expr-text]').toArray().map(side => side.getAttribute('data-expr-text')).join(' = ')
}

/** The relation shown in Rewrite Mode, as its two sides print. */
function relationShouldBe(text: string) {
  cy.get('.tr-expr-wrapper', { timeout: LOAD_TIMEOUT }).should($row => {
    expect(relationText($row)).to.equal(text)
  })
}

function lessonsShouldContain(text: string) {
  cy.get('[data-testid="rewrite-lessons"]', { timeout: LOAD_TIMEOUT }).should('contain.text', text)
}

function notProcessing() {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    const harness = (win as HarnessWindow).__visualTestHarness
    expect(harness, 'visual test harness').to.exist
    expect(harness!.getProofAudit().processing).to.equal(false)
  })
}

function clickRule(label: string) {
  notProcessing()
  cy.get(`.tr-rule-card[data-rule-label="${label}"]`, { timeout: LOAD_TIMEOUT }).filter(':visible').first().click()
}

function check() {
  notProcessing()
  cy.get('[data-testid="rewrite-check"]', { timeout: LOAD_TIMEOUT }).should('be.visible').click()
  cy.get('[data-testid="rewrite-check"]', { timeout: LOAD_TIMEOUT }).should('have.class', 'completed')
}

function openRewriteLevel(n: number, world = 'Rewrite') {
  visit(level(world, n))
  expectRewriteOnlyLevel()
}

/** Rewrite with a rule at `path` on one side, as dragging it onto that term does. */
function rewrite(rule: string, side: 'left' | 'right', path: number[] = [], isReverse = false) {
  notProcessing()
  let before = ''
  cy.get('.tr-expr-wrapper', { timeout: LOAD_TIMEOUT }).then($row => { before = relationText($row) })
  cy.window().then(win => (win as HarnessWindow).__visualTestHarness!.rewriteGoalInTransform(rule, side, path, isReverse))
  // The next move has to see this one's result.
  cy.get('.tr-expr-wrapper', { timeout: LOAD_TIMEOUT }).should($row => {
    expect(relationText($row)).not.to.equal(before)
  })
}

function harness<T>(run: (harness: NonNullable<HarnessWindow['__visualTestHarness']>) => T) {
  notProcessing()
  cy.window().then(win => run((win as HarnessWindow).__visualTestHarness!))
}

function goalShouldBe(text: string) {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    const current = (win as HarnessWindow).__visualTestHarness!
    expect(current.getProofAudit().processing).to.equal(false)
    expect(current.getCurrentStreamSnapshot().goalType).to.equal(text)
  })
}

function goalHintShouldContain(text: string) {
  cy.contains(text, { timeout: LOAD_TIMEOUT }).should('be.visible')
}

function shouldBeCompleted() {
  cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
    expect((win as HarnessWindow).__visualTestHarness!.getProofAudit().completed).to.equal(true)
  })
}

/** Drag with the pointer, as a player does, from one element onto another. The
 * events come from the app's own window, with time for React to commit between
 * them, as in the playthrough driver. */
function dragWithPointer(source: string, target: string) {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  cy.get(source, { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.get(target, { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.window().then(async win => {
    const sourceRect = win.document.querySelector(source)!.getBoundingClientRect()
    const targetRect = win.document.querySelector(target)!.getBoundingClientRect()
    const startX = sourceRect.left + sourceRect.width / 2
    const startY = sourceRect.top + sourceRect.height / 2
    const endX = targetRect.left + targetRect.width / 2
    const endY = targetRect.top + targetRect.height / 2
    const Pointer = (win as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent
    const event = (type: string, clientX: number, clientY: number, buttons: number) => new Pointer(type, {
      bubbles: true, cancelable: true, pointerId: 91, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX, clientY,
    })
    win.document.querySelector(source)!.dispatchEvent(event('pointerdown', startX, startY, 1))
    win.document.body.dispatchEvent(event('pointermove', startX + 12, startY + 12, 1))
    await sleep(100)
    win.document.body.dispatchEvent(event('pointermove', endX, endY, 1))
    await sleep(200)
    win.document.body.dispatchEvent(event('pointermove', endX + 1, endY + 1, 1))
    await sleep(200)
    win.document.body.dispatchEvent(event('pointerup', endX + 1, endY + 1, 0))
  })
}

function expectRewriteOnlyLevel() {
  // Rewrite-only: the level opens in Rewrite Mode with no way back.
  cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
  cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
  cy.get('.tr-back-btn').should('not.exist')
}

/** Move to the unsolved proof branch with the arrow buttons. */
function nextUnsolvedBranch() {
  notProcessing()
  cy.get('[data-testid^="stream-nav-"].toward-incomplete:not(:disabled)', { timeout: LOAD_TIMEOUT })
    .filter(':visible').first().click()
}

describe('Natural Numbers Video Game', () => {
  beforeEach(() => {
    cy.intercept({ url: /\/v[12]\/(events|feedback)/u }, { statusCode: 204 })
  })

  it('opens on a path map where only the welcome text can be played', () => {
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).should('be.visible')
    cy.get('[data-testid="path-map-world-label"]').then($labels => {
      expect([...$labels].map(label => label.textContent)).to.have.members([
        'Rewrite World',
        'Proposition World',
        'Induction World',
      ])
    })
    mapLevel('Intro', 1).should('have.attr', 'data-state', 'frontier').and('have.attr', 'data-text-level', 'true')
    mapLevel('Rewrite', 1).should('have.attr', 'data-state', 'locked')
    mapLevel('Proposition', 1).should('have.attr', 'data-state', 'locked')
    mapLevel('RewriteBonus', 1).should('have.attr', 'data-state', 'locked')
    cy.get('[data-segment="edge:Intro:Rewrite:in"]').should('have.attr', 'data-lit', 'false')

    // A text level opens over the map; closing it completes the level.
    mapLevel('Intro', 1).click()
    cy.get('[data-testid="text-level-dialog"]').should('contain.text', 'Welcome to the Natural Numbers Video Game!')
    cy.get('[data-testid="text-level-dialog"] em').should('have.text', 'is')
    cy.location('pathname').should('match', /\/g\/local\/NNVG\/visual$/u)
    cy.contains('button', 'Continue').click()
    cy.get('[data-testid="text-level-dialog"]').should('not.exist')
    mapLevel('Intro', 1).should('have.attr', 'data-state', 'completed')
    mapLevel('Rewrite', 1).should('have.attr', 'data-state', 'frontier')
    mapLevel('Proposition', 1).should('have.attr', 'data-state', 'frontier')
    mapLevel('Rewrite', 2).should('have.attr', 'data-state', 'locked')
    cy.get('[data-segment="edge:Intro:Rewrite:in"]').should('have.attr', 'data-lit', 'true')
    cy.get('[data-segment="edge:Intro:Proposition:in"]').should('have.attr', 'data-lit', 'true')
  })

  it('draws the larger structure: forks, joins, bonus rows and boss levels', () => {
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).should('be.visible')
    // Boss levels are drawn larger, once the level data has loaded.
    mapLevel('Rewrite', 6).should('have.attr', 'data-boss', 'true')
    mapLevel('Induction', 3).should('have.attr', 'data-boss', 'true')
    mapLevel('Rewrite', 5).should('not.have.attr', 'data-boss')
    mapLevel('Rewrite', 5).find('circle').then($small => {
      mapLevel('Rewrite', 6).find('circle').then($boss => {
        expect(Number($boss.attr('r'))).to.be.greaterThan(Number($small.attr('r')))
      })
    })
    // Rewrite World leads to Induction World; Proposition World forks into it too.
    for (const segment of [
      'edge:Rewrite:Induction:in',
      'edge:Induction:InductionJoined:in',
      'edge:Proposition:InductionJoined:in',
      'edge:Proposition:PropositionRight:in',
      'bonus:Rewrite:3:RewriteBonus',
      'bonus:PropositionRight:1:PropositionBonus',
      'bonus:Induction:3:InductionBonus',
    ]) {
      cy.get(`[data-segment="${segment}"]`).should('exist')
    }
    // Numbering restarts per stream, and bonuses are numbered as in the spec.
    mapLevel('RewriteBonus', 2).should('contain.text', 'A2')
    mapLevel('PropositionRight', 1).should('contain.text', '6')
    mapLevel('InductionJoined', 1).should('contain.text', '4')
    // The barrier: nothing leads past Induction World's boss yet.
    mapLevel('InductionJoined', 1).should('have.attr', 'data-state', 'locked')
  })

  it('plays the first Rewrite World levels with clicks and the check mark', () => {
    // Progress is saved on a short delay, so move between levels the way a
    // player does (map, Next, Back to map) instead of reloading pages.
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).click()
    cy.contains('button', 'Continue').click()
    mapLevel('Rewrite', 1).should('have.attr', 'data-state', 'frontier').click()

    // Level 0: substitutions, then the check mark; no direction button yet.
    expectRewriteOnlyLevel()
    cy.get('.tr-direction-btn').should('not.exist')
    lessonsShouldContain('Drag a hypothesis onto a term')
    relationShouldBe('x + y = 1 + 2')
    cy.get('[data-testid="rewrite-check"]').should('not.exist')
    // Cards show Lean's `hypothesis_1` the way Visual Lean shows such names.
    clickRule('hypothesis1')
    relationShouldBe('1 + y = 1 + 2')
    clickRule('hypothesis2')
    relationShouldBe('1 + 2 = 1 + 2')
    lessonsShouldContain('check mark')
    check()
    cy.get('.visual-header.completed', { timeout: LOAD_TIMEOUT }).should('exist')

    // Level 1: many substitutions, each click rewriting its only match.
    cy.get('.visual-header-next-btn').filter(':visible').first().should('not.be.disabled').click()
    cy.location('pathname').should('contain', '/world/Rewrite/level/2/visual')
    expectRewriteOnlyLevel()
    lessonsShouldContain('many substitutions')
    lessonsShouldContain('reading left to right')
    relationShouldBe('0 = (a + b) + c')
    clickRule('hypothesis_a')
    clickRule('hypothesis_b')
    clickRule('hypothesis_c')
    relationShouldBe('0 = (0 + 0) + 0')
    clickRule('zero_add_zero')
    relationShouldBe('0 = 0 + 0')
    clickRule('zero_add_zero')
    relationShouldBe('0 = 0')
    check()

    // Level 2: the direction button rewrites backwards.
    cy.get('.visual-header-next-btn').filter(':visible').first().should('not.be.disabled').click()
    cy.location('pathname').should('contain', '/world/Rewrite/level/3/visual')
    expectRewriteOnlyLevel()
    lessonsShouldContain('forwards and backwards')
    cy.get('.tr-direction-btn').should('be.visible').click()
    clickRule('hypothesis_x')
    relationShouldBe('0 + y = 0')
    clickRule('hypothesis_y')
    relationShouldBe('0 + 0 = 0')
    cy.get('.tr-direction-btn').click()
    clickRule('zero_add_zero')
    relationShouldBe('0 = 0')
    check()

    // The bonus sprouts after level 2 without holding up level 3.
    cy.get('.visual-header-map-btn').filter(':visible').first().click()
    mapLevel('Rewrite', 3).should('have.attr', 'data-state', 'completed')
    mapLevel('Rewrite', 4).should('have.attr', 'data-state', 'frontier')
    mapLevel('RewriteBonus', 1).should('have.attr', 'data-state', 'frontier')
    cy.get('[data-segment="bonus:Rewrite:3:RewriteBonus"]').should('have.attr', 'data-lit', 'true')
  })

  it('uses a ∀ hypothesis as a rule anywhere it fits', () => {
    openRewriteLevel(4)
    cy.get('.tr-rule-card[data-rule-label="add_comm"] .tr-forall-footer.visual-forall-emphasize').should('exist')
    clickRule('hx')
    clickRule('hy')
    clickRule('hz')
    relationShouldBe('(1 + 2) + 3 = 3 + (2 + 1)')
    // A click rewrites the first match reading left to right: the whole side.
    clickRule('add_comm')
    relationShouldBe('3 + (1 + 2) = 3 + (2 + 1)')
    // Then swap the inner pair where it is.
    notProcessing()
    cy.window().then(win => (win as HarnessWindow).__visualTestHarness!.rewriteGoalInTransform('add_comm', 'left', [2]))
    relationShouldBe('3 + (2 + 1) = 3 + (2 + 1)')
    check()
  })

  it('shows fractions vertically and plays them like any other term', () => {
    openRewriteLevel(5)
    // Both on the goal and on the rule cards.
    cy.get('.tr-expr-wrapper .formula-fraction').should('have.length', 3)
    cy.get('.tr-expr-wrapper .formula-fraction').first().should('have.attr', 'aria-label', '1/2')
    cy.get('.tr-expr-wrapper .formula-fraction').eq(1).should('have.attr', 'aria-label', '1/4')
    cy.get('.tr-rule-card[data-rule-label="h_fourths"] .formula-fraction').should('have.length.at.least', 3)
    clickRule('add_assoc')
    relationShouldBe('frac1over2 + (frac1over4 + frac1over4) = 1')
    cy.get('.tr-direction-btn').should('be.visible').click()
    clickRule('h_fourths')
    relationShouldBe('frac1over2 + frac1over2 = 1')
    clickRule('h_halves')
    relationShouldBe('1 = 1')
    check()
    cy.get('.visual-header.completed', { timeout: LOAD_TIMEOUT }).should('exist')
  })

  it('plays the Rewrite World boss', () => {
    openRewriteLevel(6)
    lessonsShouldContain('final boss of Rewriting World')
    relationShouldBe('((((1 + 1) + 1) + 1) + 1) + 1 = (1 + 2) + 3')
    rewrite('h_two', 'left', [1, 1, 1, 1])
    rewrite('add_comm', 'left', [1, 1, 1])
    rewrite('h_three', 'left', [1, 1, 1])
    rewrite('h_three', 'right', [1])
    relationShouldBe('((3 + 1) + 1) + 1 = 3 + 3')
    rewrite('add_assoc', 'left', [1])
    rewrite('h_two', 'left', [1, 2])
    rewrite('add_assoc', 'left')
    rewrite('add_comm', 'left', [2])
    rewrite('h_three', 'left', [2])
    relationShouldBe('3 + 3 = 3 + 3')
    check()
  })

  // The app leaves StrictMode off when it sees Cypress, so these hide Cypress from
  // it. StrictMode's second run of a mount's effects used to set off a render loop
  // on levels whose cards have to move away from their starting places.
  for (const n of [5, 6]) {
    it(`opens Rewrite World's Lean level ${n} with StrictMode on`, () => {
      cy.visit(level('Rewrite', n), {
        onBeforeLoad(win) {
          win.localStorage.setItem('telemetryConsent', 'refused')
          delete (win as unknown as { Cypress?: unknown }).Cypress
        },
      })
      cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
      cy.contains('Maximum update depth').should('not.exist')
    })
  }

  it('shows the inverse bonus level with · and ⁻¹', () => {
    openRewriteLevel(2, 'RewriteBonus')
    cy.get('.tr-expr-wrapper .tr-op').first().should('have.text', '·')
    cy.get('.tr-expr-wrapper').should('contain.text', 'a⁻¹')
    cy.get('.tr-rule-card[data-rule-label="generate_a_inv"] h3').should('have.text', 'generate_a⁻¹')
    cy.get('.tr-rule-card[data-rule-label="generate_a_inv"] .tr-symbol').should('contain.text', 'x · a⁻¹')
    rewrite('generate_a', 'left', [1, 1, 1, 1], true)
    rewrite('generate_a_inv', 'left', [1, 1, 1], true)
    rewrite('generate_a', 'left', [1, 1], true)
    rewrite('generate_a', 'left', [1], true)
    rewrite('generate_a_inv', 'left', [], true)
    rewrite('hx', 'left')
    relationShouldBe('1 = 1')
    check()
  })

  it('plays Proposition World on the canvas', () => {
    visit(level('Proposition', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.contains('Goals can be proven by dragging over a proposition that matches it!').should('be.visible')
    notProcessing()
    cy.window().then(win => (win as HarnessWindow).__visualTestHarness!.dragHypToGoal('h'))
    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      expect((win as HarnessWindow).__visualTestHarness!.getProofAudit().completed).to.equal(true)
    })
  })

  it('sends the player back to the map at the fork after Proposition World level 5', () => {
    visit(level('Proposition', 6))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.visual-header-next-btn').filter(':visible').first().should('contain.text', 'World Map')
  })

  it('guides an ‘or’ goal through its dead ends', () => {
    visit(level('PropositionRight', 1))
    goalHintShouldContain('you must choose to prove either the left side or the right side')

    // Choosing Z is a dead end.
    harness(h => h.clickGoal('click_goal_left'))
    goalShouldBe('Z')
    goalHintShouldContain("We don't have any way of proving")
    cy.get('button[aria-label="Reset level"]').filter(':visible').should('exist').first().then($reset => {
      const box = $reset[0]!.getBoundingClientRect()
      expect(box.left, 'reset button is on the left').to.be.lessThan(Cypress.config('viewportWidth') / 2)
      expect(box.top, 'reset button is at the bottom').to.be.greaterThan(Cypress.config('viewportHeight') / 2)
    })
    cy.get('button[aria-label="Reset level"]').filter(':visible').first().click()

    // The right side is the way forward.
    harness(h => h.clickGoal('click_goal_right'))
    goalHintShouldContain('hypotheses can be split by')
    harness(h => h.clickGoal())
    goalShouldBe('B ∨ A')
    goalHintShouldContain('reachable from both sides')

    // Splitting the goal before the hypothesis is a dead end.
    harness(h => h.clickGoal('click_goal_left'))
    goalShouldBe('B')
    goalHintShouldContain('depend on which branch')
  })

  it('finishes the ‘or’ level by splitting the hypothesis first', () => {
    visit(level('PropositionRight', 1))
    harness(h => h.clickGoal('click_goal_right'))
    goalShouldBe('A ∨ B → B ∨ A')
    harness(h => h.clickGoal())
    goalShouldBe('B ∨ A')
    cy.get('[data-testid="hyp-card"]', { timeout: LOAD_TIMEOUT }).filter('[data-hyp-type="A ∨ B"]').first()
      .invoke('attr', 'data-hyp-name').then(name => {
        harness(h => h.clickHyp(name as string))
      })
    // With the hypothesis split, the goal no longer warns about it.
    cy.contains('reachable from both sides').should('not.exist')
    goalShouldBe('B ∨ A')
    harness(h => h.clickGoal('click_goal_right'))
    goalShouldBe('A')
    cy.contains('depend on which branch').should('not.exist')
    harness(h => h.dragHypToGoal('left'))
    nextUnsolvedBranch()
    goalShouldBe('B ∨ A')
    harness(h => h.clickGoal('click_goal_left'))
    goalShouldBe('B')
    harness(h => h.dragHypToGoal('right'))
    shouldBeCompleted()
  })

  it('lets a False hypothesis prove any goal, by dragging it', () => {
    visit(level('PropositionRight', 2))
    goalHintShouldContain('hypothesis can prove')
    cy.contains('em', 'anything').should('be.visible')
    notProcessing()
    dragWithPointer('[data-testid="hyp-card"][data-hyp-type="False"]', '[data-testid="goal-card"]')
    shouldBeCompleted()
  })

  it('plays Induction World with S, in axiom colours', () => {
    openRewriteLevel(1, 'Induction')
    lessonsShouldContain('‘successor function’')
    relationShouldBe('S(S(0)) = 2')
    cy.get('.tr-rule-card[data-rule-label="one_eq_succ_zero"]').filter(':visible').first()
      .should('have.attr', 'data-rule-axiom', 'true')
      .and('have.class', 'tr-axiom-card')
      .find('.tr-symbol').should('contain.text', 'S(0)')
    rewrite('MyNat.one_eq_succ_zero', 'left', [1], true)
    relationShouldBe('S(1) = 2')
    rewrite('MyNat.two_eq_succ_one', 'left', [], true)
    relationShouldBe('2 = 2')
    check()
  })

  it('proves the theorem level with the axioms', () => {
    openRewriteLevel(2, 'Induction')
    lessonsShouldContain('just from these axioms')
    relationShouldBe('a + 1 = S(a)')
    cy.get('.tr-rule-card[data-rule-label="add_zero"]').should('have.attr', 'data-rule-axiom', 'true')
    cy.get('.tr-rule-card[data-rule-label="add_succ"]').should('have.attr', 'data-rule-axiom', 'true')
    rewrite('MyNat.one_eq_succ_zero', 'left', [2])
    rewrite('MyNat.add_succ', 'left')
    rewrite('MyNat.add_zero', 'left', [1])
    relationShouldBe('S(a) = S(a)')
    check()
  })

  it('offers the proved theorem, not in the axiom colour, in the Induction World boss', () => {
    openRewriteLevel(3, 'Induction')
    lessonsShouldContain('‘theorem’ levels')
    cy.get('.tr-nav-btn.visual-emphasize-btn').should('exist')
    cy.contains('.tr-tab-btn', 'Theorems').click()
    cy.get('.tr-rule-card[data-rule-label="add_one_eq_succ"]').should('exist').and('not.have.attr', 'data-rule-axiom')
    rewrite('MyNat.add_one_eq_succ', 'left')
    rewrite('MyNat.add_one_eq_succ', 'left', [1])
    rewrite('MyNat.add_one_eq_succ', 'left', [1, 1])
    relationShouldBe('S(S(S(1))) = 4')
    rewrite('MyNat.four_eq_succ_three', 'right')
    rewrite('MyNat.three_eq_succ_two', 'right', [1])
    rewrite('MyNat.two_eq_succ_one', 'right', [1, 1])
    relationShouldBe('S(S(S(1))) = S(S(S(1)))')
    check()
  })

  it('plays the ported 2 + 2 = 4 bonus', () => {
    openRewriteLevel(1, 'InductionBonus')
    relationShouldBe('2 + 2 = 4')
    rewrite('MyNat.two_eq_succ_one', 'left', [2])
    rewrite('MyNat.add_succ', 'left')
    rewrite('MyNat.one_eq_succ_zero', 'left', [1, 2])
    rewrite('MyNat.add_succ', 'left', [1])
    rewrite('MyNat.add_zero', 'left', [1, 1])
    rewrite('MyNat.three_eq_succ_two', 'left', [1], true)
    rewrite('MyNat.four_eq_succ_three', 'left', [], true)
    relationShouldBe('4 = 4')
    check()
  })

  it('proves zero_add by induction on the canvas', () => {
    visit(level('InductionJoined', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    goalShouldBe('0 + n = n')
    harness(h => h.dragTacticToHyp('induction', 'n'))
    goalShouldBe('0 + 0 = 0')
    goalHintShouldContain('to enter Rewrite Mode')

    // The base case.
    notProcessing()
    cy.get('[data-testid="goal-card"]').filter(':visible').first().dblclick()
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    clickRule('add_zero')
    relationShouldBe('0 = 0')
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    harness(h => h.clickGoal())

    // The inductive step.
    nextUnsolvedBranch()
    goalShouldBe('0 + S d = S d')
    notProcessing()
    cy.get('[data-testid="goal-card"]').filter(':visible').first().dblclick()
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    clickRule('add_succ')
    relationShouldBe('S(0 + d) = S(d)')
    clickRule('hd')
    relationShouldBe('S(d) = S(d)')
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    harness(h => h.clickGoal())
    shouldBeCompleted()
  })

  it('leaves the bonus off Proposition World level 6 playable on the canvas', () => {
    visit(level('PropositionBonus', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    harness(h => h.clickGoal())
    goalShouldBe('B ∨ (A → C) → C ∨ A ∧ B ∨ (A ∨ B → C)')
    harness(h => h.clickGoal())
    goalShouldBe('C ∨ A ∧ B ∨ (A ∨ B → C)')
  })
})
