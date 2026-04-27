import * as React from 'react'
import { colorizeFormula } from './colorizeFormula'

export function VisualInfoText({ text }: { text: string }) {
  const lines = text.split(/\n/)
  return (
    <>
      {lines.map((line, lineIndex) => (
        <React.Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {line.split(/(\$[^$]+\$)/g).map((part, partIndex) => {
            if (part.startsWith('$') && part.endsWith('$') && part.length > 1) {
              return <span key={partIndex} className="proposition visual-info-math">{colorizeFormula(part.slice(1, -1))}</span>
            }
            return <React.Fragment key={partIndex}>{part}</React.Fragment>
          })}
        </React.Fragment>
      ))}
    </>
  )
}
