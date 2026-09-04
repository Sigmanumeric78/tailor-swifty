import { CheckCircle2, Printer, Ruler, Shirt, TriangleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'

const humanize = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export function ResultPage() {
  const { id } = useParams()
  const { flow } = useFlow()
  const resultQuery = useQuery({ queryKey: ['recommendation', id], queryFn: () => api.recommendation(id), enabled: !flow.result })
  const result = flow.result || resultQuery.data
  if (resultQuery.isLoading && !result) return <div className="loading-state">Loading recommendation…</div>
  if (!result) return <div className="empty-state"><h1>Recommendation unavailable</h1><p>{resultQuery.error?.message || 'Complete the fitting flow to create a result.'}</p></div>
  return (
    <section>
      <PageHeader eyebrow="Recommendation complete" title={result.garment_template.name} description={result.garment_template.description} />
      <div className="result-overview">
        <div className="result-visual"><Shirt size={112} strokeWidth={1.15} /><span>{result.garment_template.fabric}</span></div>
        <div className="score-panel"><div className="total-score"><strong>{result.total_score}</strong><span>out of 100</span></div><div className="score-bars">{Object.entries(result.score_breakdown).map(([factor, score]) => <div key={factor}><span>{humanize(factor)}</span><strong>{score}</strong><progress value={score} max={factor === 'occasion' ? 30 : factor === 'climate_and_fabric' || factor === 'fit' ? 20 : 15} /></div>)}</div></div>
      </div>
      <div className="result-columns">
        <div className="result-section"><h2><CheckCircle2 size={19} /> Why this shirt</h2><ul className="clean-list">{result.reasons.map((reason) => <li key={reason}><CheckCircle2 size={16} /> {reason}</li>)}</ul></div>
        <div className="result-section"><h2><TriangleAlert size={19} /> Review notes</h2><ul className="clean-list warnings">{result.warnings.map((warning) => <li key={warning}><TriangleAlert size={16} /> {warning}</li>)}</ul></div>
      </div>
      <div className="specification"><div className="spec-heading"><div><p className="eyebrow">Tailor specification</p><h2>Body and finished measurements</h2></div><Ruler size={26} /></div><div className="spec-table"><div className="spec-row header"><span>Measurement</span><span>Body</span><span>Finished target</span></div>{Object.entries(result.normalized_body_measurements).map(([code, value]) => <div className="spec-row" key={code}><span>{humanize(code)}</span><span>{value} mm</span><strong>{result.target_finished_measurements[code]} mm</strong></div>)}</div></div>
      <Notice>Finished targets are not production-ready sewing patterns. Fabric behavior, construction, posture, and fitting adjustments require a qualified tailor.</Notice>
      <div className="version-line">Rules v{result.rules_version} · Catalog v{result.catalog_version} · Measurement schema v{result.measurement_schema_version}</div>
      <div className="page-actions end"><button className="secondary-button" onClick={() => window.print()}><Printer size={17} /> Print tailor sheet</button></div>
    </section>
  )
}

