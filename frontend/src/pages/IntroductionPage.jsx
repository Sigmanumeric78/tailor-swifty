import { ArrowRight, Check, Shirt } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'

export function IntroductionPage() {
  const navigate = useNavigate()
  const { updateFlow } = useFlow()
  const start = () => {
    updateFlow({ garment: 'shirt' })
    navigate('/consent')
  }
  return (
    <section className="page page-introduction">
      <PageHeader eyebrow="Adult shirt fitting · 01" title="A shirt, measured for you." description="Eight precise measurements and your selected preferences become one transparent shirt recommendation, with finished-garment targets ready to review." />
      <div className="selection-layout">
        <button type="button" className="garment-choice selected" onClick={start}>
          <span className="garment-visual"><Shirt size={116} strokeWidth={1} aria-hidden="true" /></span>
          <span className="garment-copy"><small>Available garment</small><strong>Made-to-measure shirt</strong><span>Eight required measurements</span></span>
          <span className="choice-check"><Check size={16} aria-hidden="true" /></span>
        </button>
        <div className="scope-panel">
          <p className="section-number">Preparation / 03</p>
          <h2>Before you begin</h2>
          <ul className="clean-list">
            <li><Check size={16} aria-hidden="true" /><span>Use a flexible tape and light clothing.</span></li>
            <li><Check size={16} aria-hidden="true" /><span>Keep the tape level without pulling tight.</span></li>
            <li><Check size={16} aria-hidden="true" /><span>Allow about six minutes for the adult fitting flow.</span></li>
          </ul>
          <p className="data-note">Production fitting data is stored securely in a Neon PostgreSQL database.</p>
        </div>
      </div>
      <div className="page-actions end"><button className="primary-button" onClick={start}>Continue <ArrowRight size={17} aria-hidden="true" /></button></div>
    </section>
  )
}
