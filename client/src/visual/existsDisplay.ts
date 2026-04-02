const IDENTIFIER_CHAR_CLASS = "[\\p{L}\\p{N}_']"

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
  return forms.map(form => contextualizeReductionForm(form, contextNames))
}
