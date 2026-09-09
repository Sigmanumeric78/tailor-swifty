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
    await screen.findByLabelText(schema.fields[0].label)
    for (const field of schema.fields) expect(screen.getByLabelText(field.label)).toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(8)
  })

  it('switches units without changing the physical value', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
    renderApp({ route: '/measurements', flow: { schema, measurements: { ...measurements, chest_circumference: '100' }, unit: 'cm' } })
    await user.click(await screen.findByRole('button', { name: 'in' }))
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
    await user.click(await screen.findByRole('button', { name: /check and continue/i }))
    expect(await screen.findByText('Confirm this chest value.')).toBeInTheDocument()
    expect(screen.getByLabelText('Chest circumference')).toHaveAttribute('aria-invalid', 'true')
  })

  it('preserves measurements when navigating back from style', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema)))
    renderApp({ route: '/preferences', flow: { schema, measurements, unit: 'cm' } })
    await user.click(await screen.findByRole('button', { name: /^back$/i }))
    await waitFor(() => expect(screen.getByLabelText('Neck circumference')).toHaveValue(Number(measurements.neck_circumference)))
  })

  it('submits only reviewed numeric and non-identifying camera provenance', async () => {
    const user = userEvent.setup(); const fetch = vi.fn((url) => {
      if (String(url).includes('measurement-schema')) return jsonResponse(schema)
      if (String(url).endsWith('measurement-sessions')) return jsonResponse({ id: 'session-1' }, 201)
      if (String(url).includes('/measurements')) return jsonResponse([], 201)
      if (String(url).endsWith('/validate')) return jsonResponse({ valid: false, issues: [] })
      return jsonResponse({})
    }); vi.stubGlobal('fetch', fetch)
    renderApp({ route: '/measurements', flow: { schema, measurements, participant: { id: 'participant-1' }, cameraScan: { status: 'review', pipelineVersion: 'camera-measurement-0.2.1', calibrationMode: 'VERIFIED_HEIGHT', measurements: { chest_circumference: { model_versions: ['pose-v1'] } }, warnings: ['SCALE_DISAGREEMENT'], capabilitySummary: { width: 1920, height: 1080, frameRate: 30, facingMode: 'environment' } } } })
    await user.click(await screen.findByRole('button', { name: /check and continue/i }))
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('measurement-sessions')); const payload = JSON.parse(call[1].body)
    expect(payload).toMatchObject({ input_mode: 'CAMERA_MEASUREMENTS', capture_source: 'live_camera', calibration_mode: 'VERIFIED_HEIGHT', manually_reviewed: true })
    expect(JSON.stringify(payload)).not.toMatch(/base64|blob|landmark|filename|device_label/i)
  })
})
