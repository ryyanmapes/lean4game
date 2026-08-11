import * as React from 'react'

import '../css/annotated_level_title.css'

const TITLE_ANNOTATIONS: Record<string, string> = {
  '⏭️': 'Skipped in Visual Lean',
  '❌': 'Does not count towards completion',
  '🌶️': 'Difficult level',
}

const TITLE_TOKEN = /(`[^`]+`|⏭️|❌|🌶️)/gu

export function plainLevelTitle(title: string, expandAnnotations = false): string {
  let plain = title.replace(/`([^`]+)`/gu, '$1')
  if (expandAnnotations) {
    for (const [emoji, explanation] of Object.entries(TITLE_ANNOTATIONS)) {
      plain = plain.replaceAll(emoji, `${emoji} (${explanation})`)
    }
  }
  return plain
}

export function AnnotatedLevelTitle({ title }: { title: string }) {
  const parts = title.split(TITLE_TOKEN).filter(Boolean)
  const [openAnnotation, setOpenAnnotation] = React.useState<number | null>(null)

  return <span className="annotated-level-title">
    {parts.map((part, index) => {
      const explanation = TITLE_ANNOTATIONS[part]
      if (explanation) {
        const open = openAnnotation === index
        return <span className={`level-title-annotation${open ? ' open' : ''}`} key={`${part}-${index}`}>
          <button
            type="button"
            className="level-title-emoji"
            aria-label={`${part}: ${explanation}`}
            aria-expanded={open}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setOpenAnnotation(current => current === index ? null : index)
            }}
            onBlur={() => setOpenAnnotation(null)}
          >{part}</button>
          <span className="level-title-annotation-text" role="tooltip">{explanation}</span>
        </span>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={`code-${index}`}>{part.slice(1, -1)}</code>
      }
      return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
    })}
  </span>
}
