import { confidenceBand } from '../geometry/confidence'
import { reasonInstructions } from '../reasonCodes'

const labels = { neck_circumference: 'Neck circumference', chest_circumference: 'Chest circumference', waist_circumference: 'Waist circumference', hip_circumference: 'Hip circumference', shoulder_width: 'Shoulder width', sleeve_length: 'Sleeve length', armhole_depth: 'Armhole depth', shirt_length: 'Shirt length' }

export function MeasurementEstimateReview({ measurements }) {
  return <section className="scan-card"><h2>Experimental estimates</h2><p>Pipeline quality scores summarize capture and model checks. They are not validated probabilities that a measurement is accurate.</p><div className="estimate-table" role="table">{Object.values(measurements).map((item) => <div className="estimate-row" role="row" key={item.measurement_code}><span role="cell">{labels[item.measurement_code]}</span><strong role="cell">{item.value_mm == null ? 'Manual entry required' : `${(item.value_mm / 10).toFixed(1)} cm`}</strong><span role="cell">{item.source === 'photo_estimate' ? 'Photo estimate' : 'Camera estimate'} · {confidenceBand(item.confidence)} pipeline quality · {Math.round(item.confidence * 100)}/100{item.uncertainty_mm ? ` · ±${(item.uncertainty_mm / 10).toFixed(1)} cm` : ''}{item.warnings?.length ? <small>{item.warnings.map((warning) => reasonInstructions[warning] || warning).join(' ')}</small> : null}</span></div>)}</div></section>
}
