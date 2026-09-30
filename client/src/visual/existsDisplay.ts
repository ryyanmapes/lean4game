const IDENTIFIER_CHAR_CLASS = "[\\p{L}\\p{N}_']"

function nextExistsName(usedNames: Set<string>): string {
  let suffix = 1
  let candidate = 'c'
  while (usedNames.has(candidate)) {
    suffix += 1
    candidate = `c${suffix}`
  }
  usedNames.add(candidate)
  return candidate
}

const OPENING_BRACKETS = '([{⟨'
const CLOSING_BRACKETS = ')]}⟩'

/** Remove parentheses that enclose the whole text, e.g. `((a ≠ b))` → `a ≠ b`,
 * but leave `(a = b) → (c = d)` alone. */
function stripEnclosingParens(text: string): string {
  let result = text.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1
      else if (result[index] === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) return result
    }
    result = result.slice(1, -1).trim()
  }
  return result
}

/** Indices of the characters in `operators` that sit outside every bracket.
 * Returns null for unbalanced text so callers never guess at its structure. */
function topLevelOperatorIndices(text: string, operators: string): number[] | null {
  const indices: number[] = []
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (OPENING_BRACKETS.includes(char)) depth += 1
    else if (CLOSING_BRACKETS.includes(char)) {
      depth -= 1
      if (depth < 0) return null
    } else if (depth === 0 && operators.includes(char)) {
      indices.push(index)
    }
  }
  return depth === 0 ? indices : null
}

// Everything that binds no tighter than a relation (precedence 50) — the
// logical connectives, the relations themselves, and binder/argument
// separators. `->`, `<=`, `!=`, `=>` are caught through their `>`/`=`.
const LOOSE_OPERATOR_CHARS = '→↔∧∨≠=≤≥<>,:'

/** Split `lhs ⋈ rhs` only when the relation `⋈` is the principal connective
 * of the whole proposition, i.e. the only top-level operator that binds no
 * tighter than it. Notations such as `≠` and `≤` are unfolded by splitting the
 * surface string, so anything looser at the top level means the relation is
 * just a sub-term and must be left alone. */
function splitTopLevelRelation(text: string, relation: string): [string, string] | null {
  const body = stripEnclosingParens(text)
  if (/^(?:[∀∃¬λ]|fun\b|Exists\b)/u.test(body)) return null
  const operators = topLevelOperatorIndices(body, LOOSE_OPERATOR_CHARS)
  if (!operators || operators.length !== 1) return null
  const index = operators[0]!
  if (body[index] !== relation) return null
  const lhs = body.slice(0, index).trim()
  const rhs = body.slice(index + relation.length).trim()
  return lhs && rhs ? [lhs, rhs] : null
}

/** `lhs ≠ rhs` as a whole proposition. `d ≠ 0 → d * b = d * c → b = c` is an
 * implication whose premise happens to be a disequality, so it must NOT
 * become `d = 0 → … → b = c → False`. */
export function splitTopLevelDisequality(text: string): [string, string] | null {
  return splitTopLevelRelation(text, '≠')
}

/** `¬` binds everything at precedence ≥ 40, so its scope ends at the first
 * top-level `∧`/`∨`/`→`/`↔`. Only when there is none does `¬` cover the whole
 * text and `¬ P` read as `P → False`. */
export function splitTopLevelNegation(text: string): string | null {
  const body = stripEnclosingParens(text)
  if (!body.startsWith('¬')) return null
  const negated = body.slice(1).trim()
  if (!negated) return null
  const connectives = topLevelOperatorIndices(negated, '→↔∧∨')
  if (!connectives || connectives.length > 0) return null
  return negated
}

