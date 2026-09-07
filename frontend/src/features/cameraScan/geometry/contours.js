import { median } from './statistics'

export function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length)
  const components = []
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue
    const queue = [index]
    const pixels = []
    visited[index] = 1
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]
      pixels.push(current)
      const x = current % width
      const y = Math.floor(current / width)
      const neighbours = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1]
      for (const next of neighbours) if (next >= 0 && mask[next] && !visited[next]) { visited[next] = 1; queue.push(next) }
    }
    components.push(pixels)
  }
  return components
}

export function largestConnectedComponent(mask, width, height) {
  const largest = connectedComponents(mask, width, height).sort((a, b) => b.length - a.length)[0] || []
  const result = new Uint8Array(mask.length)
  largest.forEach((index) => { result[index] = 1 })
  return result
}

export function maskBounds(mask, width, height) {
  let minX = width; let maxX = -1; let minY = height; let maxY = -1
  mask.forEach((value, index) => {
    if (!value) return
    const x = index % width; const y = Math.floor(index / width)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  })
  return maxX < 0 ? null : { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function scanlineIntervals(mask, width, y) {
  const intervals = []
  let start = null
  for (let x = 0; x <= width; x += 1) {
    const foreground = x < width && mask[y * width + x]
    if (foreground && start == null) start = x
    if (!foreground && start != null) { intervals.push({ start, end: x - 1, width: x - start }); start = null }
  }
  return intervals
}

export function torsoScanlineWidth(mask, width, height, y, torsoCenterX, band = 2) {
  const widths = []
  for (let row = Math.max(0, Math.round(y - band)); row <= Math.min(height - 1, Math.round(y + band)); row += 1) {
    const intervals = scanlineIntervals(mask, width, row)
    const connected = intervals.find((interval) => torsoCenterX >= interval.start && torsoCenterX <= interval.end)
    if (connected) widths.push(connected.width)
  }
  return widths.length ? { widthPx: median(widths), y: Math.round(y), samples: widths.length } : { widthPx: null, y: Math.round(y), samples: 0, reason: 'NO_TORSO_INTERVAL' }
}
