import { AlertCircle, Info, TriangleAlert } from 'lucide-react'

export function Notice({ children, tone = 'info' }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warning' ? TriangleAlert : Info
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={18} aria-hidden="true" /><span>{children}</span></div>
}
