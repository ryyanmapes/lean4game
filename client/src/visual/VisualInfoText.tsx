import * as React from 'react'
import { colorizeFormula } from './colorizeFormula'
import { hintTextForInput, type HintInput } from './levelPresentation'

// A finger is the primary pointer on phones and tablets. A phone held sideways
// gets the desktop layout but is still tapped, so ask about the input, not the
// screen width.
const TOUCH_INPUT_QUERY = '(hover: none) and (pointer: coarse)'

function touchInputQuery(): MediaQueryList | null {
  return typeof window === 'undefined' ? null : window.matchMedia?.(TOUCH_INPUT_QUERY) ?? null
}

function subscribeToHintInput(onChange: () => void): () => void {
  const query = touchInputQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function currentHintInput(): HintInput {
  return touchInputQuery()?.matches ? 'mobile' : 'pc'
}

function useHintInput(): HintInput {
  return React.useSyncExternalStore(subscribeToHintInput, currentHintInput)
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\$[^$]+\$|`[^`]+`|\*[^*]+\*)/gu).map((part, partIndex) => {
    const key = `${keyPrefix}-${partIndex}`
    if (part.startsWith('$') && part.endsWith('$') && part.length > 1) {
      return <span key={key} className="proposition visual-info-math">{colorizeFormula(part.slice(1, -1))}</span>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 1) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <React.Fragment key={key}>{part}</React.Fragment>
  })
}

export function VisualInfoText({ text }: { text: string }) {
  const input = useHintInput()
  const [revealedLines, setRevealedLines] = React.useState<Set<number>>(() => new Set())
  React.useEffect(() => setRevealedLines(new Set()), [text])
  const lines = hintTextForInput(text, input).split(/\n/)
  return (
    <>
      {lines.map((line, lineIndex) => {
        const reveal = /^\s*\[Click to reveal:\s*(.+)\]\s*$/u.exec(line)
        const revealed = revealedLines.has(lineIndex)
        return <React.Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {reveal
            ? <span className="visual-info-reveal">
                <button
                  type="button"
                  className="visual-info-reveal-button"
                  aria-expanded={revealed}
                  onClick={() => setRevealedLines(previous => {
                    const next = new Set(previous)
                    if (next.has(lineIndex)) next.delete(lineIndex)
                    else next.add(lineIndex)
                    return next
                  })}
                >{input === 'mobile' ? 'Tap to reveal' : 'Click to reveal'}</button>
                {revealed && <>
                  <br />
                  <span className="visual-info-reveal-answer">{renderInline(reveal[1]!, `answer-${lineIndex}`)}</span>
                </>}
              </span>
            : renderInline(line, `line-${lineIndex}`)}
        </React.Fragment>
      })}
    </>
  )
}
