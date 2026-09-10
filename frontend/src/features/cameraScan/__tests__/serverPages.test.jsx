import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { FlowProvider } from '../../FlowContext'

const { camera, api } = vi.hoisted(() => ({
  camera: {
    stream: null,
    devices: [],
    capabilitySnapshot: null,
    start: vi.fn().mockResolvedValue({}),
    stop: vi.fn(),
  },
  api: {
    cameraProcessingConsent: vi.fn().mockResolvedValue({ granted: true }),
    cameraProcessingSession: vi.fn().mockResolvedValue({ session_token: 'memory-only-session', expires_at: 9999999999 }),
  },
}))

vi.mock('../../../api/client', () => ({ api }))
vi.mock('../hooks/useCameraStream', () => ({ useCameraStream: () => camera }))

import { ServerCameraScanPage } from '../../../pages/ServerCameraScanPage'
import { ServerPhotoUploadPage } from '../../../pages/ServerPhotoUploadPage'

function renderPage(page) {
  return render(<MemoryRouter><FlowProvider initialValue={{ participant: { id: 'participant', participant_access_token: 'participant-token' }, consented: true }}>{page}</FlowProvider></MemoryRouter>)
}

afterEach(() => {
  vi.clearAllMocks()
})

it('requires explicit server-image consent before exposing manual front capture', async () => {
  const user = userEvent.setup(); const rendered = renderPage(<ServerCameraScanPage />)
  expect(screen.getByRole('button', { name: /start camera/i })).toBeDisabled()
  expect(screen.getByText(/transmitted securely to an AWS processing function/i)).toBeInTheDocument()
  await user.type(screen.getByLabelText(/verified height/i), '180')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /start camera/i }))
  expect(api.cameraProcessingConsent).toHaveBeenCalledOnce()
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
  expect(await screen.findByRole('button', { name: /capture front photo/i })).toBeInTheDocument()
  rendered.unmount()
  expect(camera.stop).toHaveBeenCalled()
})

it('opens server photo import without camera permission or browser model initialization', () => {
  const permission = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: permission } })
  renderPage(<ServerPhotoUploadPage />)
  expect(screen.getByRole('button', { name: /create private processing session/i })).toBeDisabled()
  expect(screen.getByText(/sent alone, and released before another photograph/i)).toBeInTheDocument()
  expect(permission).not.toHaveBeenCalled()
})
