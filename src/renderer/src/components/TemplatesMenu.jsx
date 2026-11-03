import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

// Dropdown listing prompt templates; calls onPick(text).
export default function TemplatesMenu({ templates, onPick }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn small" onClick={() => setOpen((o) => !o)} title={t('templates')}>
        ☰ {t('templates')}
      </button>
      {open && (
        <div className="menu">
          {templates.length === 0 && <div className="menu-empty">{t('noTemplates')}</div>}
          {templates.map((tp, i) => (
            <button
              key={i}
              className="menu-item"
              title={tp.text}
              onClick={() => {
                onPick(tp.text)
                setOpen(false)
              }}
            >
              {tp.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
