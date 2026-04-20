function normalizeTheoremStatement(statement: string): string {
  return statement
    .replace(/\u00e2\u2020\u2019/g, '\u2192')
    .replace(/\u00e2\u2020\u0090/g, '\u2190')
    .replace(/\u00e2\u2020\u201d/g, '\u2194')
    .replace(/\u00e2\u2030\u00a0/g, '\u2260')
    .replace(/\u00e2\u2030\u00a4/g, '\u2264')
    .replace(/\u00e2\u2030\u00a5/g, '\u2265')
    .replace(/\u00e2\u02c6\u00a7/g, '\u2227')
    .replace(/\u00e2\u02c6\u00a8/g, '\u2228')
    .replace(/\u00c2\u00ac/g, '\u00ac')
    .replace(/\u00e2\u02c6\u20ac/g, '\u2200')
    .replace(/\u00e2\u201e\u00a2/g, '\u2115')
    .replace(/\bMyNat\./g, '')
    .replace(/\bNat\./g, '')
    .trim()
}

type BinderDelimiter = '(' | '{' | '[' | '⦃'

interface BinderToken {
  opener: BinderDelimiter
  closer: string
  content: string
  rest: string
}

interface ParsedBinder {
  text: string
  name?: string
}

function matchingCloser(opener: BinderDelimiter): string {
  switch (opener) {
    case '(':
      return ')'
    case '{':
      return '}'
    case '[':
      return ']'
    case '⦃':
      return '⦄'
  }
}

function splitLeadingBinderToken(statement: string): BinderToken | null {
  const trimmed = statement.trim()
  const opener = trimmed[0] as BinderDelimiter | undefined
  if (!opener || !(['(', '{', '[', '⦃'] as const).includes(opener)) return null

  const closer = matchingCloser(opener)
  const stack: string[] = []

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '(' || ch === '{' || ch === '[' || ch === '⦃') {
      stack.push(matchingCloser(ch as BinderDelimiter))
      continue
    }
    if (stack.length > 0 && ch === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) {
        return {
          opener,
          closer,
          content: trimmed.slice(1, i).trim(),
          rest: trimmed.slice(i + 1).trim(),
        }
      }
    }
  }

  return null
}

function stripOuterParens(statement: string): string {
  let current = statement.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0
    let wrapsWhole = true
    for (let i = 0; i < current.length; i++) {
      if (current[i] === '(') depth += 1
      else if (current[i] === ')') {
        depth -= 1
        if (depth === 0 && i < current.length - 1) {
          wrapsWhole = false
          break
        }
      }
    }
    if (!wrapsWhole) break
    current = current.slice(1, -1).trim()
  }
  return current
}

function splitTopLevelImplications(statement: string): string[] {
  statement = stripOuterParens(statement)
  let depth = 0
  let segmentStart = 0
  const segments: string[] = []

  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (depth === 0) {
      let tokenLength = 0

      if (statement.slice(i, i + 1) === '\u2192') tokenLength = 1
      else if (statement.slice(i, i + 2) === '->') tokenLength = 2
      else if (statement.slice(i, i + 2) === '=>') tokenLength = 2
      else if (statement.slice(i, i + 3) === '\\to') tokenLength = 3
      else if (statement.slice(i, i + 8) === '\\implies') tokenLength = 8

      if (tokenLength > 0) {
        segments.push(statement.slice(segmentStart, i).trim())
        segmentStart = i + tokenLength
        i += tokenLength - 1
      }
    }
  }

  if (segments.length === 0) return [statement]
  segments.push(statement.slice(segmentStart).trim())
  return segments
}

function hasTopLevelImplication(statement: string): boolean {
  return splitTopLevelImplications(statement).length > 1
}

function hasVisibleRelation(statement: string): boolean {
  const normalized = stripOuterParens(statement)
  return /[=<>≠≤≥≡]/u.test(normalized)
}

function isSimplePropositionAtom(statement: string): boolean {
  const normalized = stripOuterParens(statement.trim())
  return normalized === 'Prop' || /^[A-Z]$/u.test(normalized)
}

function looksLikeProposition(statement: string): boolean {
  const normalized = stripOuterParens(statement.trim())
  if (!normalized) return false

  if (hasVisibleRelation(normalized)
    || normalized.includes('\u2227')
    || normalized.includes('\u2228')
    || normalized.startsWith('\u00ac')
    || normalized === 'False'
    || normalized === 'True'
    || isSimplePropositionAtom(normalized)) {
    return true
  }

  const implicationParts = splitTopLevelImplications(normalized)
  if (implicationParts.length > 1) {
    return looksLikeProposition(implicationParts[implicationParts.length - 1] ?? '')
  }

  return false
}

