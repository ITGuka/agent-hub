import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useT } from '../i18n'
import TemplatesMenu from './TemplatesMenu'

marked.setOptions({ gfm: true, breaks: true })
const md = (text) => DOMPurify.sanitize(marked.parse(text || ''))
const uid = () => crypto.randomUUID()

function newSession(agent, cwd) {
  const now = Date.now()
  return { id: uid(), agent, cwd, title: '', createdAt: now, updatedAt: now, agentSessionId: null, messages: [] }
}

// Apply one normalized agent event to the last (assistant) message.
function applyEvent(msg, ev) {
  const parts = [...msg.parts]
  const last = parts[parts.length - 1]
  if (ev.kind === 'text') {
    if (ev.delta && last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + ev.text }
    else parts.push({ type: 'text', text: ev.text })
  } else if (ev.kind === 'tool') {
    const i = parts.findIndex((p) => p.type === 'tool' && ev.id && p.id === ev.id)
    if (i >= 0) parts[i] = { ...parts[i], name: ev.name, detail: ev.detail }
    else parts.push({ type: 'tool', id: ev.id, name: ev.name, detail: ev.detail })
  } else if (ev.kind === 'toolResult') {
    const i = parts.findIndex((p) => p.type === 'tool' && p.id === ev.id)
    if (i >= 0) parts[i] = { ...parts[i], ok: ev.ok, output: ev.output }
  } else if (ev.kind === 'error') {
    return { ...msg, parts, error: ev.text }
  } else if (ev.kind === 'done') {
    return { ...msg, parts, cost: ev.cost ?? msg.cost, tokens: ev.tokens ?? msg.tokens, done: true }
  }
  return { ...msg, parts }
}

