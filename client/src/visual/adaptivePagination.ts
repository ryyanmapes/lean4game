export interface AdaptivePage {
  start: number
  end: number
}

/**
 * Greedily pack ordered items into pages using their rendered widths.
 * A single oversized item is kept on its own page; callers can clip or
 * constrain that card without destabilising the remaining page boundaries.
 */
export function packAdaptivePages(
  widths: number[],
  availableWidth: number,
  gap: number,
): AdaptivePage[] {
  if (widths.length === 0) return [{ start: 0, end: 0 }]
  if (!(availableWidth > 0)) return [{ start: 0, end: widths.length }]

  const pages: AdaptivePage[] = []
  let start = 0
  let used = 0

  widths.forEach((rawWidth, index) => {
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : availableWidth
    const nextUsed = used === 0 ? width : used + gap + width
    if (used > 0 && nextUsed > availableWidth + 0.5) {
      pages.push({ start, end: index })
      start = index
      used = width
    } else {
      used = nextUsed
    }
  })

  pages.push({ start, end: widths.length })
  return pages
}
