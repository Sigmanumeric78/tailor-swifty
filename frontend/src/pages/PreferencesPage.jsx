import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'

const options = {
  occasion: ['office', 'smart-casual', 'casual', 'travel'],
  climate: ['hot', 'humid', 'mild', 'cool'],
  fit: ['slim', 'regular', 'relaxed'],
  styles: ['minimal', 'classic', 'natural', 'utility', 'contemporary'],
  colours: ['white', 'navy', 'blue', 'sky', 'sage', 'olive', 'charcoal'],
  preferred_fabrics: ['cotton', 'linen', 'cotton-twill'],
}

function ToggleGroup({ label, name, values, selected, multiple = false, onChange }) {
  const toggle = (value) => {
    if (!multiple) return onChange(value)
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }
  return <fieldset className="choice-group"><legend>{label}</legend><div className="choice-list">{values.map((value) => <button key={value} type="button" aria-pressed={multiple ? selected.includes(value) : selected === value} onClick={() => toggle(value)}>{value.replace('-', ' ')}</button>)}</div></fieldset>
}

export function PreferencesPage() {
  const navigate = useNavigate()
  const { flow, updateFlow } = useFlow()
  const [preferences, setPreferences] = useState(flow.preferences)
  const set = (name, value) => setPreferences((current) => ({ ...current, [name]: value }))
  const continueToReview = () => { updateFlow({ preferences }); navigate('/review') }
  return (
    <section>
      <PageHeader eyebrow="Style profile" title="Set the direction" description="These choices affect ranking only. Your body measurements determine the finished-garment targets." />
      <div className="preferences-layout">
        <ToggleGroup label="Occasion" name="occasion" values={options.occasion} selected={preferences.occasion} onChange={(value) => set('occasion', value)} />
        <ToggleGroup label="Climate" name="climate" values={options.climate} selected={preferences.climate} onChange={(value) => set('climate', value)} />
        <ToggleGroup label="Fit" name="fit" values={options.fit} selected={preferences.fit} onChange={(value) => set('fit', value)} />
        <ToggleGroup label="Style" name="styles" values={options.styles} selected={preferences.styles} multiple onChange={(value) => set('styles', value)} />
        <ToggleGroup label="Colour" name="colours" values={options.colours} selected={preferences.colours} multiple onChange={(value) => set('colours', value)} />
        <ToggleGroup label="Preferred fabric" name="preferred_fabrics" values={options.preferred_fabrics} selected={preferences.preferred_fabrics} multiple onChange={(value) => set('preferred_fabrics', value)} />
      </div>
      <div className="page-actions"><button className="secondary-button" onClick={() => { updateFlow({ preferences }); navigate('/measurements') }}><ArrowLeft size={17} /> Back</button><button className="primary-button" onClick={continueToReview}>Review submission <ArrowRight size={17} /></button></div>
    </section>
  )
}

