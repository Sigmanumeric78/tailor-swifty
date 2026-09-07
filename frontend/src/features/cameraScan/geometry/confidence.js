import { scanConfig } from '../scanConfig'

const clamp = (value) => Math.max(0, Math.min(1, value))

export function calculateConfidence(components, weights = scanConfig.confidence.weights) {
  return clamp(Object.entries(weights).reduce((score, [name, weight]) => {
    const value = Number.isFinite(components[name]) ? clamp(components[name]) : 0
    return score + value * weight
  }, 0))
}

export function repeatConsistencyConfidence(value, mad, toleranceFraction = scanConfig.repeats.toleranceFraction.default) {
  if (!Number.isFinite(value) || !Number.isFinite(mad) || value <= 0) return 0
  return clamp(1 - (mad / value) / toleranceFraction)
}

export function confidenceBand(score) {
  if (score >= scanConfig.confidence.highMin) return 'high'
  if (score >= scanConfig.confidence.mediumMin) return 'medium'
  return 'low'
}

export function overallConfidence(results) {
  const required = results.filter((result) => result.observable && result.value_mm != null).map((result) => result.confidence)
  if (!required.length) return 0
  return Math.min(...required)
}
