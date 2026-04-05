import type { ExpressionNode, Op } from './expr-types'
import type { ExprTree } from '../components/infoview/rpc_api'
import { v4 as uuidv4 } from 'uuid'

// --- Parser ---

interface BinaryOpInfo {
  op: Op
  precedence: number
  associativity: 'left' | 'right'
}

const BINARY_OPS: Record<string, BinaryOpInfo> = {
  '*': { op: '*', precedence: 6, associativity: 'left' },
  '/': { op: '/', precedence: 6, associativity: 'left' },
  '+': { op: '+', precedence: 5, associativity: 'left' },
  '-': { op: '-', precedence: 5, associativity: 'left' },
  '=': { op: '=', precedence: 4, associativity: 'left' },
  '∧': { op: '∧', precedence: 3, associativity: 'left' },
  '\\land': { op: '∧', precedence: 3, associativity: 'left' },
  '∨': { op: '∨', precedence: 2, associativity: 'left' },
  '\\lor': { op: '∨', precedence: 2, associativity: 'left' },
  '→': { op: '→', precedence: 1, associativity: 'right' },
  '->': { op: '→', precedence: 1, associativity: 'right' },
  '=>': { op: '→', precedence: 1, associativity: 'right' },
  '\\to': { op: '→', precedence: 1, associativity: 'right' },
  '\\implies': { op: '→', precedence: 1, associativity: 'right' },
}

class Parser {
  private tokens: string[]
  private current = 0

  constructor(input: string) {
    this.tokens = input.match(/(\\implies|\\land|\\lor|\\to|->|=>|[\p{L}\p{N}_]+|[+\-*/=()\[\]∧∨→]|\S)/gu) || []
  }

  private peek(): string | null {
    return this.tokens[this.current] || null
  }

  private consume(): string {
    return this.tokens[this.current++]
  }

  private isIdentifier(token: string | null): token is string {
    return token !== null && /^[\p{L}][\p{L}\p{N}_]*$/u.test(token)
  }

  private isPrimaryStart(token: string | null): boolean {
    return token === '('
      || this.isIdentifier(token)
      || (token !== null && /^\d+$/.test(token))
  }

  private parseAtom(): ExpressionNode {
    const token = this.peek()

    if (token === '(') {
      this.consume()
      const expr = this.parseExpression()
      if (this.peek() === ')') this.consume()
      return expr
    }

    if (this.isIdentifier(token)) {
      this.consume()
      // Support both `name(arg)` and simple Lean-style unary application `name arg`.
      if (this.peek() === '(') {
        this.consume()
        const arg = this.parseExpression()
        if (this.peek() === ')') this.consume()
        return { type: 'app', func: token, arg, id: uuidv4() }
      }
      return { type: 'variable', name: token, id: uuidv4() }
    }

    if (token && /^\d+$/.test(token)) {
      this.consume()
      return { type: 'constant', value: parseInt(token, 10), id: uuidv4() }
    }

    throw new Error(`Unexpected token: ${token}`)
  }

  private parsePrimary(): ExpressionNode {
    let expr = this.parseAtom()
    while (this.isPrimaryStart(this.peek())) {
      if (expr.type !== 'variable') break
      const arg = this.parseAtom()
      expr = { type: 'app', func: expr.name, arg, id: uuidv4() }
    }
    return expr
  }

  private peekBinaryOp(): BinaryOpInfo | null {
    const token = this.peek()
    return token ? (BINARY_OPS[token] ?? null) : null
  }

  public parseExpression(minPrecedence = 1): ExpressionNode {
    let left = this.parsePrimary()

    while (true) {
      const nextOp = this.peekBinaryOp()
      if (!nextOp || nextOp.precedence < minPrecedence) break

      this.consume()
      const right = this.parseExpression(
        nextOp.associativity === 'left' ? nextOp.precedence + 1 : nextOp.precedence
      )
      left = { type: 'binary', op: nextOp.op, left, right, id: uuidv4() }
    }

    return left
  }

  public isAtEnd(): boolean {
    return this.current >= this.tokens.length
  }
}

