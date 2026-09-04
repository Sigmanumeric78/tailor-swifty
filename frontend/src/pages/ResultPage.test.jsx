import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { measurements, result, schema, jsonResponse } from '../test/fixtures'
import { renderApp } from '../test/renderApp'

afterEach(() => vi.restoreAllMocks())

it('a valid reviewed form reaches the result screen', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (String(url).includes('/submit')) return jsonResponse({ id: 'session-1', status: 'accepted' })
    if (String(url).endsWith('/recommendations')) return jsonResponse(result, 201)
    return jsonResponse({})
  }))
  renderApp({ route: '/review', flow: { schema, measurements, session: { id: 'session-1' } } })
  await user.click(await screen.findByRole('button', { name: /create recommendation/i }))
  expect(await screen.findByRole('heading', { name: 'Breathable linen shirt' })).toBeInTheDocument()
})

it('displays score, reasons, warnings, and finished measurements', async () => {
  renderApp({ route: '/results/rec-1', flow: { result } })
  expect(await screen.findByText('100')).toBeInTheDocument()
  expect(screen.getByText('Designed for smart casual occasions.')).toBeInTheDocument()
  expect(screen.getByText('Ease allowances are provisional development values.')).toBeInTheDocument()
  expect(screen.getByText('1160 mm')).toBeInTheDocument()
  expect(screen.getByText(/Rules v1/)).toBeInTheDocument()
})

it('can recover a saved result directly from the API', async () => {
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse(result)))
  renderApp({ route: '/results/rec-1' })
  expect(await screen.findByText('Light and comfortable for warm days.')).toBeInTheDocument()
})
