import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'

export function ConsentPage() {
  const navigate = useNavigate()
  const { flow, updateFlow } = useFlow()
  const [accepted, setAccepted] = useState(flow.consented)
  const [ageYears, setAgeYears] = useState(flow.ageYears)
  const mutation = useMutation({
    mutationFn: async () => {
      const participant = flow.participant || await api.participant()
      await api.consent(participant.id)
      return participant
    },
    onSuccess: (participant) => {
      updateFlow({ participant, consented: true, ageYears: Number(ageYears) })
      navigate('/measurements')
    },
  })
  const submit = (event) => {
    event.preventDefault()
    if (accepted && ageYears >= 18) mutation.mutate()
  }
  return (
    <section className="page page-consent">
      <PageHeader eyebrow="Service consent · 02" title="Your measurements, your choice." description="We need permission to securely store your measurements and calculate this recommendation." />
      <form onSubmit={submit} className="form-stack">
        <div className="consent-document">
          <div className="document-heading">
            <div className="document-icon"><LockKeyhole size={22} aria-hidden="true" /></div>
            <div><p className="document-reference">Consent record / Adult service</p><h2>Generate a shirt recommendation</h2></div>
          </div>
          <p className="document-summary">We will store a random participant code, your age in months, tape measurements, measurement quality information, style choices, and a versioned result snapshot.</p>
          <dl>
            <div><dt>Purpose</dt><dd>Calculate and explain one shirt recommendation</dd></div>
            <div><dt>Storage</dt><dd>Secure Neon PostgreSQL database</dd></div>
            <div><dt>Not collected</dt><dd>Name, email, phone, address, or date of birth</dd></div>
          </dl>
        </div>
        <label className="field compact-field">Your age in years<input aria-label="Your age in years" type="number" min="18" max="120" value={ageYears} onChange={(event) => setAgeYears(event.target.value)} required /></label>
        <label className="consent-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I am 18 or older and consent to processing for this recommendation.</span></label>
        {Number(ageYears) < 18 && <Notice tone="error">This release does not accept child measurement data. Guardian workflows require separate legal and expert review.</Notice>}
        {mutation.isError && <Notice tone="error">{mutation.error.message} Check that the deployed service is available, then retry.</Notice>}
        <div className="page-actions"><button type="button" className="secondary-button" onClick={() => navigate('/')}><ArrowLeft size={17} aria-hidden="true" /> Back</button><button className="primary-button" disabled={!accepted || ageYears < 18 || mutation.isPending}>{mutation.isPending ? 'Recording consent…' : 'Agree and continue'} <ArrowRight size={17} aria-hidden="true" /></button></div>
      </form>
    </section>
  )
}