export default function ChatView({ tab, active, agents, settings, setSettings, onSession, onSaved }) {
  const t = useT()
  const agent = agents[tab.agent]
  const [session, setSession] = useState(null)
  const [input, setInput] = useState('')
  const [runId, setRunId] = useState(null)
  const [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const runRef = useRef(null)
  const sessionRef = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const stickBottom = useRef(true)

  sessionRef.current = session

  // Load an existing session or start a new one.
  useEffect(() => {
    if (tab.sessionId)
      window.api.sessions.get(tab.sessionId).then((s) => setSession(s || newSession(tab.agent, tab.cwd)))
    else setSession(newSession(tab.agent, tab.cwd))
  }, [])

  useEffect(() => {
    if (session) onSession(session)
  }, [session?.id, session?.title])

  const persist = (s) => window.api.sessions.save(s).then(onSaved)

  // End of a turn: on the agent's final result event, or when the process exits
  // (whichever comes first; some CLIs keep running briefly after answering).
  const finish = () => {
    if (!runRef.current) return
    runRef.current = null
    setRunId(null)
    setStatus('')
    setSession((cur) => {
      if (!cur) return cur
      const msgs = [...cur.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant' && !last.done) msgs[msgs.length - 1] = { ...last, done: true }
      const next = { ...cur, messages: msgs, updatedAt: Date.now() }
      persist(next)
      return next
    })
  }

  useEffect(
    () =>
      window.api.chat.onEvent((id, ev) => {
        if (id !== runRef.current) return
        if (ev.kind === 'status') return setStatus(ev.text)
        if (ev.kind === 'exit') return finish()
        setSession((s) => {
          if (!s) return s
          if (ev.kind === 'session') return { ...s, agentSessionId: ev.id }
          const msgs = [...s.messages]
          msgs[msgs.length - 1] = applyEvent(msgs[msgs.length - 1], ev)
          return { ...s, messages: msgs }
        })
        if (ev.kind === 'done') finish()
        else setStatus('')
      }),
    []
  )

  // Auto-scroll while the user is at the bottom.
  useEffect(() => {
    const el = listRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [session])

  useEffect(() => {
    if (active) requestAnimationFrame(() => inputRef.current?.focus())
  }, [active])

  const send = async () => {
    const text = input.trim()
    if (!text || runId || !session) return
    const id = uid()
    const s = {
      ...session,
      title: session.title || text.split('\n')[0].slice(0, 70),
      updatedAt: Date.now(),
      messages: [
        ...session.messages,
        { role: 'user', text, ts: Date.now() },
        { role: 'assistant', parts: [], ts: Date.now() }
      ]
    }
    setSession(s)
    setInput('')
    stickBottom.current = true
    runRef.current = id
    setRunId(id)
    setStatus(t('thinking'))
    persist(s)
    try {
      await window.api.chat.start({
        runId: id,
        agent: tab.agent,
        cwd: s.cwd,
        prompt: text,
        resumeId: s.agentSessionId,
        autoApprove: settings.chatAutoApprove
      })
    } catch (err) {
      setSession((cur) => {
        const msgs = [...cur.messages]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], error: err.message, done: true }
        return { ...cur, messages: msgs }
      })
      runRef.current = null
      setRunId(null)
      setStatus('')
    }
  }

  const stop = () => runId && window.api.chat.stop(runId)

  const insert = (text) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? input.length
    const next = input.slice(0, start) + text + input.slice(end)
    setInput(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.files.pathFor(f)).filter(Boolean)
    if (!paths.length) return
    // Claude Code and Gemini CLI understand @path references; Codex gets plain paths.
    const ref = (p) => (tab.agent === 'codex' ? (/\s/.test(p) ? `"${p}"` : p) : '@' + (/\s/.test(p) ? `"${p}"` : p))
    insert(paths.map(ref).join(' ') + ' ')
  }

  const onLinkClick = (e) => {
    const a = e.target.closest('a')
    if (a?.href && /^https?:/.test(a.href)) {
      e.preventDefault()
      window.open(a.href, '_blank')
    }
  }

  const totalCost = useMemo(
    () => (session?.messages || []).reduce((sum, m) => sum + (m.cost || 0), 0),
    [session]
  )

  if (!session) return <div className="chat" style={{ display: active ? 'flex' : 'none' }} />

  return (
    <div
      className={'chat' + (dragging ? ' dragging' : '')}
      style={{ display: active ? 'flex' : 'none', '--agent': agent?.color }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <div className="toolbar">
        <span className="tb-title ellipsis">
          <strong>{agent?.name}</strong> <span className="muted">· {session.cwd}</span>
        </span>
        {totalCost > 0 && <span className="muted small">${totalCost.toFixed(3)}</span>}
        <label className="check" title={t('autoApproveHint')}>
          <input
            type="checkbox"
            checked={!!settings.chatAutoApprove}
            onChange={async (e) => setSettings(await window.api.settings.update({ chatAutoApprove: e.target.checked }))}
          />
          {t('autoApprove')}
        </label>
        <button className="btn small" disabled={!session.messages.length} onClick={() => window.api.sessions.export(session.id)}>
          ⤓ {t('export')}
        </button>
      </div>

      <div
        className="messages"
        ref={listRef}
        onClick={onLinkClick}
        onScroll={(e) => {
          const el = e.currentTarget
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {session.messages.length === 0 && (
          <div className="chat-empty muted">
            <div className="chat-empty-title">{agent?.name}</div>
            {t('chatEmpty')}
          </div>
        )}
        {session.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg user">
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="msg assistant">
              {m.parts.map((p, j) =>
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
              )}
              {m.error && <div className="msg-error">⚠ {m.error}</div>}
              {!m.done && i === session.messages.length - 1 && runId && (
                <div className="typing">
                  <span className="spinner" /> {status || t('thinking')}
                </div>
              )}
              {m.done && (m.cost || m.tokens) ? (
                <div className="msg-meta muted">
                  {m.tokens ? `${m.tokens.toLocaleString()} tokens` : ''}
                  {m.cost ? ` · $${m.cost.toFixed(4)}` : ''}
                </div>
              ) : null}
            </div>
          )
        )}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          value={input}
          placeholder={t('chatPlaceholder')}
          rows={Math.min(10, Math.max(2, input.split('\n').length))}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-bar">
          <TemplatesMenu templates={settings.templates || []} onPick={insert} />
          <span className="muted small grow">{t('dropHint')}</span>
          {runId ? (
            <button className="btn small danger" onClick={stop}>
              ■ {t('stop')}
            </button>
          ) : (
            <button className="btn primary small agent-bg" disabled={!input.trim()} onClick={send}>
              {t('send')} ↵
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
