export function ScanReview({ view, selectedCount, onAccept, onRetake }) {
  return <section className="scan-card"><h2>Review {view} capture</h2><p>{selectedCount} temporally separated frames passed selection. Images remain only in this browser’s memory.</p><div className="inline-actions"><button className="secondary-button" type="button" onClick={onRetake}>Retake {view}</button><button className="primary-button" type="button" onClick={onAccept}>Use {view} capture</button></div></section>
}
