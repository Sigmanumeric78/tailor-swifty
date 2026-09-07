import { Check } from 'lucide-react'

export function CaptureInstructions({ view }) {
  const side = view === 'side'
  return <div className="scan-card"><h2>{side ? 'Side capture' : 'Front capture'}</h2><ul className="clean-list">
    {['Remove shoes and tie back large or loose hair.', 'Wear close-fitting clothing; loose clothing cannot be accurately reversed.', 'Use a plain, contrasting background with even front lighting.', 'Keep your full head and both feet visible; avoid ultrawide lenses and digital zoom.', side ? 'Turn about 90° and position your arms so the torso edge stays visible.' : 'Face forward in a neutral posture with arms slightly away from your torso.'].map((item) => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}
  </ul></div>
}
