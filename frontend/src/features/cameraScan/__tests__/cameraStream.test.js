import { describe, expect, it, vi } from 'vitest'
import { cameraConstraintLadder, cameraDisplayName, normalizeCameraCapabilities, requestNeutralZoom } from '../hooks/useCameraStream'

describe('phone camera compatibility', () => {
  it('uses ideal-only constraints followed by progressively broader fallbacks', () => {
    const ladder = cameraConstraintLadder('rear-id')
    expect(ladder).toEqual([
      { deviceId: { exact: 'rear-id' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { deviceId: { exact: 'rear-id' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { deviceId: { exact: 'rear-id' } },
    ])
    expect(JSON.stringify(ladder)).not.toMatch(/minimum|min\b/)
  })

  it('uses browser-selected video as the final automatic fallback', () => { expect(cameraConstraintLadder('')[2]).toBe(true) })

  it('normalizes only non-identifying capability fields and requests neutral zoom', async () => {
    const applyConstraints = vi.fn(async () => {})
    const track = { getCapabilities: () => ({ zoom: { min: 1, max: 4, step: .1 }, torch: [false, true], deviceId: 'secret' }), getSettings: () => ({ width: 1920, height: 1080, frameRate: 30, facingMode: 'environment', deviceId: 'secret' }), applyConstraints }
    expect(normalizeCameraCapabilities(track)).toMatchObject({ width: 1920, height: 1080, frameRate: 30, facingMode: 'environment', torchAvailable: true })
    expect(normalizeCameraCapabilities(track)).not.toHaveProperty('deviceId')
    await expect(requestNeutralZoom(track)).resolves.toBe(true)
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1 }] })
  })

  it('labels known front and rear cameras clearly', () => {
    expect(cameraDisplayName({ label: 'Back Camera' }, 0)).toMatch(/^Rear camera/)
    expect(cameraDisplayName({ label: 'FaceTime HD Camera' }, 1)).toMatch(/^Front camera/)
  })
})
