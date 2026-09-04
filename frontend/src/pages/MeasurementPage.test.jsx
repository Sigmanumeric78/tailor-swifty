import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { measurements, schema, jsonResponse } from '../test/fixtures'
import { renderApp } from '../test/renderApp'

afterEach(() => vi.restoreAllMocks())

describe('shirt measurement wizard', () => {
  it('renders the eight backend-defined shirt fields', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
    renderApp({ route: '/measurements', flow: { schema } })
    for (const field of schema.fields) expect(screen.getByLabelText(field.label)).toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(8)
  })

  it('switches units without changing the physical value', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
    renderApp({ route: '/measurements', flow: { schema, measurements: { ...measurements, chest_circumference: '100' }, unit: 'cm' } })
    await user.click(screen.getByRole('button', { name: 'in' }))
    expect(screen.getByLabelText('Chest circumference')).toHaveValue(39.37)
  })

  it('shows a backend field error beside the matching input', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('measurement-schema')) return jsonResponse(schema)
      if (String(url).endsWith('measurement-sessions')) return jsonResponse({ id: 'session-1' }, 201)
      if (String(url).includes('/measurements')) return jsonResponse({ error: { code: 'REQUEST_VALIDATION_ERROR', message: 'Invalid measurements', details: [{ field: 'chest_circumference', message: 'Confirm this chest value.' }] } }, 422)
      return jsonResponse({})
    }))
    renderApp({ route: '/measurements', flow: { schema, measurements, participant: { id: 'participant-1' }, consented: true } })
    await user.click(screen.getByRole('button', { name: /check and continue/i }))
    expect(await screen.findByText('Confirm this chest value.')).toBeInTheDocument()
    expect(screen.getByLabelText('Chest circumference')).toHaveAttribute('aria-invalid', 'true')
  })

  it('preserves measurements when navigating back from style', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
    renderApp({ route: '/preferences', flow: { schema, measurements, unit: 'cm' } })
    await user.click(screen.getByRole('button', { name: /^back$/i }))
    await waitFor(() => expect(screen.getByLabelText('Neck circumference')).toHaveValue(Number(measurements.neck_circumference)))
  })
})

