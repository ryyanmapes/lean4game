// The Natural Numbers Video Game (Lean4Game/NNVG) against the native dev relay:
// the path-style world map, the opening text level, Rewrite-only levels played with
// rule-card clicks and the check mark, Proposition World on the canvas, the light
// scheme, large windows, and what's painted frame by frame.
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
    openHypTransform(hypName: string): void
    openGoalTransform(): void
  }
}

/** What the player sees in one animation frame. */
interface PaintedFrame {
  theme: string | null
  header: boolean
  loading: boolean
  canvas: boolean
  overlay: boolean
  expression: boolean
  rules: boolean
  map: boolean
  firstLabel: string | null
  bossDrawn: boolean
}

type FrameWindow = Cypress.AUTWindow & { __frames: PaintedFrame[] }

function isShown(win: Window, element: Element | null) {
  if (!element) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && win.getComputedStyle(element).visibility !== 'hidden'
}

function recordFrames(win: Cypress.AUTWindow) {
  const frames: PaintedFrame[] = []
  ;(win as FrameWindow).__frames = frames
  const tick = () => {
    const doc = win.document
    frames.push({
      theme: doc.querySelector('.app')?.getAttribute('data-visual-theme') ?? null,
      header: isShown(win, doc.querySelector('.visual-header')),
      loading: !!doc.querySelector('.visual-loading'),
      canvas: isShown(win, doc.querySelector('[data-testid="goal-card"]')),
      overlay: !!doc.querySelector('.tr-transformation-overlay'),
      expression: isShown(win, doc.querySelector('.tr-expr-wrapper')),
      rules: isShown(win, doc.querySelector('.tr-rule-card')),
      map: !!doc.querySelector('[data-testid="visual-path-map"]'),
      firstLabel: doc.querySelector('[data-world="Intro"] .path-map-level-label')?.textContent ?? null,
      bossDrawn: !!doc.querySelector('[data-world="Rewrite"][data-level="6"][data-boss="true"]'),
    })
    win.requestAnimationFrame(tick)
  }
  win.requestAnimationFrame(tick)
}

/** Check the frames recorded since the last `clearFrames`. Animation frames can be rare
 * once a page is idle, so each check needs something a frame has to show, and this retries
 * until it does. A frame that breaks a check stays recorded, so that still fails. */
function framesShould(check: (frames: PaintedFrame[]) => void) {
  cy.window({ timeout: 30000 }).should(win => check((win as FrameWindow).__frames))
}

function clearFrames() {
  cy.window().then(win => { (win as FrameWindow).__frames.length = 0 })
}

function visit(url: string, options: { fresh?: boolean, record?: boolean } = {}) {
  cy.visit(url, {
    onBeforeLoad(win) {
      if (options.fresh) win.localStorage.clear()
      win.localStorage.setItem('telemetryConsent', 'refused')
      if (options.record) recordFrames(win)
    },
  })
}

