import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FlowProvider } from '../../FlowContext'
import { CameraModelRegistry } from '../services/modelRegistry'
import { schema } from '../../../test/fixtures'
import { renderApp } from '../../../test/renderApp'

const { camera, api, processor } = vi.hoisted(() => ({
  camera: {
    stream: null,
    devices: [],
    capabilitySnapshot: null,
    start: vi.fn().mockResolvedValue({}),
    stop: vi.fn(),
  },
  api: {
    schema: vi.fn(),
    cameraProcessingConsent: vi.fn().mockResolvedValue({ granted: true }),
    cameraProcessingSession: vi.fn().mockResolvedValue({ session_token: 'memory-only-session', expires_at: 9999999999 }),
  },
  processor: {
    analyzeServerImage: vi.fn().mockResolvedValue({ observation_token: 'memory-only-observation' }),
    finalizeServerObservations: vi.fn(),
  },
}))

vi.mock('../../../api/client', () => ({ api }))
vi.mock('../hooks/useCameraStream', () => ({ useCameraStream: () => camera }))
vi.mock('../services/serverCameraClient', () => processor)

import { ServerCameraScanPage } from '../../../pages/ServerCameraScanPage'
import { ServerPhotoUploadPage } from '../../../pages/ServerPhotoUploadPage'

function renderPage(page) {
  return render(<MemoryRouter><FlowProvider initialValue={{ participant: { id: 'participant', participant_access_token: 'participant-token' }, consented: true }}>{page}</FlowProvider></MemoryRouter>)
}

beforeEach(() => {
  api.schema.mockResolvedValue(schema)
  api.cameraProcessingConsent.mockResolvedValue({ granted: true })
  api.cameraProcessingSession.mockResolvedValue({ session_token: 'memory-only-session', expires_at: 9999999999 })
  camera.start.mockResolvedValue({})
  processor.analyzeServerImage.mockResolvedValue({ observation_token: 'memory-only-observation' })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('routes measurement users to the server camera and photo workflows without browser models', async () => {
  api.schema.mockResolvedValue(schema)
  const initialize = vi.spyOn(CameraModelRegistry.prototype, 'initialize')
  const user = userEvent.setup()
  const cameraRoute = renderApp({ route: '/measurements', flow: { schema } })

  expect(await screen.findByRole('button', { name: /use live camera/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /use existing photos/i })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /use live camera/i }))
  expect(await screen.findByRole('button', { name: /start camera/i })).toBeInTheDocument()
  expect(screen.getByText(/transmitted securely to an AWS processing function/i)).toBeInTheDocument()
  expect(initialize).not.toHaveBeenCalled()

  cameraRoute.unmount()
  const photoRoute = renderApp({ route: '/measurements', flow: { schema } })
  await user.click(await screen.findByRole('button', { name: /use existing photos/i }))
  expect(await screen.findByRole('button', { name: /create private processing session/i })).toBeInTheDocument()
  expect(screen.getByText(/held only in volatile processing memory/i)).toBeInTheDocument()
  expect(initialize).not.toHaveBeenCalled()
  photoRoute.unmount()
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

it('opens server photo import without camera permission or browser model initialization', async () => {
  const permission = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: permission } })
  renderPage(<ServerPhotoUploadPage />)
  expect(screen.getByRole('button', { name: /create private processing session/i })).toBeDisabled()
  expect(screen.getByText(/sent alone, and released before another photograph/i)).toBeInTheDocument()
  expect(permission).not.toHaveBeenCalled()
})

it('accepts one front and one profile JPEG or WebP only after private-session consent', async () => {
  const user = userEvent.setup()
  renderPage(<ServerPhotoUploadPage />)
  await user.type(screen.getByLabelText(/verified height/i), '180')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /create private processing session/i }))

  const front = await screen.findByLabelText(/select one front jpeg or webp/i)
  const profile = screen.getByLabelText(/select one profile jpeg or webp/i)
  expect(front).toHaveAttribute('accept', 'image/jpeg,image/webp')
  expect(profile).toHaveAttribute('accept', 'image/jpeg,image/webp')

  await user.upload(front, new File(['front'], 'front.jpg', { type: 'image/jpeg' }))
  await user.upload(await screen.findByLabelText(/select one profile jpeg or webp/i), new File(['profile'], 'profile.webp', { type: 'image/webp' }))
  expect(processor.analyzeServerImage.mock.calls.map(([request]) => request.view)).toEqual(['FRONT', 'SIDE'])
  expect(await screen.findByRole('button', { name: /calculate measurements from 1 matched pair/i })).toBeInTheDocument()
})

it('cancels the server photo session without persisting temporary files or tokens', async () => {
  api.schema.mockResolvedValue(schema)
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const user = userEvent.setup()
  renderApp({ route: '/measurements/photos', flow: { schema, participant: { id: 'participant', participant_access_token: 'participant-token' }, consented: true } })
  await user.type(screen.getByLabelText(/verified height/i), '180')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /create private processing session/i }))
  await user.upload(await screen.findByLabelText(/select one front jpeg or webp/i), new File(['front'], 'front.jpg', { type: 'image/jpeg' }))
  expect(await screen.findByText('1/3 accepted.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /cancel and forget this session/i }))
  expect(await screen.findByRole('button', { name: /use existing photos/i })).toBeInTheDocument()
  expect(storage).not.toHaveBeenCalled()
  expect(JSON.stringify(processor.analyzeServerImage.mock.calls)).not.toMatch(/localStorage|sessionStorage|indexedDB/i)
})
