import { Check, Ruler, Shirt } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

const steps = [
  ['/', 'Choose', 'Garment'],
  ['/consent', 'Consent', 'Permission'],
  ['/measurements', 'Measure', 'Eight values'],
  ['/preferences', 'Style', 'Preferences'],
  ['/review', 'Review', 'Submission'],
  ['/results', 'Result', 'Specification'],
]

export function Layout({ children }) {
  const { pathname } = useLocation()
  const currentIndex = Math.max(0, steps.findIndex(([path]) => path === '/' ? pathname === '/' : pathname.startsWith(path)))
  return (
    <div className={pathname === '/' ? 'app-shell atelier-home' : 'app-shell'}>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Tailor Swifty home">
          <span className="brand-mark"><Shirt size={21} /></span>
          <span className="brand-name">Tailor Swifty</span>
        </Link>
        <span className="topbar-discipline">Adult shirt fitting</span>
      </header>
      <div className="workspace">
        <aside className="step-rail" aria-label="Recommendation progress">
          <div className="rail-title">
            <span className="rail-kicker">Fitting index</span>
            <span className="rail-subtitle"><Ruler size={16} /> Shirt specification</span>
          </div>
          <ol>
            {steps.map(([path, label, detail], index) => (
              <li
                key={path}
                className={index === currentIndex ? 'active' : index < currentIndex ? 'complete' : ''}
                aria-current={index === currentIndex ? 'step' : undefined}
              >
                <span className="step-number">{index < currentIndex ? <Check size={14} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}</span>
                <span className="step-copy"><strong>{label}</strong><small>{detail}</small></span>
              </li>
            ))}
          </ol>
        </aside>
        <main className="main-content">{children}</main>
      </div>
    </div>
  )
}