/** Open the map with every level of these worlds (name to size) finished. */
function visitWithProgress(worlds: Record<string, number>) {
  const data = Object.fromEntries(Object.entries(worlds).map(([world, size]) => [world, Object.fromEntries(
    Array.from({ length: size }, (_, index) => [index + 1, { code: '', selections: [], completed: true, help: [] }]),
  )]))
  cy.visit(MAP, {
    onBeforeLoad(win) {
      win.localStorage.clear()
      win.localStorage.setItem('telemetryConsent', 'refused')
      win.localStorage.setItem('game_progress', JSON.stringify({
        games: { 'g/local/nnvg': { inventory: [], difficulty: 2, readIntro: true, data } },
      }))
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

/** A hint is on the page. (Hints let clicks through, so Cypress counts them as
 * covered by whatever is under them; their text is what matters here.) */
function hintShouldContain(text: string) {
  cy.contains(text, { timeout: LOAD_TIMEOUT }).should('exist')
}

/** Click the rule card labelled `label`, rewriting with the direction button set to
 * `reverse`, as a player does. */
function clickRuleInDirection(label: string, reverse: boolean) {
  notProcessing()
  cy.get('.tr-direction-btn').then($button => {
    if ($button.hasClass('active-reverse') !== reverse) cy.wrap($button).click()
  })
  clickRule(label)
}

/** The tip of an instruction arrow stops short of `target`, rather than running into it. */
function arrowStopsShortOf(arrow: string, target: string) {
  cy.get(`${arrow} polygon`, { timeout: LOAD_TIMEOUT }).should($polygon => {
    const [x, y] = $polygon.attr('points')!.split(' ')[0]!.split(',').map(Number)
    const box = Cypress.$(target)[0]!.getBoundingClientRect()
    const inside = x! > box.left && x! < box.right && y! > box.top && y! < box.bottom
    expect(inside, `arrow tip (${x}, ${y}) inside ${target}`).to.equal(false)
    const distance = Math.max(box.left - x!, x! - box.right, box.top - y!, y! - box.bottom)
    expect(distance, 'gap between the arrow tip and its target').to.be.within(2, 30)
  })
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

function openCanvasLevel(world: string, n: number) {
  visit(level(world, n))
  cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
}

function headerShouldNameLevel(number: string, title: string) {
  cy.get('.visual-header-level', { timeout: LOAD_TIMEOUT }).filter(':visible').first().should('contain.text', `- ${number}`)
  cy.get('.visual-header-title', { timeout: LOAD_TIMEOUT }).filter(':visible').first().should('contain.text', title)
}

/** Drag the card of this type onto the card of that type, with the pointer. */
function dragCard(sourceType: string, targetType: string) {
  notProcessing()
  dragWithPointer(`[data-testid="hyp-card"][data-hyp-type="${sourceType}"]`, `[data-testid="hyp-card"][data-hyp-type="${targetType}"]`)
}

function dragCardToGoal(sourceType: string) {
  notProcessing()
  dragWithPointer(`[data-testid="hyp-card"][data-hyp-type="${sourceType}"]`, '[data-testid="goal-card"]')
}

function clickGoal(playTactic?: string) {
  harness(h => h.clickGoal(playTactic))
}

function clickHyp(name: string) {
  harness(h => h.clickHyp(name))
}

function dragToGoal(name: string) {
  harness(h => h.dragHypToGoal(name))
}

function hypShouldExist(name: string) {
  notProcessing()
  cy.get(`[data-testid="hyp-card"][data-hyp-name="${name}"]`, { timeout: LOAD_TIMEOUT }).should('exist')
}

describe('Natural Numbers Video Game', () => {
  beforeEach(() => {
    cy.intercept({ url: /\/v[12]\/(events|feedback)/u }, { statusCode: 204 })
  })

  it('opens on a path map where only the welcome text can be played', () => {
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).should('be.visible')
    // The opening is centred on the map, however lopsided the map is further down.
    cy.get('[data-testid="visual-world-map"]').then($scroller => {
      const scroller = $scroller[0]!.getBoundingClientRect()
      mapLevel('Intro', 1).find('circle').then($circle => {
        const circle = $circle[0]!.getBoundingClientRect()
        expect(circle.left + circle.width / 2).to.be.closeTo(scroller.left + scroller.width / 2, 8)
      })
    })
    // A world's title is grey until one of its levels can be played.
    const titleOf = (text: string) => cy.contains('[data-testid="path-map-world-label"]', text)
    const lockedTitle = '#64748b'
    titleOf('Rewrite World').should('have.attr', 'data-unlocked', 'false').and('have.attr', 'fill', lockedTitle)
    titleOf('Proposition World').should('have.attr', 'data-unlocked', 'false').and('have.attr', 'fill', lockedTitle)
    titleOf('Successor World').should('have.attr', 'data-unlocked', 'false').and('have.attr', 'fill', lockedTitle)
    cy.get('[data-testid="path-map-world-label"]').then($labels => {
      expect([...$labels].map(label => label.textContent)).to.have.members([
        'Rewrite World',
        'Proposition World',
        'Successor World',
        'Induction World',
        '≠ World',
        'Multiplication World',
        'Power World',
        'Advanced Addition World',
        '≤ World',
        'Advanced Multiplication World',
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
    titleOf('Rewrite World').should('have.attr', 'data-unlocked', 'true').and('not.have.attr', 'fill', lockedTitle)
    titleOf('Proposition World').should('have.attr', 'data-unlocked', 'true').and('not.have.attr', 'fill', lockedTitle)
    titleOf('Successor World').should('have.attr', 'data-unlocked', 'false').and('have.attr', 'fill', lockedTitle)
  })

  it('draws the larger structure: forks, joins, bonus rows and boss levels', () => {
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).should('be.visible')
    // Boss levels are drawn larger, once the level data has loaded.
    mapLevel('Rewrite', 6).should('have.attr', 'data-boss', 'true')
    mapLevel('Successor', 3).should('have.attr', 'data-boss', 'true')
    mapLevel('SuccessorJoined', 2).should('have.attr', 'data-boss', 'true')
    mapLevel('PropositionRight', 7).should('have.attr', 'data-boss', 'true')
    mapLevel('NeqBoss', 1).should('have.attr', 'data-boss', 'true')
    mapLevel('Multiplication', 9).should('have.attr', 'data-boss', 'true')
    mapLevel('Power', 9).should('have.attr', 'data-boss', 'true')
    mapLevel('PowerBonus', 1).should('have.attr', 'data-boss', 'true')
    // Advanced Addition World ends at its boss, level 5.
    mapLevel('AdvAddition', 5).should('have.attr', 'data-boss', 'true')
    mapLevel('AdvAddition', 6).should('not.exist')
    mapLevel('LessOrEqual', 10).should('have.attr', 'data-boss', 'true')
    mapLevel('AdvMultiplication', 10).should('have.attr', 'data-boss', 'true')
    mapLevel('Rewrite', 5).should('not.have.attr', 'data-boss')
    mapLevel('Rewrite', 5).find('circle').then($small => {
      mapLevel('Rewrite', 6).find('circle').then($boss => {
        expect(Number($boss.attr('r'))).to.be.greaterThan(Number($small.attr('r')))
      })
    })
    // Rewrite World leads to Successor World; Proposition World forks into it too.
    // Successor World forks into Induction World and the ≠ World, which all of
    // Proposition World joins, and Induction World rejoins it for its last levels.
    for (const segment of [
      'edge:Rewrite:Successor:in',
      'edge:Successor:SuccessorJoined:in',
      'edge:Proposition:SuccessorJoined:in',
      'edge:Proposition:PropositionRight:in',
      'edge:SuccessorJoined:Induction:in',
      'edge:SuccessorJoined:Neq:in',
      'edge:PropositionRight:Neq:in',
      'edge:Neq:NeqJoined:in',
      'edge:Induction:NeqJoined:in',
      'edge:Induction:Multiplication:in',
      'edge:Multiplication:Power:in',
      'edge:NeqJoined:AdvAddition:in',
      'edge:AdvAddition:LessOrEqual:in',
      'edge:LessOrEqual:AdvMultiplication:in',
      // Advanced Multiplication World needs ≤ World and Multiplication World only.
      'edge:Multiplication:AdvMultiplication:in',
      // The End is joined by the final bosses of three worlds.
      'edge:Power:Outro:in',
      'edge:AdvMultiplication:Outro:in',
      'edge:NeqBoss:Outro:in',
      'bonus:NeqJoined:1:NeqBoss',
      'bonus:Power:9:PowerBonus',
      'bonus:Rewrite:3:RewriteBonus',
      'bonus:PropositionRight:2:PropositionBonus',
      'bonus:PropositionRight:7:PropositionBonusB',
    ]) {
      cy.get(`[data-segment="${segment}"]`).should('exist')
    }
    cy.get('[data-segment="edge:Power:AdvMultiplication:in"]').should('not.exist')
    cy.get('[data-segment="edge:AdvAddition:Outro:in"]').should('not.exist')
    // Multiplication World's path comes across the middle column, which is empty
    // there: no path crosses another, so nothing needs a bridge.
    cy.get('[data-testid="path-map-bridge"]').should('not.exist')
    // Successor World has no bonus levels.
    cy.get('[data-segment^="bonus:Successor"]').should('not.exist')
    // Numbering restarts per stream, and bonuses are numbered as in the spec.
    mapLevel('RewriteBonus', 1).should('contain.text', 'A1')
    mapLevel('RewriteBonus', 2).should('not.exist')
    mapLevel('Proposition', 7).should('contain.text', '6')
    mapLevel('PropositionRight', 1).should('contain.text', '7')
    mapLevel('PropositionRight', 7).should('contain.text', '13')
    mapLevel('PropositionBonus', 1).should('contain.text', 'A1')
    mapLevel('PropositionBonusB', 3).should('contain.text', 'B3')
    mapLevel('SuccessorJoined', 1).should('contain.text', '4')
    mapLevel('Neq', 1).should('contain.text', '0')
    mapLevel('Neq', 8).should('contain.text', '7')
    mapLevel('NeqJoined', 1).should('contain.text', '8')
    mapLevel('NeqBoss', 1).should('contain.text', '9')
    mapLevel('PowerBonus', 1).should('contain.text', 'A1')
    mapLevel('Outro', 1).should('have.attr', 'data-text-level', 'true')
    // The barrier: nothing leads past Successor World's boss yet.
    mapLevel('SuccessorJoined', 1).should('have.attr', 'data-state', 'locked')
  })

  it('lays out the later worlds with ≤ World to the right and The End at the bottom', () => {
    visit(MAP, { fresh: true })
    mapLevel('Outro', 1).should('exist')
    const centre = (world: string, n: number) => {
      const box = Cypress.$(`[data-testid="path-map-level"][data-world="${world}"][data-level="${n}"] circle`)[0]!
        .getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    cy.get('[data-testid="path-map-level"]').should('have.length', 90).then($levels => {
      // ≤ World leaves Advanced Addition World to the right, and Advanced
      // Multiplication World carries on below it.
      expect(centre('LessOrEqual', 1).x).to.be.greaterThan(centre('AdvAddition', 5).x + 50)
      expect(centre('LessOrEqual', 1).y).to.be.greaterThan(centre('AdvAddition', 5).y)
      expect(centre('AdvMultiplication', 1).x).to.be.closeTo(centre('LessOrEqual', 10).x, 1)
      expect(centre('AdvMultiplication', 1).y).to.be.greaterThan(centre('LessOrEqual', 10).y)
      // Power World carries on below Multiplication World on the far left.
      expect(centre('Power', 1).x).to.be.closeTo(centre('Multiplication', 9).x, 1)
      // The End is in the middle, below everything.
      const end = centre('Outro', 1)
      expect(end.x).to.be.closeTo(centre('Intro', 1).x, 1)
      for (const level of $levels.toArray()) {
        if (level.getAttribute('data-world') === 'Outro') continue
        const box = level.querySelector('circle')!.getBoundingClientRect()
        expect(box.bottom, `${level.getAttribute('data-world')} ${level.getAttribute('data-level')}`).to.be.lessThan(end.y)
      }
    })
    mapLevel('Outro', 1).should('contain.text', '?')
  })

  it('keeps every world title clear of the paths and the levels', () => {
    visit(MAP, { fresh: true })
    mapLevel('Outro', 1).should('exist')
    cy.get('[data-testid="path-map-world-label"]').should('have.length', 10).then($labels => {
      const svg = Cypress.$('[data-testid="visual-path-map"]')[0] as unknown as SVGSVGElement
      // Points along every path, and every level's circle, in the map's own units
      // (whatever the window scales it to).
      const points: { x: number, y: number, segment: string }[] = []
      for (const path of Array.from(svg.querySelectorAll<SVGPathElement>('[data-testid="path-map-segment"]'))) {
        const length = path.getTotalLength()
        for (let at = 0; at <= length; at += 4) {
          const point = path.getPointAtLength(at)
          points.push({ x: point.x, y: point.y, segment: path.getAttribute('data-segment')! })
        }
      }
      const circles = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-testid="path-map-level"] circle'))
        .map(circle => ({ x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')), r: Number(circle.getAttribute('r')) }))
      for (const label of $labels.toArray() as unknown as SVGTextElement[]) {
        const box = label.getBBox()
        const gapTo = (x: number, y: number) => Math.hypot(
          Math.max(box.x - x, 0, x - (box.x + box.width)),
          Math.max(box.y - y, 0, y - (box.y + box.height)))
        let nearest = { gap: Infinity, segment: '' }
        for (const point of points) {
          // A path is 16 wide, so its edge is 8 from its middle.
          const gap = gapTo(point.x, point.y) - 8
          if (gap < nearest.gap) nearest = { gap, segment: point.segment }
        }
        expect(nearest.gap, `gap between “${label.textContent}” and ${nearest.segment}`).to.be.greaterThan(3)
        const levelGap = Math.min(...circles.map(circle => gapTo(circle.x, circle.y) - circle.r))
        expect(levelGap, `gap between “${label.textContent}” and the nearest level`).to.be.greaterThan(3)
      }
    })
    // Power World is entered from straight above, so its title sits to the left of the
    // path; Advanced Multiplication World's sits to the right of its path.
    const titleOf = (text: string) => cy.contains('[data-testid="path-map-world-label"]', text)
    titleOf('Power World').should('have.attr', 'data-anchor', 'end')
    titleOf('Advanced Multiplication World').should('have.attr', 'data-anchor', 'start')
    titleOf('≤ World').should('have.attr', 'data-anchor', 'middle')
    titleOf('Rewrite World').should('have.attr', 'data-anchor', 'middle')
  })

  it('names a locked level with a lock, world bosses with their world, and nothing with a chili pepper', () => {
    visit(MAP, { fresh: true })
    mapLevel('Outro', 1).should('exist')
    const tooltipOf = (world: string, n: number) => {
      // Focus shows the name, as hovering does.
      mapLevel(world, n).focus()
      return cy.get('.map-level-name-tooltip')
    }
    const leave = (world: string, n: number) => {
      mapLevel(world, n).blur()
      cy.get('.map-level-name-tooltip').should('not.exist')
    }
    // The opening level can be played; everything else starts locked.
    tooltipOf('Intro', 1).should('have.text', 'Welcome')
    leave('Intro', 1)
    for (const [world, n, title] of [
      ['Rewrite', 6, 'On The Count of Three (Rewriting World Boss)'],
      ['PropositionRight', 7, 'The De Morgan\'s Law That Is Intuitionistically Valid (Proposition World Boss)'],
      ['SuccessorJoined', 2, 'Plug and Chug (Successor World Boss)'],
      ['NeqBoss', 1, 'Equality in ℕ is Decidable (≠ World Boss)'],
      ['Multiplication', 9, 'mul_assoc (Multiplication World Boss)'],
      ['Power', 9, 'add_sq (Power World Boss)'],
      ['AdvAddition', 5, 'add_right_eq_zero (Advanced Addition World Boss)'],
      ['LessOrEqual', 10, '≤ is Total (≤ World Boss)'],
      ['AdvMultiplication', 10, 'mul_left_cancel (Advanced Multiplication World Boss)'],
      // Bosses that aren't their world's last word keep a plain title.
      ['Successor', 3, 'Counting to Four'],
      ['AdvMultiplication', 5, 'le_mul_right'],
      ['LessOrEqual', 6, 'Antisymmetry'],
      ['Outro', 1, 'The End'],
    ] as const) {
      tooltipOf(world, n).should('have.text', `🔒 ${title}`)
      leave(world, n)
    }
    // No level's title has a pepper.
    cy.request('/data/g/local/NNVG/game.json').then(({ body }) => {
      const sizes = body.worldSize as Record<string, number>
      for (const [world, size] of Object.entries(sizes)) {
        for (let n = 1; n <= size; n += 1) {
          cy.request(`/data/g/local/NNVG/level__${world}__${n}.json`).then(({ body: level }) => {
            expect(level.title, `${world} ${n}`).not.to.contain('🌶')
          })
        }
      }
    })
  })

  it('opens The End once the three bosses before it are done', () => {
    visit(MAP, { fresh: true })
    mapLevel('Outro', 1).should('have.attr', 'data-state', 'locked')
    // Everything The End follows but the ≠ boss: it stays locked, with two of its paths lit.
    const done = {
      Intro: 1, Rewrite: 6, Proposition: 7, PropositionRight: 7, Successor: 3, SuccessorJoined: 2, Induction: 4,
      Neq: 8, NeqJoined: 1, Multiplication: 9, Power: 9, AdvAddition: 5, LessOrEqual: 10, AdvMultiplication: 10,
    }
    visitWithProgress(done)
    mapLevel('Outro', 1).should('have.attr', 'data-state', 'locked')
    cy.get('[data-segment="edge:Power:Outro:in"]').should('have.attr', 'data-lit', 'true')
    cy.get('[data-segment="edge:AdvMultiplication:Outro:in"]').should('have.attr', 'data-lit', 'true')
    cy.get('[data-segment="edge:NeqBoss:Outro:in"]').should('have.attr', 'data-lit', 'false')
    // Advanced Addition World's boss alone doesn't lead there: its path goes on to ≤ World.
    cy.get('[data-segment="edge:AdvAddition:LessOrEqual:in"]').should('have.attr', 'data-lit', 'true')
    // Without Advanced Multiplication World's boss it stays locked too.
    visitWithProgress({ ...done, NeqBoss: 1, AdvMultiplication: 9 })
    mapLevel('Outro', 1).should('have.attr', 'data-state', 'locked')
    cy.get('[data-segment="edge:AdvMultiplication:Outro:in"]').should('have.attr', 'data-lit', 'false')
    visitWithProgress({ ...done, NeqBoss: 1 })
    cy.get('[data-segment="edge:NeqBoss:Outro:in"]').should('have.attr', 'data-lit', 'true')
    mapLevel('Outro', 1).should('have.attr', 'data-state', 'frontier').click()
    cy.get('[data-testid="text-level-dialog"]').should('be.visible').and('contain.text', 'Thank you for playing!')
    cy.contains('.path-map-text-close', 'Continue').click()
    mapLevel('Outro', 1).should('have.attr', 'data-state', 'completed')
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
    // Rewrite World hides the swap-sides button throughout.
    cy.get('.tr-swap-btn').should('not.exist')
    lessonsShouldContain('Drag a hypothesis onto a term')
    relationShouldBe('x + y = 1 + 2')
    cy.get('[data-testid="rewrite-check"]').should('not.exist')
    // Cards show Lean's `hypothesis_1` the way Visual Lean shows such names.
    clickRule('hypothesis1')
    relationShouldBe('1 + y = 1 + 2')
    // The hint stays up after the first substitution, until the next one replaces it.
    lessonsShouldContain('Drag a hypothesis onto a term')
    clickRule('hypothesis2')
    relationShouldBe('1 + 2 = 1 + 2')
    lessonsShouldContain('check mark')
    cy.get('[data-testid="rewrite-lessons"]').should('not.contain.text', 'Drag a hypothesis onto a term')
    // Its arrow stops short of the check mark, once the mark has popped in.
    cy.get('[data-testid="rewrite-check"]').should('be.visible')
    cy.wait(400)
    arrowStopsShortOf('.check-guide-arrow', '[data-testid="rewrite-check"]')
    check()
    cy.get('.visual-header.completed', { timeout: LOAD_TIMEOUT }).should('exist')

    // Level 1: many substitutions, each click rewriting its only match.
    cy.get('.visual-header-next-btn').filter(':visible').first().should('not.be.disabled').click()
    cy.location('pathname').should('contain', '/world/Rewrite/level/2/visual')
    expectRewriteOnlyLevel()
    lessonsShouldContain('many substitutions')
    lessonsShouldContain('reading left to right')
    relationShouldBe('(x + y) + z = 0')
    // The specific hypotheses come first, then the general one.
    cy.get('.tr-rule-card').filter(':visible').then($cards => {
      expect([...$cards].map(card => card.getAttribute('data-rule-label')))
        .to.deep.equal(['hypothesis_x', 'hypothesis_y', 'hypothesis_z', 'zero_add_zero'])
    })
    clickRule('hypothesis_x')
    clickRule('hypothesis_y')
    clickRule('hypothesis_z')
    relationShouldBe('(0 + 0) + 0 = 0')
    clickRule('zero_add_zero')
    relationShouldBe('0 + 0 = 0')
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
    lessonsShouldContain('forwards and backwards')
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

  it('plays Proposition World on the canvas, with a card for `A : Prop`', () => {
    openCanvasLevel('Proposition', 1)
    headerShouldNameLevel('0', 'Basic Propositions')
    cy.contains('Goals can be proven by dragging over a proposition that matches it!').should('be.visible')
    cy.get('[data-testid="hyp-card"]').should('have.length', 2)
    cy.get('[data-testid="hyp-card"][data-hyp-type="Prop"]').should('have.length', 1)
    cy.get('[data-testid="hyp-card"][data-hyp-name="h"]').should('exist')
    notProcessing()
    cy.window().then(win => (win as HarnessWindow).__visualTestHarness!.dragHypToGoal('h'))
    cy.window({ timeout: LOAD_TIMEOUT }).should(win => {
      expect((win as HarnessWindow).__visualTestHarness!.getProofAudit().completed).to.equal(true)
    })
  })

  it('keeps the `A : Prop` cards clear of the proof graph, and drops the split hint at the split', () => {
    openCanvasLevel('Proposition', 6)
    headerShouldNameLevel('5', 'Conjunction (1)')
    cy.get('[data-testid="hyp-card"]').should('have.length', 4)
    cy.get('[data-testid="hyp-card"][data-hyp-type="Prop"]').should('have.length', 2)
    goalHintShouldContain('split into two proof branches')
    clickGoal()
    goalShouldBe('A')
    // That hint is only for before the split; the proof graph's takes over.
    cy.contains('split into two proof branches').should('not.exist')
    hintShouldContain('The proof is only complete when all proof branches are solved.')
    cy.get('[data-testid="hyp-card"][data-hyp-type="Prop"]').should('have.length', 2)
    // The cards make way for the graph, and stay below the header.
    cy.get('#visual-proof-tree-panel', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.wait(500)
    cy.get('[data-testid="hyp-card"]').should($cards => {
      const panel = Cypress.$('#visual-proof-tree-panel')[0]!.getBoundingClientRect()
      const header = Cypress.$('.visual-header')[0]!.getBoundingClientRect()
      for (const card of $cards.toArray()) {
        const box = card.getBoundingClientRect()
        const overlaps = box.left < panel.right && box.right > panel.left && box.top < panel.bottom && box.bottom > panel.top
        expect(overlaps, `${card.getAttribute('data-hyp-name')} over the proof graph`).to.equal(false)
        expect(box.top, `${card.getAttribute('data-hyp-name')} below the header`).to.be.at.least(header.bottom)
      }
    })
    dragToGoal('hA')
    nextUnsolvedBranch()
    goalShouldBe('B')
    dragToGoal('hB')
    shouldBeCompleted()
  })

  it('proves a goal backwards by dragging onto it', () => {
    openCanvasLevel('Proposition', 5)
    headerShouldNameLevel('4', 'Backwards Implications')
    goalHintShouldContain('You can also prove the goal backwards!')
    // Only the cards for `A B C : Prop`.
    cy.get('[data-testid="hyp-card"]').should('have.length', 3).each($card => {
      expect($card.attr('data-hyp-type')).to.equal('Prop')
    })
    goalShouldBe('B → ((A → B) → C) → C')
    clickGoal()
    goalShouldBe('((A → B) → C) → C')
    clickGoal()
    goalShouldBe('C')
    dragCardToGoal('(A → B) → C')
    goalShouldBe('A → B')
    clickGoal()
    goalShouldBe('B')
    dragCardToGoal('B')
    shouldBeCompleted()
  })

  it('sends the player back to the map at the fork after Proposition World level 6', () => {
    openCanvasLevel('Proposition', 7)
    headerShouldNameLevel('6', 'Conjunction (2)')
    cy.get('.visual-header-next-btn').filter(':visible').first().should('contain.text', 'World Map')
  })

  it('separates an ‘if and only if’ goal with a click, like ∧', () => {
    openCanvasLevel('PropositionRight', 1)
    headerShouldNameLevel('7', 'If and Only If (Conjunctions)')
    goalHintShouldContain('just means')
    goalHintShouldContain('to separate just like')
    notProcessing()
    cy.get('[data-testid="goal-card"]').filter(':visible').first().click()
    goalShouldBe('(A ∧ B) ∧ C → A ∧ B ∧ C')
    // The hint stays up after the move it describes, until another replaces it.
    goalHintShouldContain('to separate just like')

    clickGoal()
    goalShouldBe('A ∧ B ∧ C')
    clickHyp('h')
    hypShouldExist('left')
    clickHyp('left')
    hypShouldExist('left1')
    clickGoal()
    goalShouldBe('A')
    dragToGoal('left1')
    nextUnsolvedBranch()
    goalShouldBe('B ∧ C')
    clickGoal()
    goalShouldBe('B')
    dragToGoal('right1')
    nextUnsolvedBranch()
    goalShouldBe('C')
    dragToGoal('right')
    nextUnsolvedBranch()

    goalShouldBe('A ∧ B ∧ C → (A ∧ B) ∧ C')
    clickGoal()
    goalShouldBe('(A ∧ B) ∧ C')
    clickHyp('h')
    hypShouldExist('right')
    clickHyp('right')
    hypShouldExist('right1')
    clickGoal()
    goalShouldBe('A ∧ B')
    clickGoal()
    goalShouldBe('A')
    dragToGoal('left')
    nextUnsolvedBranch()
    goalShouldBe('B')
    dragToGoal('left1')
    nextUnsolvedBranch()
    goalShouldBe('C')
    dragToGoal('right1')
    shouldBeCompleted()
  })

  it('opens the ‘if and only if’ level for disjunctions', () => {
    openCanvasLevel('PropositionRight', 3)
    headerShouldNameLevel('9', 'If and Only If (Disjunctions)')
    goalShouldBe('(A ∨ B) ∨ C ↔ A ∨ B ∨ C')
    clickGoal()
    goalShouldBe('(A ∨ B) ∨ C → A ∨ B ∨ C')
  })

  it('guides an ‘or’ goal through its dead ends', () => {
    openCanvasLevel('PropositionRight', 2)
    headerShouldNameLevel('8', 'Disjunction')
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
    visit(level('PropositionRight', 2))
    harness(h => h.clickGoal('click_goal_right'))
    goalShouldBe('A ∨ B → B ∨ A')
    harness(h => h.clickGoal())
    goalShouldBe('B ∨ A')
    cy.get('[data-testid="hyp-card"]', { timeout: LOAD_TIMEOUT }).filter('[data-hyp-type="A ∨ B"]').first()
      .invoke('attr', 'data-hyp-name').then(name => {
        harness(h => h.clickHyp(name as string))
      })
    hypShouldExist('left')
    // With the hypothesis split, its hint stays up: both branches need finishing.
    goalHintShouldContain('reachable from both sides')
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
    visit(level('PropositionRight', 4))
    headerShouldNameLevel('10', 'The Principle of Explosion')
    goalHintShouldContain('hypothesis can prove')
    cy.contains('em', 'anything').should('be.visible')
    notProcessing()
    dragWithPointer('[data-testid="hyp-card"][data-hyp-type="False"]', '[data-testid="goal-card"]')
    shouldBeCompleted()
  })

  it('treats ¬ goals and cards as implications to False', () => {
    openCanvasLevel('PropositionRight', 5)
    headerShouldNameLevel('11', 'Negation (1)')
    goalHintShouldContain('just means')
    goalShouldBe('A → ¬¬A')
    clickGoal()
    goalShouldBe('¬¬A')
    clickGoal()
    goalShouldBe('False')
    dragCard('A', '¬A')
    dragCardToGoal('False')
    shouldBeCompleted()
  })

  it('proves a False goal backwards with a ¬ card too', () => {
    openCanvasLevel('PropositionRight', 6)
    headerShouldNameLevel('12', 'Negation (2)')
    goalShouldBe('¬(A ∧ ¬A)')
    clickGoal()
    goalShouldBe('False')
    clickHyp('h')
    hypShouldExist('right')
    dragCardToGoal('¬A')
    goalShouldBe('A')
    dragCardToGoal('A')
    shouldBeCompleted()
  })

  it('plays the Proposition World boss', () => {
    openCanvasLevel('PropositionRight', 7)
    headerShouldNameLevel('13', 'The De Morgan')
    cy.contains('em', 'other').should('be.visible')
    cy.contains('strong', 'not').should('be.visible').and('have.css', 'font-weight', '700')
    goalShouldBe('¬(A ∨ B) ↔ ¬A ∧ ¬B')
    clickGoal()
    goalShouldBe('¬(A ∨ B) → ¬A ∧ ¬B')
    clickGoal()
    goalShouldBe('¬A ∧ ¬B')
    clickGoal()
    goalShouldBe('¬A')
    clickGoal()
    goalShouldBe('False')
    dragToGoal('h')
    goalShouldBe('A ∨ B')
    clickGoal('click_goal_left')
    goalShouldBe('A')
    dragToGoal('h1')
    nextUnsolvedBranch()
    goalShouldBe('¬B')
    clickGoal()
    goalShouldBe('False')
    dragToGoal('h')
    goalShouldBe('A ∨ B')
    clickGoal('click_goal_right')
    goalShouldBe('B')
    dragToGoal('h1')
    nextUnsolvedBranch()

    goalShouldBe('¬A ∧ ¬B → ¬(A ∨ B)')
    clickGoal()
    goalShouldBe('¬(A ∨ B)')
    clickHyp('h')
    hypShouldExist('left')
    clickGoal()
    goalShouldBe('False')
    clickHyp('h')
    hypShouldExist('left1')
    dragToGoal('left')
    goalShouldBe('A')
    dragToGoal('left1')
    nextUnsolvedBranch()
    goalShouldBe('False')
    dragToGoal('right')
    goalShouldBe('B')
    dragToGoal('right1')
    shouldBeCompleted()
  })

  it('plays the other De Morgan’s law, leftwards', () => {
    openCanvasLevel('PropositionBonusB', 1)
    headerShouldNameLevel('B1', 'The Other De Morgan')
    goalHintShouldContain('intuitionistically valid')
    goalShouldBe('¬A ∨ ¬B → ¬(A ∧ B)')
    clickGoal()
    goalShouldBe('¬(A ∧ B)')
    clickGoal()
    goalShouldBe('False')
    clickHyp('h1')
    hypShouldExist('left')
    clickHyp('h')
    hypShouldExist('left1')
    goalShouldBe('False')
    dragToGoal('left1')
    goalShouldBe('A')
    dragToGoal('left')
    nextUnsolvedBranch()
    goalShouldBe('False')
    dragToGoal('right1')
    goalShouldBe('B')
    dragToGoal('right')
    shouldBeCompleted()
  })

  it('plays the other De Morgan’s law, rightwards with excluded middle', () => {
    openCanvasLevel('PropositionBonusB', 2)
    headerShouldNameLevel('B2', 'Law of Excluded Middle')
    goalHintShouldContain('not intuitionistically valid')
    goalHintShouldContain('∀ P, P ∨ ¬P')
    // hA, hB, and the cards for `A B : Prop`.
    cy.get('[data-testid="hyp-card"]').should('have.length', 4)
    clickGoal()
    goalShouldBe('¬A ∨ ¬B')
    clickHyp('hA')
    hypShouldExist('left')
    clickHyp('hB')
    hypShouldExist('left1')
    goalShouldBe('¬A ∨ ¬B')
    clickGoal('click_goal_left')
    goalShouldBe('¬A')
    clickGoal()
    goalShouldBe('False')
    dragToGoal('h')
    goalShouldBe('A ∧ B')
    clickGoal()
    goalShouldBe('A')
    dragToGoal('left')
    nextUnsolvedBranch()
    goalShouldBe('B')
    dragToGoal('left1')
    nextUnsolvedBranch()
    goalShouldBe('¬A ∨ ¬B')
    clickGoal('click_goal_right')
    goalShouldBe('¬B')
    dragToGoal('right')
    nextUnsolvedBranch()
    goalShouldBe('¬A ∨ ¬B')
    clickGoal('click_goal_left')
    goalShouldBe('¬A')
    dragToGoal('right')
    shouldBeCompleted()
  })

  it('plays the other De Morgan’s law, rightwards with weak excluded middle', () => {
    openCanvasLevel('PropositionBonusB', 3)
    headerShouldNameLevel('B3', 'Weak Law of Excluded Middle')
    // A title this long gets its own line, and all of it shows.
    cy.get('.visual-header-title').filter(':visible').first().should($title => {
      expect($title[0]!.scrollWidth).to.be.at.most($title[0]!.clientWidth + 1)
    })
    goalHintShouldContain('do better than requiring')
    clickGoal()
    goalShouldBe('¬A ∨ ¬B')
    clickHyp('hA')
    hypShouldExist('left')
    clickGoal('click_goal_left')
    goalShouldBe('¬A')
    dragToGoal('left')
    nextUnsolvedBranch()
    goalShouldBe('¬A ∨ ¬B')
    clickHyp('hB')
    hypShouldExist('left')
    clickGoal('click_goal_right')
    goalShouldBe('¬B')
    dragToGoal('left')
    nextUnsolvedBranch()
    goalShouldBe('¬A ∨ ¬B')
    clickGoal('click_goal_left')
    goalShouldBe('¬A')
    clickGoal()
    goalShouldBe('False')
    dragToGoal('right1')
    goalShouldBe('¬B')
    clickGoal()
    goalShouldBe('False')
    dragToGoal('h')
    goalShouldBe('A ∧ B')
    clickGoal()
    goalShouldBe('A')
    dragToGoal('h1')
    nextUnsolvedBranch()
    goalShouldBe('B')
    dragToGoal('h2')
    shouldBeCompleted()
  })

  it('offers the light scheme with a toggle to the left of the menu, and keeps it', () => {
    visit(MAP, { fresh: true })
    mapLevel('Intro', 1).should('be.visible')
    cy.get('.app').should('have.attr', 'data-visual-theme', 'dark')
    cy.get('.visual-map-theme-toggle').should('be.visible').then($toggle => {
      cy.get('.visual-map-menu-btn').should($menu => {
        expect($toggle[0]!.getBoundingClientRect().right).to.be.at.most($menu[0]!.getBoundingClientRect().left)
      })
    })
    cy.get('.visual-map-theme-toggle').click()
    cy.get('.app').should('have.attr', 'data-visual-theme', 'light')
    cy.document().its('documentElement').should(html => {
      expect(html.style.backgroundColor).to.equal('rgb(248, 250, 252)')
    })

    // A reload never paints the app dark first.
    cy.visit(MAP, { onBeforeLoad: win => recordFrames(win) })
    mapLevel('Intro', 1).should('be.visible')
    framesShould(frames => {
      const themes = frames.map(frame => frame.theme).filter(theme => theme !== null)
      expect(themes.length, 'frames with the app').to.be.greaterThan(0)
      expect(themes.filter(theme => theme !== 'light'), 'frames not in the light scheme').to.deep.equal([])
    })

    // Levels follow the map.
    visit(level('Proposition', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.app').should('have.attr', 'data-visual-theme', 'light')

    // Back to dark, for good.
    visit(MAP)
    cy.get('.visual-map-theme-toggle').should('be.visible').click()
    cy.get('.app').should('have.attr', 'data-visual-theme', 'dark')
    cy.visit(MAP)
    mapLevel('Intro', 1).should('be.visible')
    cy.get('.app').should('have.attr', 'data-visual-theme', 'dark')
  })

  it('scales the interface up on large windows, without breaking dragging', () => {
    const rootFont = (doc: Document) => Number.parseFloat(doc.defaultView!.getComputedStyle(doc.documentElement).fontSize)
    const mapWidth = (expected: number) => {
      cy.get('[data-testid="visual-path-map"]', { timeout: LOAD_TIMEOUT }).should($map => {
        expect($map[0]!.getBoundingClientRect().width).to.be.closeTo(expected, 8)
      })
    }
    // The map's natural width is 1280: it fits a small window, and grows on a large one.
    cy.viewport(1280, 720)
    visit(MAP, { fresh: true })
    mapWidth(1232)
    cy.document().should(doc => { expect(rootFont(doc)).to.equal(16) })

    cy.viewport(2560, 1440)
    cy.document().should(doc => { expect(rootFont(doc)).to.be.closeTo(28.44, 0.1) })
    mapWidth(1280 * 28.44 / 16)

    visit(level('Proposition', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.visual-header').then($header => {
      const header = $header[0]!.getBoundingClientRect()
      expect(header.height, 'the header grows too').to.be.closeTo(52 * 28.44 / 16, 2)
      cy.get('.visual-header-map-btn').should($button => {
        expect($button[0]!.getBoundingClientRect().bottom, 'its buttons fit').to.be.at.most(header.bottom)
      })
    })
    dragCardToGoal('A')
    shouldBeCompleted()
    cy.viewport(1000, 660)
  })

  describe('never flashes', () => {
    it('opens a Rewrite-only level straight into Rewrite Mode, complete', () => {
      visit(level('Rewrite', 5), { record: true })
      expectRewriteOnlyLevel()
      framesShould(frames => {
        expect(frames.filter(frame => frame.expression).length, 'frames with the expression').to.be.greaterThan(0)
        expect(frames.filter(frame => frame.canvas && !frame.overlay), 'frames with just the canvas').to.deep.equal([])
        expect(frames.filter(frame => frame.expression && !frame.rules), 'frames with the expression but no rules').to.deep.equal([])
      })
    })

    it('keeps the header on screen from one level to the next', () => {
      visit(level('Rewrite', 5), { record: true })
      expectRewriteOnlyLevel()
      clearFrames()
      cy.get('.visual-header-prev-btn').filter(':visible').first().click()
      cy.location('pathname').should('contain', '/world/Rewrite/level/4/visual')
      expectRewriteOnlyLevel()
      headerShouldNameLevel('3', 'General Rewriting (Commutativity)')
      framesShould(frames => {
        expect(frames.some(frame => frame.loading), 'the level did load').to.equal(true)
        expect(frames.filter(frame => !frame.header), 'frames without the header').to.deep.equal([])
      })
    })

    it('paints the map complete, the first time and on coming back', () => {
      visit(level('Rewrite', 5), { record: true })
      expectRewriteOnlyLevel()
      for (let trip = 0; trip < 2; trip += 1) {
        clearFrames()
        cy.get('.visual-header-map-btn').filter(':visible').first().click()
        mapLevel('Rewrite', 6).should('have.attr', 'data-boss', 'true')
        framesShould(frames => {
          const painted = frames.filter(frame => frame.firstLabel !== null)
          expect(painted.length, 'frames with the map').to.be.greaterThan(0)
          expect(painted.filter(frame => frame.firstLabel !== '?'), 'frames with a provisional label').to.deep.equal([])
          expect(painted.filter(frame => !frame.bossDrawn), 'frames with a small boss').to.deep.equal([])
        })
        // Back to the level, which is still locked on the map.
        cy.go('back')
        expectRewriteOnlyLevel()
      }
    })

    it('enters Rewrite Mode with its rules, from the canvas', () => {
      visit(level('Induction', 1), { record: true })
      cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
      clickGoal()
      goalShouldBe('0 + n = n')
      harness(h => h.dragTacticToHyp('induction', 'n'))
      goalShouldBe('0 + 0 = 0')
      notProcessing()
      clearFrames()
      cy.get('[data-testid="goal-card"]').filter(':visible').first().dblclick()
      cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
      framesShould(frames => {
        expect(frames.filter(frame => frame.expression).length, 'frames with the expression').to.be.greaterThan(0)
        expect(frames.filter(frame => frame.expression && !frame.rules), 'frames with the expression but no rules').to.deep.equal([])
      })
    })

    it('stays in Rewrite Mode through an undo', () => {
      visit(level('Rewrite', 1), { record: true })
      expectRewriteOnlyLevel()
      clickRule('hypothesis1')
      relationShouldBe('1 + y = 1 + 2')
      notProcessing()
      clearFrames()
      cy.get('button[aria-label="Undo"]').filter(':visible').first().click()
      relationShouldBe('x + y = 1 + 2')
      framesShould(frames => {
        expect(frames.length, 'frames since the undo').to.be.greaterThan(0)
        expect(frames.filter(frame => !frame.overlay), 'frames outside Rewrite Mode').to.deep.equal([])
      })
    })
  })

  it('plays Successor World with S, in axiom colours', () => {
    openRewriteLevel(1, 'Successor')
    headerShouldNameLevel('1', 'Counting to Two')
    lessonsShouldContain('‘successor function’')
    relationShouldBe('S(S(0)) = 2')
    cy.get('.tr-rule-card[data-rule-label="one_eq_succ_zero"]').filter(':visible').first()
      .should('have.attr', 'data-rule-axiom', 'true')
      .and('have.class', 'tr-axiom-card')
      .find('.tr-symbol').should('contain.text', 'S(0)')
    // The tabs are NNG's: the numerals' axioms are filed under 012, not under Axioms.
    cy.contains('.tr-tab-btn', 'Axioms').should('not.exist')
    cy.contains('.tr-tab-btn', '012').should('exist')
    rewrite('MyNat.one_eq_succ_zero', 'left', [1], true)
    relationShouldBe('S(1) = 2')
    rewrite('MyNat.two_eq_succ_one', 'left', [], true)
    relationShouldBe('2 = 2')
    check()
  })

  it('proves the theorem level with the axioms', () => {
    openRewriteLevel(2, 'Successor')
    headerShouldNameLevel('2', 'add_succ')
    lessonsShouldContain('from only the axioms below (and induction)')
    relationShouldBe('a + 1 = S(a)')
    cy.get('.tr-rule-card[data-rule-label="add_zero"]').should('have.attr', 'data-rule-axiom', 'true')
    cy.get('.tr-rule-card[data-rule-label="add_succ"]').should('have.attr', 'data-rule-axiom', 'true')
    rewrite('MyNat.one_eq_succ_zero', 'left', [2])
    rewrite('MyNat.add_succ', 'left')
    rewrite('MyNat.add_zero', 'left', [1])
    relationShouldBe('S(a) = S(a)')
    check()
  })

  it('offers the proved theorem, not in the axiom colour, in the Successor World boss', () => {
    openRewriteLevel(3, 'Successor')
    headerShouldNameLevel('3', 'Counting to Four')
    lessonsShouldContain('‘theorem’ levels')
    cy.get('.tr-nav-btn.visual-emphasize-btn').should('exist')
    // The + tab holds the theorem next to the two axioms, which keep their colour.
    cy.contains('.tr-tab-btn', 'Axioms').should('not.exist')
    cy.contains('.tr-tab-btn', 'Theorems').should('not.exist')
    cy.get('.tr-tab-btn').filter((_, tab) => tab.textContent?.trim() === '+').click()
    cy.get('.tr-rule-card[data-rule-label="add_one_eq_succ"]').should('exist').and('not.have.attr', 'data-rule-axiom')
    cy.get('.tr-rule-card[data-rule-label="add_zero"]').filter(':visible').first()
      .should('have.attr', 'data-rule-axiom', 'true').and('have.class', 'tr-axiom-card')
    // The numerals' axioms are on their own tab.
    cy.get('.tr-rule-card[data-rule-label="one_eq_succ_zero"]').should('not.exist')
    cy.contains('.tr-tab-btn', 'Everything').click()
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

  it('crosses the beams: Rewriting Mode on a hypothesis, then on the goal', () => {
    openCanvasLevel('SuccessorJoined', 1)
    headerShouldNameLevel('4', 'Crossing the Beams')
    cy.get('[data-testid="hyp-card"][data-hyp-type="ℕ"]').should('exist')
    hintShouldContain('Try double-clicking')

    // Rewrite `hx` into `x = 1`, with a hint for each step.
    harness(h => h.openHypTransform('hx'))
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    hintShouldContain("Let's try rewriting this equation")
    clickRuleInDirection('one_eq_succ_zero', true)
    relationShouldBe('x = 1')
    hintShouldContain('return back to Proposition Mode')
    arrowStopsShortOf('.back-guide-arrow', '.tr-back-btn')
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')

    // Then the goal, which closes with the check mark as in Rewrite World.
    goalHintShouldContain('Now we can make the substitution')
    harness(h => h.openGoalTransform())
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    hintShouldContain('We can finish the proof here')
    cy.get('[data-testid="rewrite-check"]').should('not.exist')
    clickRuleInDirection('hx', false)
    relationShouldBe('S(1) = 2')
    hintShouldContain('We can finish the proof here')
    cy.contains('.tr-tab-btn', '012').click()
    clickRule('two_eq_succ_one')
    relationShouldBe('S(1) = S(1)')
    check()
    shouldBeCompleted()
    // Back out to Proposition Mode, where the finished proof keeps no stale hints.
    cy.get('.tr-back-btn').should('be.visible').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    cy.get('.visual-header.completed', { timeout: LOAD_TIMEOUT }).should('exist')
    cy.contains('Now we can make the substitution').should('not.exist')
  })

  it('opens the Successor World boss with its three hypotheses', () => {
    openCanvasLevel('SuccessorJoined', 2)
    headerShouldNameLevel('5', 'Plug and Chug')
    goalShouldBe('c + c = 4')
    for (const name of ['ha', 'hb', 'hc']) hypShouldExist(name)
  })

  it('specializes `reflection` by hand, then drags it onto the other goals', () => {
    openCanvasLevel('Neq', 4)
    headerShouldNameLevel('3', 'reflection')
    clickGoal()
    goalShouldBe('S 0 = S 0')
    // A hint above the inventory points at the new theorem.
    hintShouldContain("We've unlocked a new proposition")
    arrowStopsShortOf('.combining-instruction-arrow', '[data-testid="theorem-tray-card"][data-theorem-label="reflection"]')
    notProcessing()
    cy.get('[data-testid="theorem-tray-card"][data-theorem-label="reflection"]').click()

    // Specialization mode, a step at a time, with the game's `S`.
    hintShouldContain('We\'ve now entered specialization mode')
    cy.get('[data-brick-id="fn_succ"]').should('contain.text', 'S(')
    cy.get('[data-brick-id="fn_succ"]').click()
    hintShouldContain('Now drag the')
    cy.get('[data-brick-id="num_0"]').click()
    hintShouldContain('to return to Proposition Mode')
    arrowStopsShortOf('.specialize-guide-arrow', '[data-testid="specialize-done"]')
    cy.get('[data-testid="specialize-done"]').click()
    goalHintShouldContain('Now that we have the proposition we need')
    hypShouldExist('thm_h')
    dragToGoal('thm_h')

    // The other goals: drag `reflection` straight onto them.
    nextUnsolvedBranch()
    goalShouldBe('1 = 1 ∧ 2 = 2')
    cy.contains('Now that we have the proposition we need').should('not.exist')
    clickGoal()
    goalShouldBe('1 = 1')
    hintShouldContain('You can also drag general propositions to the goal')
    harness(h => h.dragTheoremToGoal('MyNat.reflection'))
    nextUnsolvedBranch()
    goalShouldBe('2 = 2')
    harness(h => h.dragTheoremToGoal('MyNat.reflection'))
    shouldBeCompleted()
  })

  it('proves an equality as a proposition, with Rewrite Mode off for the goal', () => {
    openCanvasLevel('Neq', 1)
    headerShouldNameLevel('0', 'Equalities are Propositions (1)')
    goalHintShouldContain('Equalities are propositions just like any other')
    clickGoal()
    goalShouldBe('x = 1')
    // Rewrite Mode on the goal is refused, with a warning in place of the overlay.
    harness(h => h.openGoalTransform())
    cy.get('[data-testid="canvas-warning"]').should('contain.text', 'Rewrite Mode is off for the goal')
    cy.get('.tr-transformation-overlay').should('not.exist')
    dragToGoal('h')
    shouldBeCompleted()
  })

  it('swaps the sides of an equality in Rewriting Mode on a hypothesis, with a hint to the button', () => {
    openCanvasLevel('Neq', 2)
    headerShouldNameLevel('1', 'Equalities are Propositions (2)')
    goalHintShouldContain('reverse the direction of an equality')
    clickGoal()
    goalShouldBe('(x = 1 → y = 2) → 2 = y')
    clickGoal()
    goalShouldBe('2 = y')
    harness(h => h.openHypTransform('h'))
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    relationShouldBe('1 = x')
    hintShouldContain('Use the swap button')
    arrowStopsShortOf('.swap-guide-arrow', '.tr-swap-btn')
    // The swap button sits left of the direction toggle.
    cy.get('.tr-swap-btn').then($swap => {
      cy.get('.tr-direction-btn').then($direction => {
        expect($swap[0]!.getBoundingClientRect().right).to.be.lessThan($direction[0]!.getBoundingClientRect().left)
      })
    })
    cy.get('.tr-swap-btn').click()
    relationShouldBe('x = 1')
    // Undo swaps back.
    cy.get('.tr-transformation-overlay button[aria-label="Undo"]').click()
    relationShouldBe('1 = x')
    hintShouldContain('Use the swap button')
    cy.get('.tr-swap-btn').click()
    relationShouldBe('x = 1')
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    // `x = 1` feeds the implication; its result swaps the same way.
    harness(h => h.dragHypToHyp('h', 'h1'))
    hypShouldExist('h2')
    harness(h => h.openHypTransform('h2'))
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    relationShouldBe('y = 2')
    cy.get('.tr-swap-btn').click()
    relationShouldBe('2 = y')
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    dragToGoal('h2')
    shouldBeCompleted()
  })

  it('resets Rewriting Mode to how it opened, and the whole level in Rewrite World', () => {
    // On a hypothesis in a Proposition-mode level, Reset undoes what was done since
    // entering, no more, and Undo brings it back.
    openCanvasLevel('SuccessorJoined', 1)
    harness(h => h.openHypTransform('hx'))
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    relationShouldBe('x = S(0)')
    // Successor World hides the swap-sides button throughout.
    cy.get('.tr-swap-btn').should('not.exist')
    cy.get('.tr-transformation-overlay button[aria-label="Reset"]').should('be.disabled')
    clickRuleInDirection('one_eq_succ_zero', true)
    relationShouldBe('x = 1')
    cy.get('.tr-transformation-overlay button[aria-label="Reset"]').should('not.be.disabled').click()
    relationShouldBe('x = S(0)')
    cy.get('.tr-transformation-overlay').should('exist')
    cy.get('.tr-transformation-overlay button[aria-label="Reset"]').should('be.disabled')
    cy.get('.tr-transformation-overlay button[aria-label="Undo"]').should('not.be.disabled').click()
    relationShouldBe('x = 1')
    cy.get('.tr-transformation-overlay').should('exist')
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    cy.get('[data-testid="hyp-card"][data-hyp-name="hx"]').should('contain.text', '1')

    // In Rewrite World, Reset starts the level over.
    openRewriteLevel(1)
    cy.get('button[aria-label="Reset"]').filter(':visible').should('be.disabled')
    clickRule('hypothesis1')
    relationShouldBe('1 + y = 1 + 2')
    cy.get('button[aria-label="Reset"]').filter(':visible').should('not.be.disabled').click()
    relationShouldBe('x + y = 1 + 2')
  })

  it('proves zero_add by induction on the canvas, fixing `n` first', () => {
    visit(level('Induction', 1))
    cy.get('[data-testid="goal-card"]', { timeout: LOAD_TIMEOUT }).should('be.visible')
    headerShouldNameLevel('1', 'zero_add')
    goalShouldBe('∀ (n : ℕ), 0 + n = n')
    goalHintShouldContain('to fix')
    clickGoal()
    goalShouldBe('0 + n = n')
    harness(h => h.dragTacticToHyp('induction', 'n'))
    goalShouldBe('0 + 0 = 0')
    goalHintShouldContain('to enter Rewrite Mode')

    // The base case: the check mark closes it, and the other branch is left.
    notProcessing()
    cy.get('[data-testid="goal-card"]').filter(':visible').first().dblclick()
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
    cy.get('.tr-rule-dock[data-layout-ready="true"]', { timeout: LOAD_TIMEOUT }).should('exist')
    clickRule('add_zero')
    relationShouldBe('0 = 0')
    notProcessing()
    cy.get('[data-testid="rewrite-check"]').should('be.visible').click()
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('not.exist')

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
    // Back on the canvas, a click doesn't close the goal: it has to be entered.
    cy.get('.tr-back-btn').click()
    cy.get('.tr-transformation-overlay').should('not.exist')
    goalShouldBe('S d = S d')
    cy.get('[data-testid="goal-card"]').filter(':visible').first()
      .should('not.have.class', 'clickable').click()
    notProcessing()
    cy.window().then(win => {
      const current = (win as HarnessWindow).__visualTestHarness!
      expect(current.getProofAudit().completed).to.equal(false)
      return current.clickGoal().then(
        () => { throw new Error('the click closed the goal') },
        (error: Error) => { expect(error.message).to.contain('not closed by a click') },
      )
    })
    cy.contains('Click to complete').should('not.exist')
    cy.get('[data-testid="goal-card"]').filter(':visible').first().dblclick()
    cy.get('.tr-transformation-overlay', { timeout: LOAD_TIMEOUT }).should('be.visible')
    relationShouldBe('S(d) = S(d)')
    check()
    shouldBeCompleted()
  })

  it('still introduces and splits goals with a click', () => {
    // `VisualNoGoalRfl` only stops the click that closes `a = a`.
    openCanvasLevel('Neq', 3)
    goalShouldBe('x = 1 → x = 1 ∧ (S x = 2 ∨ 1 = 0)')
    cy.get('[data-testid="goal-card"]').filter(':visible').first().should('have.class', 'clickable')
    clickGoal()
    goalShouldBe('x = 1 ∧ (S x = 2 ∨ 1 = 0)')
    clickGoal()
    goalShouldBe('x = 1')
  })

  it('shows the ≠ boss its hint until induction has been done twice, the right way round', () => {
    const hint = 'You may want to revisit this level'
    openCanvasLevel('NeqBoss', 1)
    headerShouldNameLevel('9', 'Equality in ℕ is Decidable (≠ World Boss)')
    goalShouldBe('∀ (a b : ℕ), a = b ∨ a ≠ b')
    goalHintShouldContain(hint)
    // Fix `a`, induct on it, fix `b`: the hint is still up.
    clickGoal()
    goalShouldBe('∀ (b : ℕ), a = b ∨ a ≠ b')
    harness(h => h.dragTacticToHyp('induction', 'a'))
    goalShouldBe('∀ (b : ℕ), 0 = b ∨ 0 ≠ b')
    clickGoal()
    goalShouldBe('0 = b ∨ 0 ≠ b')
    goalHintShouldContain(hint)
    // The second induction takes it down.
    harness(h => h.dragTacticToHyp('induction', 'b'))
    goalShouldBe('0 = 0 ∨ 0 ≠ 0')
    cy.contains(hint).should('not.exist')
    // It stays down in the other case of `a`, where the hypothesis holds for every `b`.
    clickGoal('click_goal_left')
    goalShouldBe('0 = 0')
    cy.contains(hint).should('not.exist')
  })

  it('brings the ≠ boss its hint back when `b` was fixed before the induction on `a`', () => {
    const hint = 'You may want to revisit this level'
    openCanvasLevel('NeqBoss', 1)
    goalShouldBe('∀ (a b : ℕ), a = b ∨ a ≠ b')
    clickGoal()
    goalShouldBe('∀ (b : ℕ), a = b ∨ a ≠ b')
    clickGoal()
    goalShouldBe('a = b ∨ a ≠ b')
    harness(h => h.dragTacticToHyp('induction', 'a'))
    goalShouldBe('0 = b ∨ 0 ≠ b')
    goalHintShouldContain(hint)
    // In the `S(d)` case the inductive hypothesis is about this one `b` only.
    notProcessing()
    cy.get('[data-testid="stream-nav-next"]:not(:disabled)', { timeout: LOAD_TIMEOUT }).filter(':visible').first().click()
    goalShouldBe('S d = b ∨ S d ≠ b')
    goalHintShouldContain(hint)
    harness(h => h.dragTacticToHyp('induction', 'b'))
    goalShouldBe('S d = 0 ∨ S d ≠ 0')
    goalHintShouldContain(hint)
  })

  it('ends Advanced Addition World at its boss, and unlocks the mirror image in ≤ World', () => {
    openCanvasLevel('AdvAddition', 5)
    headerShouldNameLevel('5', 'add_right_eq_zero (Advanced Addition World Boss)')
    cy.get('[data-testid="theorem-tray-card"]', { timeout: LOAD_TIMEOUT }).should('have.length.greaterThan', 0)
    cy.get('[data-testid="theorem-tray-card"][data-theorem-label="add_left_eq_zero"]').should('not.exist')
    openCanvasLevel('LessOrEqual', 1)
    headerShouldNameLevel('1', 'le_refl')
    cy.get('[data-testid="theorem-tray-card"][data-theorem-label="add_left_eq_zero"]', { timeout: LOAD_TIMEOUT })
      .should('exist')
    cy.get('[data-testid="theorem-tray-card"][data-theorem-label="add_right_eq_zero"]').should('exist')
  })

  it('plays the bonus off Proposition World level 8 on the canvas', () => {
    openCanvasLevel('PropositionBonus', 1)
    headerShouldNameLevel('A1', 'Many Such Cases')
    clickGoal()
    goalShouldBe('B ∨ (A → C) → A ∧ B ∨ (A ∨ B → C)')
    clickGoal()
    goalShouldBe('A ∧ B ∨ (A ∨ B → C)')
    clickHyp('h')
    clickHyp('h1')
    // Both sides are `A` and `B`: the left of the goal.
    clickGoal('click_goal_left')
    goalShouldBe('A ∧ B')
    clickGoal()
    goalShouldBe('A')
    dragToGoal('left')
    nextUnsolvedBranch()
    goalShouldBe('B')
    dragToGoal('left1')
  })
})