export function parse(input: string): ExpressionNode {
  const parser = new Parser(input.trim())
  const expr = parser.parseExpression()
  if (!parser.isAtEnd()) {
    throw new Error(`Unexpected trailing tokens in expression: ${input}`)
  }
  return expr
}

// --- ExprTree -> ExpressionNode converter ---

function shortConstName(name: string): string {
  const parts = name.split('.')
  return parts[parts.length - 1]
}

function flattenApp(tree: ExprTree): ExprTree[] {
  if (tree.tag !== 'app') return [tree]
  return [...flattenApp(tree.func), tree.arg]
}

const OP_CONSTS: Record<string, Op> = {
  'HAdd.hAdd': '+',
  'HMul.hMul': '*',
  'HSub.hSub': '-',
  'HDiv.hDiv': '/',
}

function tryNatLit(node: ExpressionNode): ExpressionNode {
  let n = 0
  let curr: ExpressionNode = node
  while (curr.type === 'app' && curr.func === 'succ') { n++; curr = curr.arg }
  if (curr.type === 'constant') return { type: 'constant', value: n + curr.value, id: node.id }
  return node
}

export function exprTreeToNode(tree: ExprTree): ExpressionNode {
  if (tree.tag === 'lit') {
    return { type: 'constant', value: tree.n, id: uuidv4() }
  }
  if (tree.tag === 'fvar') {
    return { type: 'variable', name: tree.name, id: uuidv4() }
  }
  if (tree.tag === 'const') {
    if (tree.name === 'Nat.zero' || tree.name === 'MyNat.zero') {
      return { type: 'constant', value: 0, id: uuidv4() }
    }
    return { type: 'variable', name: shortConstName(tree.name), id: uuidv4() }
  }
  if (tree.tag === 'other') {
    try { return parse(tree.pp) } catch { return { type: 'variable', name: tree.pp, id: uuidv4() } }
  }

  const flat = flattenApp(tree)
  const head = flat[0]
  if (head.tag === 'const') {
    const op = OP_CONSTS[head.name]
    if (op && flat.length === 7) {
      return { type: 'binary', op, left: exprTreeToNode(flat[5]), right: exprTreeToNode(flat[6]), id: uuidv4() }
    }
    // `@OfNat.ofNat α n inst` — the numeric literal `n` is at flat[2].
    // Normally caught by the Lean-side up-front check, but MData wrappers on
    // sub-expressions can prevent that, so we handle it defensively here too.
    if (head.name === 'OfNat.ofNat' && flat.length >= 3 && flat[2].tag === 'lit') {
      return { type: 'constant', value: flat[2].n, id: uuidv4() }
    }
    // Keep unary applications structural so rewrite targets stay visible.
    if (flat.length === 2) {
      return { type: 'app', func: shortConstName(head.name), arg: exprTreeToNode(flat[1]), id: uuidv4() }
    }
  }

  const funcName = head.tag === 'const' ? shortConstName(head.name)
    : head.tag === 'fvar' ? head.name
      : 'fn'
  return { type: 'app', func: funcName, arg: exprTreeToNode(tree.arg), id: uuidv4() }
}

// --- Printer ---

function opPrecedence(op: Op): number {
  return BINARY_OPS[op].precedence
}

function isArithmeticOp(op: Op): boolean {
  return op === '+' || op === '-' || op === '*' || op === '/'
}

function needsStructuralParens(child: ExpressionNode, parentOp: Op): boolean {
  if (child.type !== 'binary') return false
  if (child.op === parentOp) return true
  if (opPrecedence(child.op) < opPrecedence(parentOp)) return true
  return false
}

function needsDisplayParens(
  child: ExpressionNode,
  parentOp: Op,
  side: 'left' | 'right',
): boolean {
  if (child.type !== 'binary') return false

  if (child.op === '=') {
    return needsStructuralParens(child, parentOp)
  }

  if (isArithmeticOp(child.op) && (isArithmeticOp(parentOp) || parentOp === '=')) {
    return needsStructuralParens(child, parentOp)
  }

  return true
}

