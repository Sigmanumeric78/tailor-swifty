import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, schema } from '../../../test/fixtures'
import { renderApp } from '../../../test/renderApp'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('opens the browser-research camera route from manual measurement', async () => {
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
  const user = userEvent.setup()
  renderApp({ route: '/measurements', flow: { schema } })
  await user.click(await screen.findByRole('button', { name: /use live camera/i }))
  expect(await screen.findByRole('button', { name: /start camera scan/i })).toBeInTheDocument()
})

it('opens the browser-research photo route without camera permission or model loading', async () => {
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const user = userEvent.setup()
  renderApp({ route: '/measurements', flow: { schema } })
  await user.click(await screen.findByRole('button', { name: /use existing photos/i }))
  expect(await screen.findByRole('button', { name: /process photos locally/i })).toBeInTheDocument()
  expect(getUserMedia).not.toHaveBeenCalled()
})

it('shows the browser-research manual fallback before camera permission is requested', async () => {
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  renderApp({ route: '/measurements/camera' })
  expect(await screen.findByRole('button', { name: /return to manual measurements/i })).toBeInTheDocument()
  expect(getUserMedia).not.toHaveBeenCalled()
})
