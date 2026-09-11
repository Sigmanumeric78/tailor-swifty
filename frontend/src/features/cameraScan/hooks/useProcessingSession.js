import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'

export const PROCESSING_SESSION_ERROR = Object.freeze({
  EXPIRED_WITH_OBSERVATIONS: 'CAPTURE_SESSION_EXPIRED_WITH_OBSERVATIONS',
})

const TOKEN_EXPIRY_CODES = new Set(['TOKEN_EXPIRED'])
export const CONSENT_ERROR_CODES = new Set(['CONSENT_REQUIRED', 'CAMERA_PROCESSING_CONSENT_REQUIRED'])
export const PARTICIPANT_ACCESS_ERROR_CODES = new Set([
  'PARTICIPANT_ACCESS_REQUIRED',
  'PARTICIPANT_ACCESS_MISMATCH',
  'TOKEN_INVALID',
  'TOKEN_TAMPERED',
  'TOKEN_TYPE_MISMATCH',
])

export function processingSessionNeedsRefresh(session, acceptedObservationCount, nowSeconds = Date.now() / 1000) {
  if (!session) return true
  return acceptedObservationCount === 0 && Number(session.expires_at) - nowSeconds < 90
}

function expiredObservationsError() {
  const error = new Error('The temporary capture session expired. Restart capture to create a new matched front and side pair; your legal consent is still recorded.')
  error.code = PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS
  return error
}

/** Owns the short-lived processor token in React memory and permits one expiry retry only before observations exist. */
export function useProcessingSession({ participant, heightMm, onConsentRequired, onObservationsExpired } = {}) {
  const [session, setSessionState] = useState(null)
  const sessionRef = useRef(null); const creationRef = useRef(null)

  const setSession = useCallback((next) => { sessionRef.current = next; setSessionState(next) }, [])
  const clearSession = useCallback(() => { creationRef.current = null; setSession(null) }, [setSession])

  const create = useCallback(async () => {
    if (!participant?.id || !participant?.participant_access_token) {
      const error = new Error('Complete onboarding before starting camera processing.')
      error.code = 'PARTICIPANT_ACCESS_REQUIRED'
      throw error
    }
    if (!creationRef.current) {
      creationRef.current = api.cameraProcessingSession(participant.id, participant.participant_access_token)
        .catch((caught) => {
          // TOKEN_EXPIRED from this API call refers to participant access, not
          // the processor session. Rename it so it cannot enter the processor
          // token's bounded retry path.
          if (caught?.code === 'TOKEN_EXPIRED' || PARTICIPANT_ACCESS_ERROR_CODES.has(caught?.code)) {
            const error = new Error('This anonymous fitting session expired. Start again to continue.')
            error.code = 'PARTICIPANT_ACCESS_REQUIRED'
            throw error
          }
          throw caught
        })
        .then((created) => {
          const next = { ...created, heightMm }
          setSession(next)
          return next
        })
        .finally(() => { creationRef.current = null })
    }
    return creationRef.current
  }, [heightMm, participant, setSession])

  const ensureValidProcessingSession = useCallback(async ({ acceptedObservationCount = 0, force = false } = {}) => {
    const current = sessionRef.current
    const nowSeconds = Date.now() / 1000
    if (current && Number(current.expires_at) <= nowSeconds && acceptedObservationCount > 0) {
      clearSession(); onObservationsExpired?.(); throw expiredObservationsError()
    }
    if (force || processingSessionNeedsRefresh(current, acceptedObservationCount, nowSeconds)) {
      if (acceptedObservationCount > 0) {
        clearSession(); onObservationsExpired?.(); throw expiredObservationsError()
      }
      clearSession()
      return create()
    }
    return current
  }, [clearSession, create, onObservationsExpired])

  const withValidProcessingSession = useCallback(async (operation, { acceptedObservationCount = 0 } = {}) => {
    let active
    try {
      active = await ensureValidProcessingSession({ acceptedObservationCount })
      return await operation(active)
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code) || PARTICIPANT_ACCESS_ERROR_CODES.has(caught?.code)) { onConsentRequired?.(caught); throw caught }
      if (!TOKEN_EXPIRY_CODES.has(caught?.code)) throw caught
      if (acceptedObservationCount > 0) {
        clearSession(); onObservationsExpired?.(); throw expiredObservationsError()
      }
      // The first request had no accepted observations, so one replacement and
      // one retry are safe. Errors from the retry propagate without recursion.
      active = await ensureValidProcessingSession({ acceptedObservationCount: 0, force: true })
      return operation(active)
    }
  }, [clearSession, ensureValidProcessingSession, onConsentRequired, onObservationsExpired])

  useEffect(() => () => { sessionRef.current = null; creationRef.current = null }, [])
  return { session, clearSession, ensureValidProcessingSession, withValidProcessingSession }
}
