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
    <section>
      <PageHeader eyebrow="Adult fitting · First release" title="Build your shirt specification" description="Enter eight tape measurements and a few style choices. The local rules engine will return one explainable shirt recommendation and finished-garment targets." />
      <div className="selection-layout">
        <button type="button" className="garment-choice selected" onClick={start}>
          <span className="garment-visual"><Shirt size={72} strokeWidth={1.35} /></span>
          <span className="garment-copy"><strong>Shirt</strong><small>Eight required measurements</small></span>
          <span className="choice-check"><Check size={16} /></span>
        </button>
        <div className="scope-panel">
          <h2>Before you begin</h2>
          <ul className="clean-list">
            <li><Check size={16} /> Use a flexible tape and light clothing.</li>
            <li><Check size={16} /> Keep the tape level without pulling tight.</li>
            <li><Check size={16} /> This adult flow takes about 6 minutes.</li>
          </ul>
          <p>Your measurements remain in your local PostgreSQL database. No cloud service or external API is used.</p>
        </div>
      </div>
      <div className="page-actions end"><button className="primary-button" onClick={start}>Continue <ArrowRight size={17} /></button></div>
    </section>
  )
}

