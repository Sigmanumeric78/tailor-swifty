import { describe, expect, it, vi } from 'vitest'
import { binaryMaskFromRgba, BodyPixSegmentationService, selectTensorFlowBackend } from '../services/bodyPixSegmentationService'

describe('BodyPix RGBA conversion', () => {
  it('uses one alpha value per output pixel', () => {
    const rgba = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255]) }
    expect([...binaryMaskFromRgba(rgba, .65)]).toEqual([0, 1])
  })

  it('rejects malformed RGBA buffers', () => {
    expect(() => binaryMaskFromRgba({ width: 2, height: 1, data: new Uint8ClampedArray(7) }, .65)).toThrow(/invalid RGBA mask/)
  })
})

describe('TensorFlow backend selection', () => {
  const tensorflow = (results, selected) => ({
    setBackend: vi.fn(async (name) => {
      const result = results[name]
      if (result instanceof Error) throw result
      if (result) selected.current = name
      return result
    }),
    ready: vi.fn(async () => {}),
    getBackend: vi.fn(() => selected.current),
  })

  it('keeps WebGL when registration and selection succeed', async () => {
    const selected = { current: null }; const tf = tensorflow({ webgl: true }, selected); const loadWebgl = vi.fn(async () => ({})); const loadWasm = vi.fn()
    await expect(selectTensorFlowBackend(tf, { loadWebgl, loadWasm })).resolves.toBe('webgl')
    expect(loadWebgl).toHaveBeenCalledOnce(); expect(loadWasm).not.toHaveBeenCalled(); expect(tf.ready).toHaveBeenCalledOnce()
  })

  it('falls back to WASM when WebGL resolves false', async () => {
    const selected = { current: null }; const tf = tensorflow({ webgl: false, wasm: true }, selected); const wasm = { setWasmPaths: vi.fn() }
    await expect(selectTensorFlowBackend(tf, { loadWebgl: async () => ({}), loadWasm: async () => wasm })).resolves.toBe('wasm')
    expect(wasm.setWasmPaths).toHaveBeenCalledWith('/models/tensorflow/wasm/')
  })

  it('falls back to WASM when WebGL rejects', async () => {
    const selected = { current: null }; const tf = tensorflow({ webgl: new Error('disabled'), wasm: true }, selected)
    await expect(selectTensorFlowBackend(tf, { loadWebgl: async () => ({}), loadWasm: async () => ({ setWasmPaths: vi.fn() }) })).resolves.toBe('wasm')
  })

  it('falls back to WASM when WebGL readiness fails', async () => {
    const selected = { current: null }; const tf = tensorflow({ webgl: true, wasm: true }, selected); let calls = 0
    tf.ready = vi.fn(async () => { calls += 1; if (calls === 1) throw new Error('context lost') })
    await expect(selectTensorFlowBackend(tf, { loadWebgl: async () => ({}), loadWasm: async () => ({ setWasmPaths: vi.fn() }) })).resolves.toBe('wasm')
  })

  it('falls back when WebGL reports selected but backend verification mismatches', async () => {
    let active = 'cpu'
    const tf = { setBackend: vi.fn(async (name) => { if (name === 'wasm') active = 'wasm'; return true }), ready: vi.fn(async () => {}), getBackend: vi.fn(() => active) }
    await expect(selectTensorFlowBackend(tf, { loadWebgl: async () => ({}), loadWasm: async () => ({ setWasmPaths: vi.fn() }) })).resolves.toBe('wasm')
  })

  it('reports both attempted backends when neither initializes', async () => {
    const selected = { current: null }; const tf = tensorflow({ webgl: false, wasm: false }, selected)
    await expect(selectTensorFlowBackend(tf, { loadWebgl: async () => ({}), loadWasm: async () => ({ setWasmPaths: vi.fn() }) })).rejects.toThrow('MODEL_BACKEND_UNAVAILABLE: webgl, wasm')
  })
})

describe('BodyPix backend-compatible inference options', () => {
  it('disables unsupported body-part decoding on WASM while retaining person segmentation', async () => {
    const service = new BodyPixSegmentationService(); service.selectedBackend = 'wasm'; const dispose = vi.fn()
    service.segmenter = { segmentPeople: vi.fn(async () => [{ mask: { toImageData: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }), dispose } }]) }
    const result = await service.segment({ width: 1, height: 1 })
    expect(service.segmenter.segmentPeople).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ segmentBodyParts: false }))
    expect([...result.binaryMask]).toEqual([1])
    expect(dispose).toHaveBeenCalledOnce()
  })
})
