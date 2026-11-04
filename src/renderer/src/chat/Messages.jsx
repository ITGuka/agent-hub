import { forwardRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useT } from '../i18n'

marked.setOptions({ gfm: true, breaks: true })
const md = (text) => DOMPurify.sanitize(marked.parse(text || ''))

// Text (Markdown) and tool-call blocks of one assistant message.
export function Parts({ m }) {
  return m.parts.map((p, j) =>
    p.type === 'text' ? (
      <div key={j} className="md" dangerouslySetInnerHTML={{ __html: md(p.text) }} />
    ) : (
      <details key={j} className={'tool' + (p.ok === false ? ' failed' : '')}>
        <summary>
          <span className="tool-name">{p.name}</span>
          <span className="tool-detail ellipsis">{(p.detail || '').split('\n')[0]}</span>
          {p.ok === undefined && !m.done && <span className="spinner" />}
        </summary>
        {(p.detail || '').includes('\n') && <pre>{p.detail}</pre>}
        {p.output && <pre>{p.output}</pre>}
      </details>
    )
  )
}

export const onLinkClick = (e) => {
  const a = e.target.closest('a')
  if (a?.href && /^https?:/.test(a.href)) {
    e.preventDefault()
    window.open(a.href, '_blank')
  }
}

// Scrollable message list. `onBest(index)` (optional) shows a "best answer" button.
const Messages = forwardRef(function Messages({ session, running, status, empty, onScroll, onBest }, ref) {
  const t = useT()
  return (
    <div className="messages" ref={ref} onClick={onLinkClick} onScroll={onScroll}>
      {session.messages.length === 0 && empty}
      {session.messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="msg user">
            <div className="bubble">{m.text}</div>
          </div>
        ) : (
          <div key={i} className={'msg assistant' + (m.best ? ' best' : '')}>
            <Parts m={m} />
            {m.error && <div className="msg-error">⚠ {m.error}</div>}
            {!m.done && i === session.messages.length - 1 && running && (
              <div className="typing">
                <span className="spinner" /> {status || t('thinking')}
              </div>
            )}
            {m.done && (
              <div className="msg-meta muted">
                {m.tokens ? `${m.tokens.toLocaleString()} tokens` : ''}
                {m.cost ? ` · $${m.cost.toFixed(4)}` : ''}
                {onBest && !m.error && m.parts.some((p) => p.type === 'text' && p.text.trim()) && (
                  <button className={'best-btn' + (m.best ? ' on' : '')} onClick={() => onBest(i)}>
                    ★ {m.best ? t('bestAnswer') : t('markBest')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
})

export default Messages