function expandTopLevelLessOrEqual(displayText: string): string | null {
  const lessOrEqual = splitTopLevelRelation(displayText, '≤')
  if (!lessOrEqual) return null
  const [lhs, rhs] = lessOrEqual
  const identifiers = displayText.match(/[\p{L}][\p{L}\p{N}_']*/gu) ?? []
  const witness = nextExistsName(new Set(identifiers))
  return `∃ ${witness}, ${rhs} = ${lhs} + ${witness}`
}

export interface ExistsDisplayInfo {
  varName: string
  body: string
}

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitTopLevelExistsForm(form: string):
  | { style: 'exists'; binder: string; body: string }
  | { style: 'existsFun'; binder: string; body: string }
  | null {
  const trimmed = form.trim()
  if (trimmed.startsWith('∃')) {
    let depth = 0
    for (let idx = 1; idx < trimmed.length; idx++) {
      const ch = trimmed[idx]
      if (ch === '(') depth += 1
      else if (ch === ')' && depth > 0) depth -= 1
      else if (ch === ',' && depth === 0) {
        const binder = trimmed.slice(1, idx).trim()
        const body = trimmed.slice(idx + 1).trim()
        if (!binder || !body) return null
        return { style: 'exists', binder, body }
      }
    }
    return null
  }

  const existsFunMatch = trimmed.match(/^Exists\s+fun\s+(.+?)=>\s*(.+)$/u)
  if (!existsFunMatch) return null

  const [, binder = '', body = ''] = existsFunMatch
  if (!binder.trim() || !body.trim()) return null
  return { style: 'existsFun', binder: binder.trim(), body: body.trim() }
}

function extractBinderName(binder: string): string | null {
  let inner = binder.trim()
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1).trim()
  }
  if (!inner) return null

  const colonIndex = inner.indexOf(':')
  const candidate = (colonIndex >= 0 ? inner.slice(0, colonIndex) : inner).trim()
  if (!candidate) return null

  const match = candidate.match(/^[^\s]+/u)
  return match?.[0] ?? null
}

export function replaceIdentifier(text: string, oldName: string, newName: string): string {
  if (!text || oldName === newName) return text

  const escapedName = escapeRegexLiteral(oldName)
  const pattern = new RegExp(
    `(^|[^${IDENTIFIER_CHAR_CLASS.slice(1, -1)}])(${escapedName})(?=$|[^${IDENTIFIER_CHAR_CLASS.slice(1, -1)}])`,
    'gu',
  )
  return text.replace(pattern, (_match, prefix: string) => `${prefix}${newName}`)
}

export function chooseFreshExistsVarName(varName: string, contextNames: Iterable<string>): string {
  const existingNames = new Set(Array.from(contextNames).filter((name): name is string => Boolean(name)))
  if (!existingNames.has(varName)) return varName

  let idx = 2
  while (existingNames.has(`${varName}${idx}`)) idx += 1
  return `${varName}${idx}`
}

export function contextualizeExistsDisplay(
  info: ExistsDisplayInfo,
  contextNames: Iterable<string>,
): ExistsDisplayInfo {
  const freshVarName = chooseFreshExistsVarName(info.varName, contextNames)
  return {
    varName: freshVarName,
    body: replaceIdentifier(info.body, info.varName, freshVarName),
  }
}

export function contextualizeReductionForm(form: string, contextNames: Iterable<string>): string {
  const parsed = splitTopLevelExistsForm(form)
  if (!parsed) return form

  const binderName = extractBinderName(parsed.binder)
  if (!binderName) return form

  const freshVarName = chooseFreshExistsVarName(binderName, contextNames)
  if (freshVarName === binderName) return form

  const renamedBinder = replaceIdentifier(parsed.binder, binderName, freshVarName)
  const renamedBody = replaceIdentifier(parsed.body, binderName, freshVarName)

  return parsed.style === 'exists'
    ? `∃ ${renamedBinder}, ${renamedBody}`
    : `Exists fun ${renamedBinder} => ${renamedBody}`
}

export function contextualizeReductionForms(forms: string[], contextNames: Iterable<string>): string[] {
  const contextualizedForms = forms.map(form => contextualizeReductionForm(form, contextNames))
  const expandedForms: string[] = []
  const seen = new Set<string>()

  const append = (form: string) => {
    if (seen.has(form)) return
    seen.add(form)
    expandedForms.push(form)
  }

  for (const form of contextualizedForms) {
    append(form)

    const negatedBody = splitTopLevelNegation(form)
    if (!negatedBody) continue

    const alreadyParenthesized = negatedBody.startsWith('(') && negatedBody.endsWith(')')
    const antecedent =
      !alreadyParenthesized && (negatedBody.startsWith('\u00ac') || negatedBody.includes('\u2192'))
        ? `(${negatedBody})`
        : negatedBody
    append(`${antecedent} \u2192 False`)
  }

  return expandedForms
}

