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

function expandTopLevelLessOrEqual(displayText: string): string | null {
  if (!displayText.includes('≤')) return null
  let depth = 0
  let lessOrEqualIndex = -1
  for (let index = 0; index < displayText.length; index += 1) {
    const char = displayText[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth < 0) return null
    } else if (depth === 0 && (char === '→' || char === '∧' || char === '∨')) {
      return null
    } else if (depth === 0 && char === '≤') {
      if (lessOrEqualIndex >= 0) return null
      lessOrEqualIndex = index
    }
  }
  if (depth !== 0 || lessOrEqualIndex < 0) return null
  const lhs = displayText.slice(0, lessOrEqualIndex).trim()
  const rhs = displayText.slice(lessOrEqualIndex + 1).trim()
  if (!lhs || !rhs) return null
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

    const trimmed = form.trim()
    if (!trimmed.startsWith('\u00ac')) continue

    const negatedBody = trimmed.slice(1).trim()
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
  const isNegation = displayed.startsWith('¬') || displayed.includes('≠')
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
  const notEqual = /^(.*?)\s*≠\s*(.*?)$/u.exec(displayed)
  if (notEqual) {
    const [, lhs = '', rhs = ''] = notEqual
    return [`${lhs.trim()} = ${rhs.trim()} → False`]
  }

  const expandedLessOrEqual = expandTopLevelLessOrEqual(displayed)
  if (expandedLessOrEqual) return [expandedLessOrEqual]

  return []
}
