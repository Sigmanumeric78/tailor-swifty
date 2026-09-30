import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AtelierHero } from './AtelierHero'

const scene = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('./scene.js', () => ({ createAtelierScene: scene.create }))

class VisibleObserver {
  constructor(callback) { this.callback = callback }
  observe() { this.callback([{ isIntersecting: true }]) }
  disconnect() {}
}

beforeEach(() => {
  scene.create.mockReset()
  vi.stubGlobal('IntersectionObserver', VisibleObserver)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal('requestAnimationFrame', callback => {
    queueMicrotask(() => callback(performance.now()))
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps the poster and fitting action usable when 3D asset loading fails', async () => {
  scene.create.mockRejectedValueOnce(new Error('Atelier asset unavailable'))

  render(<AtelierHero onStart={() => {}} assets={{
    model: '/assets/torso.glb',
    tape: '/assets/tape.json',
    poster: '/assets/poster.webp',
  }} />)

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The still illustration is available'))
  expect(screen.getByRole('img')).not.toHaveClass('is-hidden')
  expect(screen.getByRole('button', { name: /start your fitting/i })).toBeEnabled()
  expect(screen.getByRole('button', { name: /retry 3d/i })).toBeEnabled()
})

it('destroys the WebGL scene when the landing page unmounts', async () => {
  const destroy = vi.fn()
  scene.create.mockResolvedValueOnce({ setProgress: vi.fn(), destroy })

  const view = render(<AtelierHero onStart={() => {}} assets={{
    model: '/assets/torso.glb',
    tape: '/assets/tape.json',
    poster: '/assets/poster.webp',
  }} />)

  await waitFor(() => expect(screen.getByRole('button', { name: /pause motion/i })).toBeEnabled())
  view.unmount()
  expect(destroy).toHaveBeenCalledTimes(1)
})
