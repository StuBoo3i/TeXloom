export type ContentBounds = { x: number; y: number; width: number; height: number }

export function pdfContentBounds(pixels: Uint8ClampedArray, width: number, height: number, threshold = 246): ContentBounds | null {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return null
  let left = width; let top = height; let right = -1; let bottom = -1
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const at = (y * width + x) * 4
      if (pixels[at + 3] < 16 || pixels[at] >= threshold && pixels[at + 1] >= threshold && pixels[at + 2] >= threshold) continue
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  return right < left ? null : { x: left, y: top, width: Math.min(width - left, right - left + 2), height: Math.min(height - top, bottom - top + 2) }
}

export function paddedBounds(bounds: ContentBounds, width: number, height: number, padding: number): ContentBounds {
  const x = Math.max(0, bounds.x - padding)
  const y = Math.max(0, bounds.y - padding)
  const right = Math.min(width, bounds.x + bounds.width + padding)
  const bottom = Math.min(height, bounds.y + bounds.height + padding)
  return { x, y, width: right - x, height: bottom - y }
}