function printExpressionWithParens(
  node: ExpressionNode,
  needsParens: (child: ExpressionNode, parentOp: Op, side: 'left' | 'right') => boolean,
): string {
  if (node.type === 'variable') return node.name
  if (node.type === 'constant') return node.value.toString()
  if (node.type === 'app') return `${node.func}(${printExpressionWithParens(node.arg, needsParens)})`
  if (node.type === 'binary') {
    const leftStr = printExpressionWithParens(node.left, needsParens)
    const rightStr = printExpressionWithParens(node.right, needsParens)
    const leftSafe = needsParens(node.left, node.op, 'left') ? `(${leftStr})` : leftStr
    const rightSafe = needsParens(node.right, node.op, 'right') ? `(${rightStr})` : rightStr
    return `${leftSafe} ${node.op} ${rightSafe}`
  }
  return ''
}

export function printExpression(node: ExpressionNode): string {
  return printExpressionWithParens(node, (child, parentOp) => needsStructuralParens(child, parentOp))
}

export function printDisplayExpression(node: ExpressionNode): string {
  return printExpressionWithParens(node, needsDisplayParens)
}

export function formatFormulaText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return normalized

  try {
    return printDisplayExpression(parse(normalized))
  } catch {
    return normalized
  }
}

// --- Helpers ---

function clone(node: ExpressionNode): ExpressionNode {
  if (node.type === 'binary') {
    return { ...node, left: clone(node.left), right: clone(node.right), id: uuidv4() }
  }
  if (node.type === 'app') {
    return { ...node, arg: clone(node.arg), id: uuidv4() }
  }
  return { ...node, id: uuidv4() }
}

export function deepCloneWithNewIds(node: ExpressionNode): ExpressionNode {
  return clone(node)
}

export function expressionsEqual(n1: ExpressionNode, n2: ExpressionNode): boolean {
  if (n1.type !== n2.type) return false
  if (n1.type === 'constant' && n2.type === 'constant') return n1.value === n2.value
  if (n1.type === 'variable' && n2.type === 'variable') return n1.name === n2.name
  if (n1.type === 'app' && n2.type === 'app') return n1.func === n2.func && expressionsEqual(n1.arg, n2.arg)
  if (n1.type === 'binary' && n2.type === 'binary') {
    return n1.op === n2.op && expressionsEqual(n1.left, n2.left) && expressionsEqual(n1.right, n2.right)
  }
  return false
}

export function matchesPattern(expr: ExpressionNode, pattern: ExpressionNode): boolean {
  return matchAndCapture(expr, pattern) !== null
}

export function findNodeById(root: ExpressionNode, id: string): ExpressionNode | null {
  if (root.id === id) return root
  if (root.type === 'binary') return findNodeById(root.left, id) ?? findNodeById(root.right, id)
  if (root.type === 'app') return findNodeById(root.arg, id)
  return null
}

export function findPath(root: ExpressionNode, targetId: string): number[] | null {
  if (root.id === targetId) return []
  if (root.type === 'binary') {
    const left = findPath(root.left, targetId)
    if (left !== null) return [1, ...left]
    const right = findPath(root.right, targetId)
    if (right !== null) return [2, ...right]
  }
  if (root.type === 'app') {
    const arg = findPath(root.arg, targetId)
    if (arg !== null) return [1, ...arg]
  }
  return null
}

// --- Apply equality rewrite rule ---

export function applyEqualityRule(
  root: ExpressionNode,
  targetId: string,
  lhs: ExpressionNode,
  rhs: ExpressionNode,
  isReverse: boolean
): ExpressionNode {
  const from = isReverse ? rhs : lhs
  const to = isReverse ? lhs : rhs
  return applyEqualityRuleAt(root, targetId, from, to)
}

function applyEqualityRuleAt(
  root: ExpressionNode,
  targetId: string,
  from: ExpressionNode,
  to: ExpressionNode
): ExpressionNode {
  if (root.id === targetId) {
    if (expressionsEqual(root, from)) return deepCloneWithNewIds(to)
    return root
  }
  if (root.type === 'binary') {
    const newLeft = applyEqualityRuleAt(root.left, targetId, from, to)
    const newRight = applyEqualityRuleAt(root.right, targetId, from, to)
    if (newLeft === root.left && newRight === root.right) return root
    return { ...root, left: newLeft, right: newRight }
  }
  if (root.type === 'app') {
    const newArg = applyEqualityRuleAt(root.arg, targetId, from, to)
    if (newArg === root.arg) return root
    return { ...root, arg: newArg }
  }
  return root
}

