import { Check, Ruler, Shirt } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

const steps = [
  ['/', 'Choose'],
  ['/consent', 'Consent'],
  ['/measurements', 'Measure'],
  ['/preferences', 'Style'],
  ['/review', 'Review'],
  ['/results', 'Result'],
]

export function Layout({ children }) {
  const { pathname } = useLocation()
  const currentIndex = Math.max(0, steps.findIndex(([path]) => path === '/' ? pathname === '/' : pathname.startsWith(path)))
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Tailored Outfit home">
          <span className="brand-mark"><Shirt size={21} /></span>
          <span>Tailored Outfit</span>
        </Link>
      </header>
      <div className="workspace">
        <aside className="step-rail" aria-label="Recommendation progress">
          <div className="rail-title"><Ruler size={17} /> Shirt fitting</div>
          <ol>
            {steps.map(([path, label], index) => (
              <li key={path} className={index === currentIndex ? 'active' : index < currentIndex ? 'complete' : ''}>
                <span className="step-number">{index < currentIndex ? <Check size={14} /> : index + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </aside>
        <main className="main-content">{children}</main>
      </div>
    </div>
  )
}
