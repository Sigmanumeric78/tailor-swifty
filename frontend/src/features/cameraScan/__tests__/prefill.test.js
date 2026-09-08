import { describe, expect, it } from 'vitest'
import { mergeMeasurementPrefill, millimetresToUnit } from '../prefill'

const estimates = {
  chest_circumference: { value_mm: 1000, confidence: .8 },
  waist_circumference: { value_mm: 800, confidence: .54 },
  hip_circumference: { value_mm: null, confidence: .9 },
}

describe('camera and photo prefill units', () => {
  it('converts millimetres to centimetres', () => { expect(millimetresToUnit(1000, 'cm')).toBe(100); expect(mergeMeasurementPrefill({}, estimates, 'cm')).toEqual({ chest_circumference: '100.00' }) })
  it('converts millimetres to inches without changing units', () => { expect(millimetresToUnit(254, 'in')).toBeCloseTo(10); expect(mergeMeasurementPrefill({}, { chest_circumference: { value_mm: 254, confidence: .8 } }, 'in')).toEqual({ chest_circumference: '10.00' }) })
  it('preserves manual values and skips low-quality and null estimates', () => { expect(mergeMeasurementPrefill({ chest_circumference: '39' }, estimates, 'in')).toEqual({ chest_circumference: '39' }) })
})
