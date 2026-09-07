import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const FlowContext = createContext(null)

export const initialFlow = {
  garment: 'shirt',
  participant: null,
  ageYears: 30,
  consented: false,
  schema: null,
  unit: 'cm',
  measurements: {},
  cameraScan: {
    status: 'idle', pipelineVersion: null, heightMm: null, captures: {}, measurements: {}, overallConfidence: null, warnings: [],
  },
  secondAttempts: {},
  session: null,
  validation: null,
  preferences: {
    occasion: 'smart-casual',
    climate: 'mild',
    fit: 'regular',
    styles: ['minimal'],
    colours: ['white'],
    preferred_fabrics: [],
    avoid_fabrics: [],
  },
  result: null,
}

export function FlowProvider({ children, initialValue = {} }) {
  const [flow, setFlow] = useState({ ...initialFlow, ...initialValue })
  const updateFlow = useCallback((patch) => setFlow((current) => ({ ...current, ...patch })), [])
  const value = useMemo(() => ({ flow, updateFlow }), [flow, updateFlow])
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}

export function useFlow() {
  const context = useContext(FlowContext)
  if (!context) throw new Error('useFlow must be used inside FlowProvider')
  return context
}
