import * as React from 'react'
import { colorizeFormula } from './colorizeFormula'

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
  const [revealedLines, setRevealedLines] = React.useState<Set<number>>(() => new Set())
  React.useEffect(() => setRevealedLines(new Set()), [text])
  const lines = text.split(/\n/)
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
                >Click to reveal</button>
                {revealed && <span className="visual-info-reveal-answer">: {renderInline(reveal[1]!, `answer-${lineIndex}`)}</span>}
              </span>
            : renderInline(line, `line-${lineIndex}`)}
        </React.Fragment>
      })}
    </>
  )
}
