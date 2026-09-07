export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function medianAbsoluteDeviation(values) {
  const center = median(values)
  return center == null ? null : median(values.map((value) => Math.abs(value - center)))
}

export function selectTemporallySeparatedFrames(frames, count, separationMs) {
  const ranked = [...frames].sort((a, b) => b.qualityScore - a.qualityScore)
  const selected = []
  for (const frame of ranked) {
    if (selected.every((item) => Math.abs(item.timestamp - frame.timestamp) >= separationMs)) selected.push(frame)
    if (selected.length === count) break
  }
  return selected.sort((a, b) => a.timestamp - b.timestamp)
}

export function aggregateRepetitions(estimates, { minimumValid = 3, madMultiplier = 3 } = {}) {
  const valid = estimates.filter((value) => Number.isFinite(value))
  if (valid.length < minimumValid) return { value: null, mad: null, values: valid, sufficient: false }
  const initialMedian = median(valid)
  const initialMad = medianAbsoluteDeviation(valid)
  const filtered = initialMad === 0 ? valid : valid.filter((value) => Math.abs(value - initialMedian) <= madMultiplier * initialMad)
  return { value: median(filtered), mad: medianAbsoluteDeviation(filtered), values: filtered, sufficient: filtered.length >= minimumValid }
}
