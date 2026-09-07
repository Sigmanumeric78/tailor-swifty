import { reasonInstructions } from '../reasonCodes'

export function QualityChecklist({ passed, reasonCodes = [] }) {
  return <section className="quality-checklist" aria-live="polite" aria-label="Capture quality">
    <strong>{passed ? 'Ready—hold still' : 'Adjust your position'}</strong>
    {passed ? <p>All mandatory framing, pose, lighting, sharpness and stability gates pass.</p> : <ul>{reasonCodes.map((code) => <li key={code}>{reasonInstructions[code] || code}</li>)}</ul>}
  </section>
}
