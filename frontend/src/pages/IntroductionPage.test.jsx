import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { IntroductionPage } from './IntroductionPage'
import { FlowProvider, useFlow } from '../features/FlowContext'

function ConsentProbe() {
  const { flow } = useFlow()
  return <p>Consent entry: {flow.garment}; accepted: {String(flow.consented)}; chest: {flow.measurements.chest_circumference}</p>
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('starts the existing consent flow without discarding measurements or granting consent', async () => {
  vi.stubGlobal('matchMedia', () => ({matches:true,addEventListener(){},removeEventListener(){}}))
  const fetch = vi.fn(); vi.stubGlobal('fetch',fetch)
  render(<MemoryRouter><FlowProvider initialValue={{measurements:{chest_circumference:'100'}}}><Routes><Route path="/" element={<IntroductionPage/>}/><Route path="/consent" element={<ConsentProbe/>}/></Routes></FlowProvider></MemoryRouter>)
  expect(screen.getByRole('img')).toBeVisible()
  expect(fetch).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button',{name:/start your fitting/i}))
  expect(screen.getByText('Consent entry: shirt; accepted: false; chest: 100')).toBeVisible()
})
it('keeps a usable poster and fitting action when animation capabilities are unavailable', async () => {
  vi.stubGlobal('matchMedia',undefined)
  vi.stubGlobal('IntersectionObserver',undefined)
  render(<MemoryRouter><FlowProvider><IntroductionPage/></FlowProvider></MemoryRouter>)
  await userEvent.click(screen.getByRole('button',{name:/explore in 3d/i}))
  expect(screen.getByRole('img')).not.toHaveClass('is-hidden')
  expect(screen.getByRole('button',{name:/start your fitting/i})).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('The still illustration is available')
})
