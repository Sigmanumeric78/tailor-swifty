import { render, screen, waitFor } from '@testing-library/react'
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
    capabilitySnapshot: { width: 1280, height: 720, facingMode: 'environment' },
    timings: null,
    state: 'idle',
    startReady: vi.fn(),
    markCapturing: vi.fn(), markProcessing: vi.fn(), markRecovering: vi.fn(), markReady: vi.fn(),
    stop: vi.fn(),
  },
  api: {
    schema: vi.fn(),
    consent: vi.fn().mockResolvedValue({ granted: true }),
    cameraProcessingConsent: vi.fn().mockResolvedValue({ granted: true }),
    cameraProcessingSession: vi.fn().mockResolvedValue({ session_token: 'memory-only-session', expires_at: 9999999999 }),
  },
  processor: {
    analyzeServerImage: vi.fn().mockResolvedValue({ observation_token: 'memory-only-observation' }),
    finalizeServerObservations: vi.fn(),
  },
}))

vi.mock('../../../api/client', () => ({ api }))
vi.mock('../hooks/useCameraStream', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useCameraStream: () => camera }
})
vi.mock('../services/serverCameraClient', () => processor)

import { ServerCameraScanPage } from '../../../pages/ServerCameraScanPage'
import { ServerPhotoUploadPage } from '../../../pages/ServerPhotoUploadPage'

const serverTest = import.meta.env.VITE_CAMERA_PROCESSING_MODE === 'server' ? it : it.skip
const participant = { id: 'participant', participant_access_token: 'participant-token' }

function renderPage(page) {
  return render(<MemoryRouter><FlowProvider initialValue={{ participant, consented: true }}>{page}</FlowProvider></MemoryRouter>)
}

async function startCamera(user, { waitUntilReady = true } = {}) {
  await user.type(screen.getByLabelText(/verified height/i), '180')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /start camera/i }))
  const capture = await screen.findByRole('button', { name: /capture front photo/i })
  if (waitUntilReady) await waitFor(() => expect(capture).toBeEnabled())
  return capture
}

function makeVideoCapturable() {
  const video = screen.getByLabelText(/front camera preview/i)
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 })
  return video
}