/** Pick the useful definition-level form for compact, always-visible card context. */
export function selectAtomicReductionForm(
  displayText: string,
  forms: string[] | undefined,
  contextNames: Iterable<string>,
): string | null {
  const displayed = displayText.trim()
  const isNegation = splitTopLevelNegation(displayed) !== null || splitTopLevelDisequality(displayed) !== null
  const isLeq = displayed.includes('≤')
  if ((!isNegation && !isLeq) || !forms?.length) return null

  const contextualized = contextualizeReductionForms(forms, contextNames)
  if (isNegation) {
    for (let idx = contextualized.length - 1; idx >= 0; idx -= 1) {
      const form = contextualized[idx]
      if (form?.includes('→ False')) return form
    }
    return null
  }
  for (let idx = contextualized.length - 1; idx >= 0; idx -= 1) {
    const form = contextualized[idx]
    if (!form) continue
    const trimmed = form.trim()
    if (trimmed.startsWith('∃') || trimmed.startsWith('Exists ')) return form
  }
  return null
}

/** Infer the two definition-level forms that Visual Lean teaches directly in
 * proposition theorem metadata. Static theorem docs do not carry RPC reduction
 * forms, so theorem tray/copy cards need this small surface-syntax bridge. */
export function inferAtomicReductionForms(displayText: string): string[] {
  const displayed = displayText.trim()
  const notEqual = splitTopLevelDisequality(displayed)
  if (notEqual) {
    const [lhs, rhs] = notEqual
    return [`${lhs} = ${rhs} → False`]
  }

  const expandedLessOrEqual = expandTopLevelLessOrEqual(displayed)
  if (expandedLessOrEqual) return [expandedLessOrEqual]

  return []
}

function splitTopLevelBinderForm(form: string):
  | { quantifier: string; binder: string; body: string }
  | null {
  const trimmed = form.trim()
  const quantifier = trimmed[0]
  if (quantifier !== '∃' && quantifier !== '∀') return null
  let depth = 0
  for (let idx = 1; idx < trimmed.length; idx++) {
    const ch = trimmed[idx]
    if (ch === '(' || ch === '{' || ch === '[') depth += 1
    else if ((ch === ')' || ch === '}' || ch === ']') && depth > 0) depth -= 1
    else if (ch === ',' && depth === 0) {
      const binder = trimmed.slice(1, idx).trim()
      const body = trimmed.slice(idx + 1).trim()
      if (!binder || !body) return null
      return { quantifier, binder, body }
    }
  }
  return null
}

function binderNames(binder: string): string[] {
  let inner = binder.trim()
  const opens = '({['
  const closes = ')}]'
  const openIndex = opens.indexOf(inner[0] ?? '')
  if (openIndex >= 0 && inner.endsWith(closes[openIndex]!)) {
    inner = inner.slice(1, -1).trim()
  }
  const colonIndex = inner.indexOf(':')
  const declared = (colonIndex >= 0 ? inner.slice(0, colonIndex) : inner).trim()
  return declared.split(/\s+/u).filter(Boolean)
}

/**
 * Canonically rename the leading `∃`/`∀` binders so that alpha-equivalent
 * statements compare equal as text. `∃ b, a = succ b` and `∃ n, a = succ n`
 * are the same proposition, and Lean accepts either as a proof of the other;
 * only the rendered binder name differed.
 */
export function alphaNormalizeBinders(text: string): string {
  // A canonical name must be an identifier the source text cannot contain, or
  // renaming an inner binder could collide with an already-renamed outer one.
  let prefix = 'bv'
  while (text.includes(prefix)) prefix = `${prefix}v`

  const normalizeFrom = (form: string, depth: number): string => {
    const parsed = splitTopLevelBinderForm(form)
    if (!parsed) return form.trim()
    const names = binderNames(parsed.binder)
    if (names.length === 0) return form.trim()
    let binder = parsed.binder
    let body = parsed.body
    names.forEach((name, index) => {
      const canonical = `${prefix}${depth + index}`
      binder = replaceIdentifier(binder, name, canonical)
      body = replaceIdentifier(body, name, canonical)
    })
    return `${parsed.quantifier} ${binder}, ${normalizeFrom(body, depth + names.length)}`
  }

  return normalizeFrom(text, 0)
}
