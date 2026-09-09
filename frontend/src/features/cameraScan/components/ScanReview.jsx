import { useEffect, useRef } from 'react'
import { reasonInstructions } from '../reasonCodes'

export function ScanReview({ view, selectedCount, frame, warningCodes = [], onAccept, onRetake }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame?.bitmap) return undefined
    const maximum = 640; const scale = Math.min(1, maximum / Math.max(frame.width, frame.height)); canvas.width = Math.round(frame.width * scale); canvas.height = Math.round(frame.height * scale)
    const context = canvas.getContext('2d'); context.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height)
    return () => { context.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0 }
  }, [frame])
  return <section className="scan-card"><h2>Review {view} capture</h2><div className="scan-review-preview"><canvas ref={canvasRef} aria-label={`Frozen ${view} capture preview`} /></div><p>{selectedCount} temporally separated frames passed required person, framing, and orientation checks. Images remain only in this browser’s memory.</p>{warningCodes.length > 0 && <details><summary>Capture warnings ({warningCodes.length})</summary><ul>{warningCodes.map((code) => <li key={code}>{reasonInstructions[code] || code}</li>)}</ul></details>}<div className="inline-actions"><button className="secondary-button" type="button" onClick={onRetake}>Retake {view}</button><button className="primary-button" type="button" onClick={onAccept}>Use {view} capture</button></div></section>
}
