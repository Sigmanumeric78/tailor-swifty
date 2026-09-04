import { AlertCircle, Info } from 'lucide-react'

export function Notice({ children, tone = 'info' }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}<span>{children}</span></div>
}

