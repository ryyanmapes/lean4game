import { useCallback, useRef } from 'react'
import type { TouchEvent } from 'react'

interface SwipePagingOptions {
  currentPage: number
  totalPages: number
  disabled?: boolean
  onPageChange: (page: number) => void
}

const MIN_SWIPE_PX = 44
const HORIZONTAL_BIAS = 1.25

export function useSwipePaging({
  currentPage,
  totalPages,
  disabled = false,
  onPageChange,
}: SwipePagingOptions) {
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (disabled || event.touches.length !== 1) {
      startRef.current = null
      return
    }
    const touch = event.touches[0]
    startRef.current = { x: touch.clientX, y: touch.clientY }
  }, [disabled])

  const onTouchCancel = useCallback(() => {
    startRef.current = null
  }, [])

  const onTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = startRef.current
    startRef.current = null
    if (disabled || !start || event.changedTouches.length !== 1) return

    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    if (absX < MIN_SWIPE_PX || absX < absY * HORIZONTAL_BIAS) return

    const direction = dx < 0 ? 1 : -1
    const nextPage = Math.min(Math.max(0, currentPage + direction), totalPages - 1)
    if (nextPage !== currentPage) onPageChange(nextPage)
  }, [currentPage, disabled, onPageChange, totalPages])

  return { onTouchStart, onTouchEnd, onTouchCancel }
}

/**
 * A sideways swipe anywhere on an element: `onSwipe` is told which way the finger
 * went. `cancel` forgets a touch in progress, for when it turned out to be a drag.
 */
export function useHorizontalSwipe(onSwipe: (direction: 'left' | 'right') => void, disabled = false) {
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (disabled || event.touches.length !== 1) {
      startRef.current = null
      return
    }
    const touch = event.touches[0]
    startRef.current = { x: touch.clientX, y: touch.clientY }
  }, [disabled])

  const cancel = useCallback(() => {
    startRef.current = null
  }, [])

  const onTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = startRef.current
    startRef.current = null
    if (disabled || !start || event.changedTouches.length !== 1) return

    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < MIN_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * HORIZONTAL_BIAS) return
    onSwipe(dx < 0 ? 'left' : 'right')
  }, [disabled, onSwipe])

  return { handlers: { onTouchStart, onTouchEnd, onTouchCancel: cancel }, cancel }
}
