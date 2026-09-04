import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'
import { FlowProvider } from '../features/FlowContext'

export function renderApp({ route = '/', flow = {} } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <FlowProvider initialValue={flow}><App /></FlowProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

