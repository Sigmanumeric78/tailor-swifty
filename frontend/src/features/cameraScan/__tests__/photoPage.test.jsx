import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CameraModelRegistry } from '../services/modelRegistry'
import { renderApp } from '../../../test/renderApp'
import { jsonResponse, schema } from '../../../test/fixtures'

function installBitmapDecoder() {
  const original = { width: 1000, height: 1600, close: vi.fn() }
  const normalized = { width: 1000, height: 1600, close: vi.fn() }
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width, height) { this.width = width; this.height = height; this.context = { drawImage: vi.fn(), clearRect: vi.fn() } }
    getContext() { return this.context }
  })
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(normalized))
  return { original, normalized }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('does not request camera permission, initialize models, store data, or upload when opened', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const getUserMedia = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  const initialize = vi.spyOn(CameraModelRegistry.prototype, 'initialize')
  const local = vi.spyOn(Storage.prototype, 'setItem')
  renderApp({ route: '/measurements/photos' })
  expect(await screen.findByRole('button', { name: /process photos locally/i })).toBeInTheDocument()
  expect(getUserMedia).not.toHaveBeenCalled(); expect(initialize).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled()
})

it('closes a selected bitmap when it is removed', async () => {
  const { normalized } = installBitmapDecoder(); const user = userEvent.setup()
  renderApp({ route: '/measurements/photos' })
  await user.upload(await screen.findByLabelText(/select front photos/i), new File(['pixels'], 'front.jpg', { type: 'image/jpeg', lastModified: 1 }))
  await user.click(await screen.findByRole('button', { name: /remove front photo front.jpg/i }))
  expect(normalized.close).toHaveBeenCalledOnce()
})

it('closes selected bitmaps on cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
  const { normalized } = installBitmapDecoder(); const user = userEvent.setup()
  renderApp({ route: '/measurements/photos', flow: { schema } })
  await user.upload(await screen.findByLabelText(/select front photos/i), new File(['pixels'], 'front.jpg', { type: 'image/jpeg', lastModified: 1 }))
  await user.click(await screen.findByRole('button', { name: /^cancel and forget photos$/i }))
  await waitFor(() => expect(normalized.close).toHaveBeenCalledOnce())
})

it('closes selected bitmaps when the page unmounts', async () => {
  const { normalized } = installBitmapDecoder(); const user = userEvent.setup()
  const rendered = renderApp({ route: '/measurements/photos' })
  await user.upload(await screen.findByLabelText(/select front photos/i), new File(['pixels'], 'front.jpg', { type: 'image/jpeg', lastModified: 1 }))
  rendered.unmount()
  expect(normalized.close).toHaveBeenCalledOnce()
})
