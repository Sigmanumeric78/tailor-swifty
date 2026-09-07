import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { mergeCameraPrefill } from '../../../pages/CameraScanPage'
import { stopMediaStream } from '../hooks/useCameraStream'
import { jsonResponse, schema } from '../../../test/fixtures'
import { renderApp } from '../../../test/renderApp'

afterEach(() => vi.restoreAllMocks())

it('opens the lazy camera route from manual measurement', async () => { vi.stubGlobal('fetch', vi.fn(() => jsonResponse(schema))); const user = userEvent.setup(); renderApp({ route: '/measurements', flow: { schema } }); await user.click(await screen.findByRole('button', { name: /use camera scan/i })); expect(await screen.findByRole('button', { name: /start camera scan/i })).toBeInTheDocument() })
it('shows a manual fallback before camera permission is requested', async () => { const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia'); renderApp({ route: '/measurements/camera' }); expect(await screen.findByRole('button', { name: /return to manual measurements/i })).toBeInTheDocument(); expect(getUserMedia).not.toHaveBeenCalled() })
it('prefills valid values and never overwrites a manual value', () => { const estimates = { chest_circumference: { measurement_code: 'chest_circumference', value_mm: 1000, confidence: .8 }, waist_circumference: { measurement_code: 'waist_circumference', value_mm: 800, confidence: .8 }, shirt_length: { measurement_code: 'shirt_length', value_mm: null, confidence: 0 } }; expect(mergeCameraPrefill({ chest_circumference: '99' }, estimates)).toEqual({ chest_circumference: '99', waist_circumference: '80.00' }) })
it('stops every media track during cleanup', () => { const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]; stopMediaStream({ getTracks: () => tracks }); tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce()) })