function isPropositionBinderType(type: string): boolean {
  return looksLikeProposition(type)
}

function parseBinderNames(rawNames: string): string[] {
  return rawNames
    .split(/[\s,]+/u)
    .map(name => name.trim())
    .filter(Boolean)
}

function expandBinderToken(token: BinderToken): ParsedBinder[] {
  const colonIdx = token.content.lastIndexOf(':')
  if (colonIdx === -1) {
    return [{ text: `${token.opener}${token.content}${token.closer}` }]
  }

  const namesPart = token.content.slice(0, colonIdx).trim()
  const typePart = token.content.slice(colonIdx + 1).trim()
  const names = parseBinderNames(namesPart)
  if (names.length === 0 || typePart.length === 0) {
    return [{ text: `${token.opener}${token.content}${token.closer}` }]
  }

  return names.map(name => ({
    text: `${token.opener}${name} : ${typePart}${token.closer}`,
    name,
  }))
}

function parseLeadingBinders(statement: string): { binders: BinderToken[]; rest: string } {
  let rest = statement.trim()
  const binders: BinderToken[] = []

  while (true) {
    const token = splitLeadingBinderToken(rest)
    if (!token) break
    binders.push(token)
    rest = token.rest
  }

  return { binders, rest }
}

function parseForallFooterBinders(footer?: string): ParsedBinder[] {
  if (!footer) return []
  let rest = footer.trim()
  if (rest.startsWith('∀')) rest = rest.slice(1).trim()

  const binders: ParsedBinder[] = []
  while (rest.length > 0) {
    const token = splitLeadingBinderToken(rest)
    if (!token) break
    binders.push(...expandBinderToken(token))
    rest = token.rest
  }
  return binders
}

function buildForallFooter(binders: string[]): string | undefined {
  if (binders.length === 0) return undefined
  return `\u2200 ${binders.join(' ')}`
}

function buildForallSpecification(
  mainText: string,
  binders: ParsedBinder[],
): ForallSpecificationInfo | undefined {
  const [firstBinder, ...remainingBinders] = binders
  if (!firstBinder?.name) return undefined

  const t = firstBinder.text
  const isImplicit = t.startsWith('{') || t.startsWith('[') || t.startsWith('⦃')

  return {
    varName: firstBinder.name,
    body: remainingBinders.length > 0
      ? `\u2200 ${remainingBinders.map(binder => binder.text).join(' ')}, ${mainText}`
      : mainText,
    isImplicit,
  }
}

export interface ForallSpecificationInfo {
  varName: string
  body: string
  /** True when the binder uses `{...}` or `[...]` syntax (implicit/instance). */
  isImplicit: boolean
}

export interface QuantifiedStatementDisplay {
  mainText: string
  forallFooter?: string
  forallSpecification?: ForallSpecificationInfo
}

export function buildPropositionTheoremDisplay(statement: string): QuantifiedStatementDisplay {
  let rest = normalizeTheoremStatement(statement)
  const premises: string[] = []
  const forallBinders: ParsedBinder[] = []

  const parsed = parseLeadingBinders(rest)
  for (const binderToken of parsed.binders) {
    const colonIdx = binderToken.content.lastIndexOf(':')
    const binderType = colonIdx === -1 ? '' : binderToken.content.slice(colonIdx + 1).trim()
    const expandedBinders = expandBinderToken(binderToken)
    if (binderType && isPropositionBinderType(binderType)) {
      premises.push(...expandedBinders.map(() => binderType))
    } else {
      forallBinders.push(...expandedBinders)
    }
  }
  rest = parsed.rest

  if (rest.startsWith(':')) rest = rest.slice(1).trim()
  const mainText = premises.length > 0 ? `${premises.join(' \u2192 ')} \u2192 ${rest}` : rest
  return {
    mainText,
    forallFooter: buildForallFooter(forallBinders.map(binder => binder.text)),
    forallSpecification: buildForallSpecification(mainText, forallBinders),
  }
}

export function buildEqualityTheoremDisplay(statement: string): QuantifiedStatementDisplay {
  let rest = normalizeTheoremStatement(statement)
  const parsed = parseLeadingBinders(rest)
  const forallBinders = parsed.binders.flatMap(expandBinderToken)
  rest = parsed.rest

  if (rest.startsWith(':')) rest = rest.slice(1).trim()
  return {
    mainText: rest,
    forallFooter: buildForallFooter(forallBinders.map(binder => binder.text)),
    forallSpecification: buildForallSpecification(rest, forallBinders),
  }
}

export function buildForallSpecificationFromDisplay(
  mainText: string,
  forallFooter?: string,
): ForallSpecificationInfo | undefined {
  return buildForallSpecification(mainText.trim(), parseForallFooterBinders(forallFooter))
}
