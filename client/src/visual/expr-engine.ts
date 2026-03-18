import type { ExpressionNode, Op } from './expr-types'
import type { ExprTree } from '../components/infoview/rpc_api'
import { v4 as uuidv4 } from 'uuid'

// --- Parser ---

class Parser {
  private tokens: string[]
  private current: number = 0

  constructor(input: string) {
    this.tokens = input.match(/([a-zA-Zα-ωΑ-Ω₀-₉]+|\d+|[+\-*/()\[\]]|\S)/g) || []
  }

  private peek(): string | null {
    return this.tokens[this.current] || null
  }

  private consume(): string {
    return this.tokens[this.current++]
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek()

    if (token === '(') {
      this.consume()
      const expr = this.parseExpression()
      if (this.peek() === ')') this.consume()
      return expr
    }

    if (token && /^[a-zA-Zα-ωΑ-Ω][a-zA-Zα-ωΑ-Ω₀-₉_]*$/.test(token)) {
      this.consume()
      // Support function application syntax: name(arg)
      if (this.peek() === '(') {
        this.consume() // '('
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

// --- ExprTree → ExpressionNode converter ---

/** Strip namespace prefix: "Nat.succ" → "succ", "HAdd.hAdd" → "hAdd" */
function shortConstName(name: string): string {
  const parts = name.split('.')
  return parts[parts.length - 1]
}

/** Lean represents `a + b` as a 6-arg application of HAdd.hAdd (4 type/instance args + lhs + rhs).
 *  Flatten an app chain and return [head, arg0, arg1, ...]. */
function flattenApp(tree: ExprTree): ExprTree[] {
  if (tree.tag !== 'app') return [tree]
  return [...flattenApp(tree.func), tree.arg]
}

/** Map from fully-qualified Lean operator constants to arithmetic operators. */
const OP_CONSTS: Record<string, Op> = {
  'HAdd.hAdd': '+',
  'HMul.hMul': '*',
  'HSub.hSub': '-',
  'HDiv.hDiv': '/',
}

/** Collapse a succ(succ(...(n))) chain into a numeric constant.
 *  Works bottom-up: inner nodes are already converted, so the innermost value
 *  may be constant(0) or constant(k) if a previous layer already folded.
 *  Using `n + curr.value` handles both cases correctly. */
function tryNatLit(node: ExpressionNode): ExpressionNode {
  let n = 0
  let curr: ExpressionNode = node
  while (curr.type === 'app' && curr.func === 'succ') { n++; curr = curr.arg }
  if (curr.type === 'constant') return { type: 'constant', value: n + curr.value, id: node.id }
  return node
}

/** Convert a Lean `ExprTree` (as received from the server) to an `ExpressionNode`.
 *  - lit   → constant
 *  - fvar / const → variable (short name) or, for known binary ops, binary node
 *  - app   → try binary-op flattening first; fall back to `app` node
 *  - other → try string `parse()`; fall back to variable with raw pp string */
export function exprTreeToNode(tree: ExprTree): ExpressionNode {
  if (tree.tag === 'lit') {
    return { type: 'constant', value: tree.n, id: uuidv4() }
  }
  if (tree.tag === 'fvar') {
    return { type: 'variable', name: tree.name, id: uuidv4() }
  }
  if (tree.tag === 'const') {
    // Nat.zero → constant 0
    if (tree.name === 'Nat.zero' || tree.name === 'MyNat.zero') {
      return { type: 'constant', value: 0, id: uuidv4() }
    }
    return { type: 'variable', name: shortConstName(tree.name), id: uuidv4() }
  }
  if (tree.tag === 'other') {
    try { return parse(tree.pp) } catch { return { type: 'variable', name: tree.pp, id: uuidv4() } }
  }
  // tag === 'app'
  const flat = flattenApp(tree)
  const head = flat[0]
  if (head.tag === 'const') {
    const op = OP_CONSTS[head.name]
    // Binary ops have 4 type/instance args + lhs + rhs = 7 total (including head)
    if (op && flat.length === 7) {
      return { type: 'binary', op, left: exprTreeToNode(flat[5]), right: exprTreeToNode(flat[6]), id: uuidv4() }
    }
    // Unary function application (e.g. Nat.succ n) — keep as app node so succ chains
    // display structurally (e.g. succ(succ(0))) rather than being folded to a numeral.
    // tryNatLit is available but not called here: folding would hide the expression
    // structure that the player needs to see and rewrite.
    if (flat.length === 2) {
      return { type: 'app', func: shortConstName(head.name), arg: exprTreeToNode(flat[1]), id: uuidv4() }
    }
  }
  // Generic fallback: use outermost func name + last arg
  const funcName = head.tag === 'const' ? shortConstName(head.name)
                 : head.tag === 'fvar'  ? head.name
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
  if (n1.type === 'app'      && n2.type === 'app')      return n1.func === n2.func && expressionsEqual(n1.arg, n2.arg)
  if (n1.type === 'binary'   && n2.type === 'binary') {
    return n1.op === n2.op && expressionsEqual(n1.left, n2.left) && expressionsEqual(n1.right, n2.right)
  }
  return false
}

/** Pattern match: variables in `pattern` are wildcards that match anything.
 *  Used for theorem rewrite rules whose lhs/rhs use generic variable names. */
export function matchesPattern(expr: ExpressionNode, pattern: ExpressionNode): boolean {
  if (pattern.type === 'variable') return true  // wildcard
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

/** Find the node with the given id in an expression tree. */
export function findNodeById(root: ExpressionNode, id: string): ExpressionNode | null {
  if (root.id === id) return root
  if (root.type === 'binary') return findNodeById(root.left, id) ?? findNodeById(root.right, id)
  if (root.type === 'app') return findNodeById(root.arg, id)
  return null
}

/** Find the path from root to the node with `targetId`.
 *  Path entries are 1-indexed positions among visible children:
 *  - binary: 1 = left, 2 = right
 *  - app:    1 = arg (only child)
 *  Returns null if targetId is not found. */
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
