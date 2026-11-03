import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import TemplatesMenu from './TemplatesMenu'
import DiffModal from './DiffModal'
import Messages from '../chat/Messages'
import { useChat, newSession, droppedFiles, fileRefs } from '../chat/useChat'
import { notify, messageText } from '../notify'

export default function ChatView({ tab, visible, focused, agents, settings, setSettings, onSession, onSaved, onFocus }) {
  const t = useT()
  const agent = agents[tab.agent]
  const { session, running, status, send, stop, addDirs, update } = useChat({
    init: tab.sessionId
      ? { sessionId: tab.sessionId, fallback: newSession({ agent: tab.agent, cwd: tab.cwd }) }
      : { session: newSession({ agent: tab.agent, cwd: tab.cwd, worktree: tab.worktree }) },
    settings,
    onSaved,
    onFinish: (s) => {
      const last = s.messages[s.messages.length - 1]
      notify(settings, {
        title: `${agent?.name}: ${last?.error ? '⚠' : '✓'} ${s.title || ''}`,
        body: last?.error || messageText(last),
        onClick: onFocus
      })
    }
  })
  const [input, setInput] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const stickBottom = useRef(true)

  useEffect(() => {
    if (session) onSession(session)
  }, [session?.id, session?.title])

  useEffect(() => {
    const el = listRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [session])

  useEffect(() => {
    if (focused && visible) requestAnimationFrame(() => inputRef.current?.focus())
  }, [focused, visible])

  const submit = () => {
    const text = input.trim()
    if (!text || running) return
    setInput('')
    stickBottom.current = true
    send(text)
  }

  const insert = (text) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? input.length
    setInput(input.slice(0, start) + text + input.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const { paths, dirs } = droppedFiles(e, session?.cwd)
    if (!paths.length) return
    addDirs(dirs)
    insert(fileRefs(tab.agent, paths))
  }

  const totalCost = useMemo(() => (session?.messages || []).reduce((sum, m) => sum + (m.cost || 0), 0), [session])

  if (!session) return <div className="chat pane" style={{ display: visible ? 'flex' : 'none' }} />

  return (
    <div
      className={'chat pane' + (dragging ? ' dragging' : '') + (focused ? ' focused' : '')}
      style={{ display: visible ? 'flex' : 'none', '--agent': agent?.color }}
      onMouseDown={onFocus}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <div className="toolbar">
        <span className="tb-title ellipsis">
          <strong>{agent?.name}</strong> <span className="muted">· {session.project || session.cwd}</span>
        </span>
        {session.worktree && (
          <span className="chip wt" title={session.worktree.path}>
            ⑂ {session.worktree.branch}
          </span>
        )}
        {session.extraDirs?.length > 0 && (
          <span className="chip" title={session.extraDirs.join('\n')}>
            +{session.extraDirs.length} {t('extraFolders')}
          </span>
        )}
        {totalCost > 0 && <span className="muted small">${totalCost.toFixed(3)}</span>}
        <label className="check" title={t('autoApproveHint')}>
          <input
            type="checkbox"
            checked={!!settings.chatAutoApprove}
            onChange={async (e) => setSettings(await window.api.settings.update({ chatAutoApprove: e.target.checked }))}
          />
          {t('autoApprove')}
        </label>
        <button className="btn small" onClick={() => setShowDiff(true)} title={t('diffHint')}>
          ± Diff
        </button>
        <button className="btn small" disabled={!session.messages.length} onClick={() => window.api.sessions.export(session.id)}>
          ⤓ {t('export')}
        </button>
      </div>

      <Messages
        ref={listRef}
        session={session}
        running={running}
        status={status}
        onScroll={(e) => {
          const el = e.currentTarget
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        empty={
          <div className="chat-empty muted">
            <div className="chat-empty-title">{agent?.name}</div>
            {t('chatEmpty')}
          </div>
        }
      />

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
              submit()
            }
          }}
        />
        <div className="composer-bar">
          <TemplatesMenu templates={settings.templates || []} onPick={insert} />
          <span className="muted small grow">{t('dropHint')}</span>
          {running ? (
            <button className="btn small danger" onClick={stop}>
              ■ {t('stop')}
            </button>
          ) : (
            <button className="btn primary small agent-bg" disabled={!input.trim()} onClick={submit}>
              {t('send')} ↵
            </button>
          )}
        </div>
      </div>

      {showDiff && (
        <DiffModal
          title={`${agent?.name} · ${session.title || ''}`}
          dir={session.cwd}
          base={session.worktree?.base}
          worktree={session.worktree}
          onClose={() => setShowDiff(false)}
          onWorktreeRemoved={() => update({ worktree: null, cwd: session.project || session.cwd, agentSessionId: null })}
        />
      )}
    </div>
  )
}
