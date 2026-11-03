/**
 * @fileOverview How a Rewrite Mode rule card finds the terms it can rewrite.
 */
import { expressionsEqual, firstMatchingNodeId, matchesPattern } from './expr-engine'
import type { ExpressionNode } from './expr-types'
import { forallBinderNamesFromFooter } from './quantifiedStatement'

/** Theorem cards and `∀` hypotheses are patterns: a theorem's variables, or a
 * hypothesis's bound variables, match any term. Other hypotheses rewrite
 * exactly the term on their source side. */
export interface RuleMatching {
  isPattern: boolean
  /** Pattern variables; `undefined` means every variable (theorem cards). */
  wildcards?: ReadonlySet<string>
}

export function ruleMatching(draggedId: string, rule: { forallFooter?: string }): RuleMatching {
  if (draggedId.startsWith('thm_')) return { isPattern: true }
  const binders = forallBinderNamesFromFooter(rule.forallFooter)
  return binders.length > 0
    ? { isPattern: true, wildcards: new Set(binders) }
    : { isPattern: false }
}

/** Whether the rule can rewrite `node`; `from` is the rule's source side. */
export function ruleMatchesNode(
  node: ExpressionNode,
  from: ExpressionNode,
  matching: RuleMatching,
): boolean {
  return matching.isPattern
    ? matchesPattern(node, from, matching.wildcards)
    : expressionsEqual(node, from)
}

/** The term a click on a rule card rewrites: its first match reading left to
 * right through the relation, outer terms before the terms inside them. */
export function ruleClickTargetId(
  lhs: ExpressionNode,
  rhs: ExpressionNode,
  from: ExpressionNode,
  matching: RuleMatching,
): string | null {
  return firstMatchingNodeId([lhs, rhs], node => ruleMatchesNode(node, from, matching))
}
