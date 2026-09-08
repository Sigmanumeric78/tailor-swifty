import { reasonInstructions } from '../reasonCodes'

export function QualityChecklist({ passed, reasonCodes = [] }) {
  return <section className="quality-checklist" aria-live="polite" aria-label="Capture quality">
    <strong>{passed ? 'Ready—hold still' : 'Adjust your position'}</strong>
    {passed ? <p>All mandatory gates pass. Hold this pose while the three-second countdown completes.</p> : <>
      <p>{reasonInstructions[reasonCodes[0]] || 'Wait while the image is checked.'}</p>
      {reasonCodes.length > 1 && <details><summary>More diagnostics ({reasonCodes.length - 1})</summary><ul>{reasonCodes.slice(1).map((code) => <li key={code}>{reasonInstructions[code] || code}</li>)}</ul></details>}
    </>}
  </section>
}
