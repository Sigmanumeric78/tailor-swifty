import { ArrowLeft, ClipboardCheck } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'

const makeKey = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`

export function ReviewPage() {
  const navigate = useNavigate()
  const { flow, updateFlow } = useFlow()
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const keys = useRef({ submit: makeKey('submit'), recommendation: makeKey('recommendation') })
  const fields = flow.schema?.fields || []
  const finish = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await api.submit(flow.session.id, keys.current.submit, flow.participant?.participant_access_token)
      const result = await api.recommend({ measurement_session_id: flow.session.id, preferences: flow.preferences }, keys.current.recommendation, flow.participant?.participant_access_token)
      updateFlow({ result })
      navigate(`/results/${result.id}`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <section className="page page-review">
      <PageHeader eyebrow="Submission review · 05" title="Check before calculating." description="Confirm the values and style direction. Submission creates an immutable recommendation snapshot." />
      <div className="review-layout">
        <div className="review-section"><h2>Body measurements</h2><div className="review-table" role="table">{fields.map((field) => <div className="review-row" role="row" key={field.code}><span role="cell">{field.label}</span><strong role="cell">{flow.measurements[field.code]} {flow.unit}</strong></div>)}</div><button className="text-button" onClick={() => navigate('/measurements')}>Edit measurements</button></div>
        <div className="review-section"><h2>Style direction</h2><dl className="summary-list"><div><dt>Occasion</dt><dd>{flow.preferences.occasion.replace('-', ' ')}</dd></div><div><dt>Climate</dt><dd>{flow.preferences.climate}</dd></div><div><dt>Fit</dt><dd>{flow.preferences.fit}</dd></div><div><dt>Style</dt><dd>{flow.preferences.styles.join(', ') || 'No preference'}</dd></div><div><dt>Colours</dt><dd>{flow.preferences.colours.join(', ') || 'No preference'}</dd></div></dl><button className="text-button" onClick={() => navigate('/preferences')}>Edit style</button></div>
      </div>
      {flow.validation?.issues?.filter((issue) => issue.level === 'warning').map((issue) => <Notice tone="warning" key={`${issue.code}-${issue.field}`}>{issue.message}</Notice>)}
      {error && <Notice tone="error">{error} Your idempotency keys are retained for a safe retry.</Notice>}
      <div className="page-actions"><button className="secondary-button" onClick={() => navigate('/preferences')}><ArrowLeft size={17} aria-hidden="true" /> Back</button><button className="primary-button" onClick={finish} disabled={submitting || !flow.session}>{submitting ? 'Calculating…' : 'Create recommendation'} <ClipboardCheck size={17} aria-hidden="true" /></button></div>
    </section>
  )
}
