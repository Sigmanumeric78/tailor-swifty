import { confidenceBand } from '../geometry/confidence'

const labels = { neck_circumference: 'Neck circumference', chest_circumference: 'Chest circumference', waist_circumference: 'Waist circumference', hip_circumference: 'Hip circumference', shoulder_width: 'Shoulder width', sleeve_length: 'Sleeve length', armhole_depth: 'Armhole depth', shirt_length: 'Shirt length' }

export function MeasurementEstimateReview({ measurements }) {
  return <section className="scan-card"><h2>Experimental estimates</h2><div className="estimate-table" role="table">{Object.values(measurements).map((item) => <div className="estimate-row" role="row" key={item.measurement_code}><span role="cell">{labels[item.measurement_code]}</span><strong role="cell">{item.value_mm == null ? 'Manual entry required' : `${(item.value_mm / 10).toFixed(1)} cm`}</strong><span role="cell">{confidenceBand(item.confidence)} confidence{item.uncertainty_mm ? ` · ±${(item.uncertainty_mm / 10).toFixed(1)} cm` : ''}</span></div>)}</div></section>
}