// --- Pattern-based theorem rewrite (variables in pattern are wildcards) ---

/**
 * Match `expr` against `pattern`, capturing variable bindings.
 * Variables in `pattern` are wildcards that match any subexpression.
 * Returns null if the pattern does not structurally match `expr`.
 */
function matchAndCapture(
  expr: ExpressionNode,
  pattern: ExpressionNode,
  bindings: Record<string, ExpressionNode> = {},
): Record<string, ExpressionNode> | null {
  if (pattern.type === 'variable') {
    const existing = bindings[pattern.name]
    if (existing !== undefined) {
      // Same variable seen again — must bind to the same expression.
      return expressionsEqual(existing, expr) ? bindings : null
    }
    return { ...bindings, [pattern.name]: expr }
  }
  if (pattern.type === 'constant') {
    return (expr.type === 'constant' && expr.value === pattern.value) ? bindings : null
  }
  if (pattern.type === 'app') {
    if (expr.type !== 'app' || expr.func !== pattern.func) return null
    return matchAndCapture(expr.arg, pattern.arg, bindings)
  }
  if (pattern.type === 'binary') {
    if (expr.type !== 'binary' || expr.op !== pattern.op) return null
    const leftBindings = matchAndCapture(expr.left, pattern.left, bindings)
    if (leftBindings === null) return null
    return matchAndCapture(expr.right, pattern.right, leftBindings)
  }
  return null
}

/** Replace all variable nodes in `node` with their bound values, assigning fresh IDs. */
function substituteVariables(
  node: ExpressionNode,
  bindings: Record<string, ExpressionNode>,
): ExpressionNode {
  if (node.type === 'variable') {
    const bound = bindings[node.name]
    return bound ? deepCloneWithNewIds(bound) : { ...node, id: uuidv4() }
  }
  if (node.type === 'constant') return { ...node, id: uuidv4() }
  if (node.type === 'binary') {
    return {
      ...node,
      left: substituteVariables(node.left, bindings),
      right: substituteVariables(node.right, bindings),
      id: uuidv4(),
    }
  }
  if (node.type === 'app') {
    return { ...node, arg: substituteVariables(node.arg, bindings), id: uuidv4() }
  }
  throw new Error('Unknown expression node')
}

/**
 * Apply a theorem rewrite rule at the node with `targetId`.
 * Uses pattern matching so variables in `lhsPattern`/`rhsPattern` act as wildcards.
 * Use this for theorem cards; use `applyEqualityRule` for hypothesis cards.
 */
export function applyTheoremRewrite(
  root: ExpressionNode,
  targetId: string,
  lhsPattern: ExpressionNode,
  rhsPattern: ExpressionNode,
  isReverse: boolean,
): ExpressionNode {
  const fromPattern = isReverse ? rhsPattern : lhsPattern
  const toTemplate = isReverse ? lhsPattern : rhsPattern
  return applyTheoremRewriteAt(root, targetId, fromPattern, toTemplate)
}

function applyTheoremRewriteAt(
  root: ExpressionNode,
  targetId: string,
  fromPattern: ExpressionNode,
  toTemplate: ExpressionNode,
): ExpressionNode {
  if (root.id === targetId) {
    const bindings = matchAndCapture(root, fromPattern)
    if (bindings !== null) return substituteVariables(toTemplate, bindings)
    return root
  }
  if (root.type === 'binary') {
    const newLeft = applyTheoremRewriteAt(root.left, targetId, fromPattern, toTemplate)
    const newRight = applyTheoremRewriteAt(root.right, targetId, fromPattern, toTemplate)
    if (newLeft === root.left && newRight === root.right) return root
    return { ...root, left: newLeft, right: newRight }
  }
  if (root.type === 'app') {
    const newArg = applyTheoremRewriteAt(root.arg, targetId, fromPattern, toTemplate)
    if (newArg === root.arg) return root
    return { ...root, arg: newArg }
  }
  return root
}
