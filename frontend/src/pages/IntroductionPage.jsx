import { useNavigate } from 'react-router-dom'
import { useFlow } from '../features/FlowContext'
import { AtelierHero } from '../components/atelier/AtelierHero'
import { atelierAssets } from '../components/atelier/assets'

export function IntroductionPage() {
  const navigate = useNavigate()
  const { updateFlow } = useFlow()
  const start = () => {
    updateFlow({ garment: 'shirt' })
    navigate('/consent')
  }
  return (
    <div className="atelier-landing">
      <AtelierHero onStart={start} assets={atelierAssets} />
      <section className="atelier-process" id="atelier-how" aria-labelledby="atelier-process-title">
        <p className="atelier-process-kicker">ADULT SHIRT FITTING</p>
        <h2 id="atelier-process-title">Considered at every step.</h2>
        <div className="atelier-process-grid">
          <article><span>01</span><h3>Choose your approach</h3><p>Enter measurements with a flexible tape, or try the experimental photo-assisted flow after consent.</p></article>
          <article><span>02</span><h3>Make it personal</h3><p>Review your measurements and choose your fit preferences. Photo estimates require your review.</p></article>
          <article><span>03</span><h3>Find your direction</h3><p>Receive a transparent shirt recommendation and finished-garment targets to discuss with your tailor.</p></article>
        </div>
        <p className="atelier-process-note">For manual measurements, use a flexible tape, keep it level, and avoid pulling tight. For photos, follow the capture instructions and wear close-fitting clothing.</p>
      </section>
    </div>
  )
}
