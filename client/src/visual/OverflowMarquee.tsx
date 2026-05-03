import * as React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

interface OverflowMarqueeProps {
  children: React.ReactNode
  className?: string
}

export function OverflowMarquee({ children, className = '' }: OverflowMarqueeProps) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [overflowPx, setOverflowPx] = useState(0)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    const measure = () => {
      const nextOverflow = Math.ceil(track.scrollWidth - viewport.clientWidth)
      setOverflowPx(nextOverflow > 4 ? nextOverflow : 0)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(track)
    return () => observer.disconnect()
  }, [children])

  const durationSeconds = Math.max(8, Math.min(18, 8 + overflowPx / 18))

  return (
    <span
      ref={viewportRef}
      className={`overflow-marquee${overflowPx > 0 ? ' is-overflowing' : ''}${className ? ` ${className}` : ''}`}
      style={{
        '--marquee-distance': `${overflowPx}px`,
        '--marquee-duration': `${durationSeconds}s`,
      } as React.CSSProperties}
    >
      <span ref={trackRef} className="overflow-marquee-track">
        {children}
      </span>
    </span>
  )
}