beforeEach(() => {
  api.schema.mockResolvedValue(schema)
  api.consent.mockResolvedValue({ granted: true })
  api.cameraProcessingConsent.mockResolvedValue({ granted: true })
  api.cameraProcessingSession.mockResolvedValue({ session_token: 'memory-only-session', expires_at: 9999999999 })
  camera.state = 'idle'; camera.devices = []; camera.stop.mockImplementation(() => { camera.state = 'stopped' })
  camera.startReady.mockImplementation(async () => { camera.state = 'ready'; return { stream: {} } })
  camera.markCapturing.mockImplementation(() => { camera.state = 'capturing' })
  camera.markProcessing.mockImplementation(() => { camera.state = 'processing' })
  camera.markRecovering.mockImplementation(() => { camera.state = 'recovering' })
  camera.markReady.mockImplementation(() => { camera.state = 'ready' })
  processor.analyzeServerImage.mockResolvedValue({ observation_token: 'memory-only-observation' })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

serverTest('routes measurement users to server camera and photo workflows without browser models', async () => {
  const initialize = vi.spyOn(CameraModelRegistry.prototype, 'initialize')
  const user = userEvent.setup()
  const cameraRoute = renderApp({ route: '/measurements', flow: { schema } })
  await user.click(await screen.findByRole('button', { name: /use live camera/i }))
  expect(await screen.findByRole('button', { name: /start camera/i })).toBeInTheDocument()
  expect(screen.getByText(/transmitted securely to an AWS processing function/i)).toBeInTheDocument()
  expect(initialize).not.toHaveBeenCalled()
  cameraRoute.unmount()

  const photoRoute = renderApp({ route: '/measurements', flow: { schema } })
  await user.click(await screen.findByRole('button', { name: /use existing photos/i }))
  expect(await screen.findByRole('button', { name: /continue to existing photos/i })).toBeInTheDocument()
  expect(screen.getByText(/held only in volatile processing memory/i)).toBeInTheDocument()
  expect(initialize).not.toHaveBeenCalled()
  photoRoute.unmount()
})

serverTest('opens a real preview lifecycle before creating the short-lived processing session', async () => {
  const user = userEvent.setup(); const rendered = renderPage(<ServerCameraScanPage />)
  expect(screen.getByRole('button', { name: /start camera/i })).toBeDisabled()
  const capture = await startCamera(user)
  expect(api.cameraProcessingConsent).toHaveBeenCalledOnce()
  expect(api.cameraProcessingSession).not.toHaveBeenCalled()
  expect(camera.startReady).toHaveBeenCalledWith(expect.any(HTMLVideoElement), { facingMode: 'environment', deviceId: '' })
  expect(capture).toBeEnabled()

  makeVideoCapturable()
  await user.click(capture)
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
  expect(processor.analyzeServerImage).toHaveBeenCalledOnce()
  rendered.unmount(); expect(camera.stop).toHaveBeenCalled()
})

serverTest('keeps capture disabled while metadata and the first frame are pending', async () => {
  let resolveCamera
  camera.startReady.mockImplementation(() => new Promise((resolve) => { resolveCamera = () => { camera.state = 'ready'; resolve({}) } }))
  const user = userEvent.setup(); renderPage(<ServerCameraScanPage />)
  const capture = await startCamera(user, { waitUntilReady: false })
  expect(capture).toBeDisabled()
  await waitFor(() => expect(resolveCamera).toEqual(expect.any(Function)))
  resolveCamera()
  await waitFor(() => expect(capture).toBeEnabled())
})

serverTest('offers front, rear, and labelled physical camera switching and stops the active stream', async () => {
  camera.devices = [{ kind: 'videoinput', deviceId: 'one', label: 'Back Camera' }, { kind: 'videoinput', deviceId: 'two', label: 'FaceTime Camera' }]
  const user = userEvent.setup(); renderPage(<ServerCameraScanPage />)
  await startCamera(user)
  expect(screen.getByRole('button', { name: 'Rear' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Front' }))
  await waitFor(() => expect(camera.startReady).toHaveBeenLastCalledWith(expect.any(HTMLVideoElement), { facingMode: 'user', deviceId: '' }))
  await user.selectOptions(screen.getByLabelText(/available cameras/i), 'one')
  await waitFor(() => expect(camera.startReady).toHaveBeenLastCalledWith(expect.any(HTMLVideoElement), { facingMode: 'user', deviceId: 'one' }))
})

serverTest('manual capture invokes one processor request and cannot be double-submitted', async () => {
  let resolveAnalyze
  processor.analyzeServerImage.mockImplementation(() => new Promise((resolve) => { resolveAnalyze = resolve }))
  const user = userEvent.setup(); renderPage(<ServerCameraScanPage />)
  const capture = await startCamera(user); makeVideoCapturable()
  await user.click(capture); await user.click(capture)
  expect(processor.analyzeServerImage).toHaveBeenCalledOnce()
  expect(capture).toBeDisabled()
  resolveAnalyze({ observation_token: 'front-observation' })
  expect(await screen.findByRole('button', { name: /capture side photo/i })).toBeEnabled()
})

serverTest('expiry after an accepted observation clears the pair and offers restart without legal re-consent', async () => {
  processor.analyzeServerImage
    .mockResolvedValueOnce({ observation_token: 'front-observation' })
    .mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED', status: 401 }))
  const user = userEvent.setup(); renderPage(<ServerCameraScanPage />)
  await startCamera(user); makeVideoCapturable()
  await user.click(screen.getByRole('button', { name: /capture front photo/i }))
  await waitFor(() => expect(screen.getByText(/observations accepted/i)).toHaveTextContent('1 front and 0 side'))
  const sideVideo = screen.getByLabelText(/side camera preview/i)
  Object.defineProperty(sideVideo, 'videoWidth', { configurable: true, value: 1280 })
  Object.defineProperty(sideVideo, 'videoHeight', { configurable: true, value: 720 })
  await user.click(screen.getByRole('button', { name: /capture side photo/i }))
  expect(await screen.findByRole('button', { name: /restart capture session/i })).toBeInTheDocument()
  expect(screen.getByText(/observations accepted/i)).toHaveTextContent('0 front and 0 side')
  expect(screen.getByText(/temporary capture session expired/i)).toBeInTheDocument()
  expect(api.cameraProcessingConsent).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: /restart capture session/i }))
  expect(await screen.findByRole('button', { name: /capture front photo/i })).toBeEnabled()
  expect(api.cameraProcessingConsent).toHaveBeenCalledOnce()
})

serverTest('actual consent errors navigate to consent with a safe return to the camera route', async () => {
  api.cameraProcessingSession.mockRejectedValue(Object.assign(new Error('consent required'), { code: 'CAMERA_PROCESSING_CONSENT_REQUIRED', status: 403 }))
  const user = userEvent.setup(); renderApp({ route: '/measurements/camera', flow: { schema, participant, consented: true } })
  const capture = await startCamera(user); makeVideoCapturable(); await user.click(capture)
  expect(await screen.findByRole('button', { name: /agree and continue/i })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /agree and continue/i }))
  expect(await screen.findByRole('button', { name: /start camera/i })).toBeInTheDocument()
})

serverTest('opens photo import without camera permission and creates a processor session only on selection', async () => {
  const permission = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: permission } })
  const user = userEvent.setup(); renderPage(<ServerPhotoUploadPage />)
  await user.type(screen.getByLabelText(/verified height/i), '180')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /continue to existing photos/i }))
  expect(api.cameraProcessingSession).not.toHaveBeenCalled()
  const front = await screen.findByLabelText(/select one front jpeg, png, or webp/i)
  expect(front).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
  await user.upload(front, new File(['front'], 'front.png', { type: 'image/png' }))
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
  expect(permission).not.toHaveBeenCalled()
})

serverTest('accepts separate front and profile source formats and forgets temporary state on cancel', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const user = userEvent.setup(); renderPage(<ServerPhotoUploadPage />)
  await user.type(screen.getByLabelText(/verified height/i), '180')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: /continue to existing photos/i }))
  await user.upload(await screen.findByLabelText(/select one front jpeg, png, or webp/i), new File(['front'], 'front.jpg', { type: 'image/jpeg' }))
  await user.upload(await screen.findByLabelText(/select one profile jpeg, png, or webp/i), new File(['profile'], 'profile.webp', { type: 'image/webp' }))
  expect(processor.analyzeServerImage.mock.calls.map(([request]) => request.view)).toEqual(['FRONT', 'SIDE'])
  expect(await screen.findByRole('button', { name: /calculate measurements from 1 matched pair/i })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /cancel and forget this session/i }))
  expect(storage).not.toHaveBeenCalled()
  expect(JSON.stringify(processor.analyzeServerImage.mock.calls)).not.toMatch(/localStorage|sessionStorage|indexedDB/i)
})
