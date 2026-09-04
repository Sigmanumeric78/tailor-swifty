import { ArrowLeft, ArrowRight, Plus, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'

export function convertValue(value, from, to) {
  if (value === '' || value == null || from === to) return value
  const converted = from === 'cm' ? Number(value) / 2.54 : Number(value) * 2.54
  return Number(converted.toFixed(2))
}

export function MeasurementPage() {
  const navigate = useNavigate()
  const { flow, updateFlow } = useFlow()
  const [unit, setUnit] = useState(flow.unit)
  const [repeats, setRepeats] = useState(() => new Set(Object.keys(flow.secondAttempts || {})))
  const [submitError, setSubmitError] = useState(null)
  const { register, handleSubmit, getValues, setValue, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { ...flow.measurements, second: flow.secondAttempts } })
  const schemaQuery = useQuery({ queryKey: ['measurement-schema', 'shirt'], queryFn: api.schema })

  useEffect(() => {
    if (schemaQuery.data) updateFlow({ schema: schemaQuery.data })
  }, [schemaQuery.data, updateFlow])

  const fields = schemaQuery.data?.fields || flow.schema?.fields || []
  const changeUnit = (nextUnit) => {
    if (nextUnit === unit) return
    fields.forEach((field) => {
      setValue(field.code, convertValue(getValues(field.code), unit, nextUnit))
      setValue(`second.${field.code}`, convertValue(getValues(`second.${field.code}`), unit, nextUnit))
    })
    setUnit(nextUnit)
  }

  const onSubmit = async (values) => {
    setSubmitError(null)
    const firstValues = Object.fromEntries(fields.map((field) => [field.code, values[field.code]]))
    updateFlow({ measurements: firstValues, secondAttempts: values.second || {}, unit })
    try {
      const session = await api.session({
        participant_id: flow.participant?.id,
        age_months_at_measurement: Math.round(flow.ageYears * 12),
        garment_categories: ['shirt'],
        measurement_method: 'self',
        unit_entered: unit,
      })
      const measurements = fields.flatMap((field) => {
        const attempts = [{ measurement_code: field.code, value: Number(values[field.code]), unit, attempt_number: 1 }]
        if (values.second?.[field.code]) attempts.push({ measurement_code: field.code, value: Number(values.second[field.code]), unit, attempt_number: 2 })
        return attempts
      })
      await api.measurements(session.id, measurements)
      const validation = await api.validate(session.id)
      validation.issues.filter((issue) => issue.level === 'error').forEach((issue) => setError(issue.field, { type: 'server', message: issue.message }))
      updateFlow({ session, validation })
      if (validation.valid) navigate('/preferences')
    } catch (error) {
      const fieldDetails = Array.isArray(error.details) ? error.details : []
      fieldDetails.forEach((detail) => {
        const field = detail.field?.replace(/^measurements\.\d+\./, '')
        if (field && fields.some((item) => item.code === field)) setError(field, { type: 'server', message: detail.message })
      })
      setSubmitError(error.message)
    }
  }

  if (schemaQuery.isLoading && !flow.schema) return <div className="loading-state"><RefreshCw className="spin" /> Loading measurement guide…</div>
  if (schemaQuery.isError && !flow.schema) return <div className="empty-state"><h1>Measurement guide unavailable</h1><p>{schemaQuery.error.message}</p><button className="secondary-button" onClick={() => schemaQuery.refetch()}><RefreshCw size={17} /> Retry</button></div>
  if (!fields.length) return <div className="empty-state"><h1>No shirt measurements found</h1><p>The backend returned an empty schema.</p></div>

  return (
    <section>
      <div className="header-with-control">
        <PageHeader eyebrow={`Measurement schema v${schemaQuery.data?.version || flow.schema?.version}`} title="Enter your shirt measurements" description="Measure over light clothing. You can add a second attempt anywhere you want to confirm placement." />
        <fieldset className="segmented"><legend>Measurement unit</legend><button type="button" aria-pressed={unit === 'cm'} onClick={() => changeUnit('cm')}>cm</button><button type="button" aria-pressed={unit === 'in'} onClick={() => changeUnit('in')}>in</button></fieldset>
      </div>
      <Notice>{schemaQuery.data?.range_notice || flow.schema?.range_notice}</Notice>
      <form onSubmit={handleSubmit(onSubmit)} className="measurement-form" noValidate>
        <div className="measurement-grid">
          {fields.map((field, index) => (
            <div className="measurement-row" key={field.code}>
              <div className="measurement-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="measurement-copy"><label htmlFor={field.code}>{field.label}</label><p>{field.instruction}</p></div>
              <div className="measurement-entry">
                <div className="input-with-unit"><input id={field.code} type="number" inputMode="decimal" step="0.01" aria-invalid={Boolean(errors[field.code])} {...register(field.code, { required: `${field.label} is required.`, min: { value: 0.01, message: 'Enter a value greater than zero.' } })} /><span>{unit}</span></div>
                {errors[field.code] && <span className="field-error">{errors[field.code].message}</span>}
                {!repeats.has(field.code) ? <button type="button" className="text-button" onClick={() => setRepeats((current) => new Set(current).add(field.code))}><Plus size={14} /> Add repeat</button> : <div className="repeat-entry"><label htmlFor={`second-${field.code}`}>Second attempt</label><div className="input-with-unit"><input id={`second-${field.code}`} aria-label={`${field.label} second attempt`} type="number" inputMode="decimal" step="0.01" {...register(`second.${field.code}`, { min: { value: 0.01, message: 'Enter a value greater than zero.' } })} /><span>{unit}</span></div></div>}
              </div>
            </div>
          ))}
        </div>
        {submitError && <Notice tone="error">{submitError}</Notice>}
        <div className="page-actions"><button type="button" className="secondary-button" onClick={() => { const values = getValues(); updateFlow({ measurements: Object.fromEntries(fields.map((field) => [field.code, values[field.code]])), secondAttempts: values.second || {}, unit }); navigate('/consent') }}><ArrowLeft size={17} /> Back</button><button className="primary-button" disabled={isSubmitting}>{isSubmitting ? 'Checking measurements…' : 'Check and continue'} <ArrowRight size={17} /></button></div>
      </form>
    </section>
  )
}
