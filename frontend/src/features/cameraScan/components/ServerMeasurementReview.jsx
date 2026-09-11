export function ServerMeasurementReview({ result }) {
  return <div className="server-measurement-review">
    <p>Pipeline quality score: {Math.round(result.overall_quality_score * 100)}/100. This is not a validated probability that a measurement is accurate.</p>
    <ul className="clean-list">
      {Object.entries(result.measurements).map(([code, item]) => <li key={code}>
        <strong>{code === 'neck_circumference' ? 'Neck circumference' : code.replaceAll('_', ' ')}</strong>
        <span>{item.value_mm == null ? 'Manual entry required' : `${item.value_mm} mm ± ${item.uncertainty_mm} mm`} · quality {Math.round(item.quality_score * 100)}/100</span>
        {item.reason_codes?.length > 0 && <small>{item.reason_codes.join(' · ')}</small>}
      </li>)}
    </ul>
  </div>
}
