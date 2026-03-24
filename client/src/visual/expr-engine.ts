import type { ExpressionNode, Op } from './expr-types'
import type { ExprTree } from '../components/infoview/rpc_api'
import { v4 as uuidv4 } from 'uuid'

// --- Parser ---

class Parser {
  private tokens: string[]
  private current = 0

  constructor(input: string) {
    this.tokens = input.match(/([\p{L}\p{N}_]+|[+\-*/()\[\]]|\S)/gu) || []
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

  private parseTerm(): ExpressionNode {
    let left = this.parsePrimary()
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.consume() as Op
      const right = this.parsePrimary()
      left = { type: 'binary', op, left, right, id: uuidv4() }
    }
    return left
  }

  public parseExpression(): ExpressionNode {
    let left = this.parseTerm()
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.consume() as Op
      const right = this.parseTerm()
      left = { type: 'binary', op, left, right, id: uuidv4() }
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

export function printExpression(node: ExpressionNode): string {
  if (node.type === 'variable') return node.name
  if (node.type === 'constant') return node.value.toString()
  if (node.type === 'app') return `${node.func}(${printExpression(node.arg)})`
  if (node.type === 'binary') {
    const leftStr = printExpression(node.left)
    const rightStr = printExpression(node.right)
    const leftSafe = node.left.type === 'binary' ? `(${leftStr})` : leftStr
    const rightSafe = node.right.type === 'binary' ? `(${rightStr})` : rightStr
    return `${leftSafe} ${node.op} ${rightSafe}`
  }
  return ''
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
  if (pattern.type === 'variable') return true
  if (pattern.type === 'constant') return expr.type === 'constant' && expr.value === pattern.value
  if (pattern.type === 'app') {
    return expr.type === 'app' && expr.func === pattern.func && matchesPattern(expr.arg, pattern.arg)
  }
  if (pattern.type === 'binary') {
    return expr.type === 'binary' && expr.op === pattern.op &&
      matchesPattern(expr.left, pattern.left) && matchesPattern(expr.right, pattern.right)
  }
  return false
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
