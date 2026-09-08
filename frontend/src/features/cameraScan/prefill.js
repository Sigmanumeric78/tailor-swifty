import { scanConfig } from './scanConfig'

export function millimetresToUnit(valueMm, unit) {
  if (!Number.isFinite(valueMm)) return null
  if (unit === 'cm') return valueMm / 10
  if (unit === 'in') return valueMm / 25.4
  throw new Error(`Unsupported measurement unit: ${unit}`)
}

export function mergeMeasurementPrefill(existing, estimates, unit) {
  const eligible = Object.fromEntries(Object.entries(estimates)
    .filter(([code, item]) => {
      const hasManualValue = existing[code] !== '' && existing[code] != null
      return !hasManualValue && item.value_mm != null && item.confidence >= scanConfig.confidence.mediumMin
    })
    .map(([code, item]) => [code, millimetresToUnit(item.value_mm, unit).toFixed(2)]))
  return { ...eligible, ...existing }
}
