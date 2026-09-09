import { ArrowLeft, ArrowRight, Camera, Images, Plus, RefreshCw } from 'lucide-react'
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
        input_mode: ['review', 'photo_review'].includes(flow.cameraScan?.status) ? 'CAMERA_MEASUREMENTS' : 'MANUAL_MEASUREMENTS',
        capture_source: flow.cameraScan?.status === 'photo_review' ? 'photo_import' : flow.cameraScan?.status === 'review' ? 'live_camera' : 'manual',
        calibration_mode: flow.cameraScan?.calibrationMode || 'UNAVAILABLE',
        confidence_version: flow.cameraScan?.pipelineVersion || null,
        model_versions: [...new Set(Object.values(flow.cameraScan?.measurements || {}).flatMap((item) => item.model_versions || []))],
        reason_codes: flow.cameraScan?.warnings || [],
        device_capability_summary: flow.cameraScan?.capabilitySummary ? {
          width: flow.cameraScan.capabilitySummary.width, height: flow.cameraScan.capabilitySummary.height,
          frame_rate: flow.cameraScan.capabilitySummary.frameRate, aspect_ratio: flow.cameraScan.capabilitySummary.aspectRatio,
          facing_mode: flow.cameraScan.capabilitySummary.facingMode, resize_mode: flow.cameraScan.capabilitySummary.resizeMode,
          zoom: flow.cameraScan.capabilitySummary.zoom, torch_available: flow.cameraScan.capabilitySummary.torchAvailable,
        } : null,
        manually_reviewed: true,
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

  if (schemaQuery.isLoading && !flow.schema) return <div className="loading-state" role="status"><RefreshCw className="spin" aria-hidden="true" /> Loading measurement guide…</div>
  if (schemaQuery.isError && !flow.schema) return <div className="empty-state" role="alert"><h1>Measurement guide unavailable</h1><p>{schemaQuery.error.message}</p><button className="secondary-button" onClick={() => schemaQuery.refetch()}><RefreshCw size={17} aria-hidden="true" /> Retry</button></div>
  if (!fields.length) return <div className="empty-state"><h1>No shirt measurements found</h1><p>The backend returned an empty schema.</p></div>

  return (
    <section className="page page-measurements">
      <div className="header-with-control">
        <PageHeader eyebrow={`Measurement schema v${schemaQuery.data?.version || flow.schema?.version} · 03`} title="Enter your shirt measurements." description="Measure over light clothing. You can add a second attempt anywhere you want to confirm placement." />
        <fieldset className="segmented"><legend>Measurement unit</legend><button type="button" aria-pressed={unit === 'cm'} onClick={() => changeUnit('cm')}>cm</button><button type="button" aria-pressed={unit === 'in'} onClick={() => changeUnit('in')}>in</button></fieldset>
      </div>
      <Notice>{schemaQuery.data?.range_notice || flow.schema?.range_notice}</Notice>
      <div className="camera-entry"><div><strong>Prefer an on-device estimate?</strong><p>Use experimental front and side views, then review every value here before submission. Height-and-weight sizing is unavailable because no approved versioned size chart is configured.</p></div><div className="inline-actions"><button type="button" className="secondary-button" onClick={() => navigate('/measurements/camera')}><Camera size={17} aria-hidden="true" /> Use live camera</button><button type="button" className="secondary-button" onClick={() => navigate('/measurements/photos')}><Images size={17} aria-hidden="true" /> Use existing photos</button><button type="button" className="secondary-button" disabled title="UNAVAILABLE_NO_SIZE_CHART">Height &amp; weight estimate unavailable</button></div></div>
      <form onSubmit={handleSubmit(onSubmit)} className="measurement-form" noValidate>
        <div className="measurement-grid">
          {fields.map((field, index) => (
            <div className="measurement-row" key={field.code}>
              <div className="measurement-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="measurement-copy"><label htmlFor={field.code}>{field.label}</label><p id={`${field.code}-instruction`}>{field.instruction}</p></div>
              <div className="measurement-entry">
                <div className="input-with-unit"><input id={field.code} type="number" inputMode="decimal" step="0.01" aria-invalid={Boolean(errors[field.code])} aria-describedby={`${field.code}-instruction${errors[field.code] ? ` ${field.code}-error` : ''}`} {...register(field.code, { required: `${field.label} is required.`, min: { value: 0.01, message: 'Enter a value greater than zero.' } })} /><span>{unit}</span></div>
                {errors[field.code] && <span className="field-error" id={`${field.code}-error`} role="alert">{errors[field.code].message}</span>}
                {flow.cameraScan?.measurements?.[field.code]?.value_mm != null && <span className="camera-provenance">{flow.cameraScan.measurements[field.code].source === 'photo_estimate' ? 'Photo estimate' : 'Camera estimate'} · pipeline quality {Math.round(flow.cameraScan.measurements[field.code].confidence * 100)}/100{flow.cameraScan.measurements[field.code].uncertainty_mm ? ` · ±${(flow.cameraScan.measurements[field.code].uncertainty_mm / (unit === 'cm' ? 10 : 25.4)).toFixed(2)} ${unit}` : ''} · not a validated accuracy probability</span>}
                {field.code === 'shirt_length' && ['review', 'photo_review'].includes(flow.cameraScan?.status) && <span className="camera-provenance">Manual entry required · preferred hem is not observable</span>}
                {!repeats.has(field.code) ? (
                  <button type="button" className="text-button" onClick={() => setRepeats((current) => new Set(current).add(field.code))}><Plus size={14} aria-hidden="true" /> Add repeat</button>
                ) : (
                  <div className="repeat-entry">
                    <label htmlFor={`second-${field.code}`}>Second attempt</label>
                    <div className="input-with-unit"><input id={`second-${field.code}`} aria-label={`${field.label} second attempt`} aria-invalid={Boolean(errors.second?.[field.code])} aria-describedby={errors.second?.[field.code] ? `second-${field.code}-error` : undefined} type="number" inputMode="decimal" step="0.01" {...register(`second.${field.code}`, { min: { value: 0.01, message: 'Enter a value greater than zero.' } })} /><span>{unit}</span></div>
                    {errors.second?.[field.code] && <span className="field-error" id={`second-${field.code}-error`} role="alert">{errors.second[field.code].message}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {submitError && <Notice tone="error">{submitError}</Notice>}
        <div className="page-actions"><button type="button" className="secondary-button" onClick={() => { const values = getValues(); updateFlow({ measurements: Object.fromEntries(fields.map((field) => [field.code, values[field.code]])), secondAttempts: values.second || {}, unit }); navigate('/consent') }}><ArrowLeft size={17} aria-hidden="true" /> Back</button><button className="primary-button" disabled={isSubmitting}>{isSubmitting ? 'Checking measurements…' : 'Check and continue'} <ArrowRight size={17} aria-hidden="true" /></button></div>
      </form>
    </section>
  )
}
