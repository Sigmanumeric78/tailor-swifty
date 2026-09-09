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

export function adjustQualityForWarnings(score, warnings = []) {
  const codes = [...new Set(warnings)]
  const multiplier = Math.max(scanConfig.confidence.minimumWarningMultiplier, 1 - codes.length * scanConfig.confidence.warningPenaltyPerCode)
  const adjusted = clamp(score * multiplier)
  return codes.includes('SILHOUETTE_DISAGREEMENT') ? Math.min(adjusted, scanConfig.confidence.mediumMin - 0.01) : adjusted
}

export function overallConfidence(results) {
  const observable = results.filter((result) => result.observable)
  if (observable.some((result) => result.value_mm == null)) return 0
  const required = observable.map((result) => result.confidence)
  if (!required.length) return 0
  return Math.min(...required)
}
