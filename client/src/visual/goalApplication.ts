import { formatFormulaText, parse } from './expr-engine'
import type { ExpressionNode } from './expr-types'
import { forallBinderNamesFromFooter } from './quantifiedStatement'

function splitTopLevel(text: string, operator: string): [string, string] | null {
  let depth = 0
  for (let index = 0; index <= text.length - operator.length; index += 1) {
    const char = text[index]
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1)
    else if (depth === 0 && text.startsWith(operator, index)) {
      return [text.slice(0, index).trim(), text.slice(index + operator.length).trim()]
    }
  }
  return null
}

function stripOuterParentheses(text: string): string {
  let result = text.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let enclosesWholeText = true
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1
      else if (result[index] === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        enclosesWholeText = false
        break
      }
    }
    if (!enclosesWholeText) break
    result = result.slice(1, -1).trim()
  }
  return result
}

function terminalConclusion(statement: string): string {
  let conclusion = stripOuterParentheses(statement)
  while (true) {
    const implication = splitTopLevel(conclusion, '→') ?? splitTopLevel(conclusion, '->')
    if (implication) {
      conclusion = stripOuterParentheses(implication[1])
      continue
    }
    // `x ≠ y` is notation for `x = y → False`. Without this the arrow is
    // invisible to the walk above, so a disequality could not be applied to a
    // `False` goal and the drag was silently discarded.
    if (splitTopLevel(conclusion, '≠')) return 'False'
    return conclusion
  }
}

function expressionMatches(
  goal: ExpressionNode,
  pattern: ExpressionNode,
  wildcards: ReadonlySet<string>,
  bindings: Map<string, string>,
): boolean {
  if (pattern.type === 'variable') {
    if (!wildcards.has(pattern.name)) {
      return goal.type === 'variable' && goal.name === pattern.name
    }
    const serialized = JSON.stringify(goal, (_key, value) => _key === 'id' ? undefined : value)
    const prior = bindings.get(pattern.name)
    if (prior !== undefined) return prior === serialized
    bindings.set(pattern.name, serialized)
    return true
  }
  if (pattern.type === 'constant') return goal.type === 'constant' && goal.value === pattern.value
  if (pattern.type === 'app') {
    return goal.type === 'app' && goal.func === pattern.func &&
      expressionMatches(goal.arg, pattern.arg, wildcards, bindings)
  }
  return goal.type === 'binary' && goal.op === pattern.op &&
    expressionMatches(goal.left, pattern.left, wildcards, bindings) &&
    expressionMatches(goal.right, pattern.right, wildcards, bindings)
}

function formulaMatchesGoal(patternText: string, goalText: string, wildcards: ReadonlySet<string>): boolean {
  const pattern = formatFormulaText(patternText).trim()
  const goal = formatFormulaText(goalText).trim()
  if (pattern === goal) return true
  try {
    return expressionMatches(parse(goal), parse(pattern), wildcards, new Map())
  } catch {
    return false
  }
}

/** Whether dropping a statement card on a goal can elaborate as `exact`,
 * `apply`, or one direction of an iff. Only explicitly quantified binders are
 * wildcards; local context variables must continue to match literally. */
export function statementCanTargetGoal(
  statement: string,
  goal: string,
  forallFooter?: string,
): boolean {
  const normalizedStatement = formatFormulaText(statement).trim()
  const normalizedGoal = formatFormulaText(goal).trim()
  if (!normalizedStatement || !normalizedGoal) return false
  if (normalizedStatement === 'False') return normalizedGoal === 'False'

  const wildcards = new Set(forallBinderNamesFromFooter(forallFooter))
  if (formulaMatchesGoal(normalizedStatement, normalizedGoal, wildcards)) return true

  const iff = splitTopLevel(normalizedStatement, '↔')
  if (iff && (
    formulaMatchesGoal(iff[0], normalizedGoal, wildcards) ||
    formulaMatchesGoal(iff[1], normalizedGoal, wildcards)
  )) return true

  return formulaMatchesGoal(terminalConclusion(normalizedStatement), normalizedGoal, wildcards)
}
