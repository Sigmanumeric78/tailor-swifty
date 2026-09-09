import { reasonInstructions } from '../reasonCodes'

export function QualityChecklist({ passed, hardReasonCodes = [], warningCodes = [], reasonCodes = [] }) {
  const primaryCodes = hardReasonCodes.length || warningCodes.length ? [...hardReasonCodes, ...warningCodes] : reasonCodes
  const readyWithWarnings = passed && warningCodes.length > 0
  return <section className="quality-checklist" aria-live="polite" aria-label="Capture quality">
    <strong>{passed ? readyWithWarnings ? 'Ready to capture—with warnings' : 'Ready to capture' : 'Adjust your position'}</strong>
    {passed && !readyWithWarnings ? <p>Required person, framing, and orientation checks pass. Capture now or hold the pose for auto-capture.</p> : <>
      <p>{reasonInstructions[primaryCodes[0]] || 'Wait while the image is checked.'}</p>
      {primaryCodes.length > 1 && <details><summary>More diagnostics ({primaryCodes.length - 1})</summary><ul>{primaryCodes.slice(1).map((code) => <li key={code}>{reasonInstructions[code] || code}</li>)}</ul></details>}
    </>}
  </section>
}
