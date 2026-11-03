import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import TemplatesMenu from './TemplatesMenu'
import DiffModal from './DiffModal'
import Messages from '../chat/Messages'
import { useChat, newSession, uid, droppedFiles, fileRefs } from '../chat/useChat'

// One agent's column. Reacts to `sendSignal` / `bestSignal` from the parent.
function Column({ agent, project, worktree, groupId, settings, onSaved, sendSignal, bestSignal, onBest, onRunning, stopSignal }) {
  const t = useT()
  const chat = useChat({
    init: { session: newSession({ agent: agent.id, cwd: project, worktree, groupId }) },
    settings,
    onSaved
  })
  const { session, running, status } = chat
  const [showDiff, setShowDiff] = useState(false)
  const listRef = useRef(null)
  const stick = useRef(true)

  useEffect(() => {
    if (sendSignal?.text && session) {
      stick.current = true
      chat.addDirs(sendSignal.dirs || [])
      chat.send(sendSignal.text, { ...session, extraDirs: [...new Set([...(session.extraDirs || []), ...(sendSignal.dirs || [])])] })
    }
  }, [sendSignal?.n])

  useEffect(() => {
    if (stopSignal) chat.stop()
  }, [stopSignal])

  useEffect(() => {
    if (!bestSignal || !session) return
    const msgs = session.messages.map((m, i) =>
      i === bestSignal.index && m.role === 'assistant' ? { ...m, best: bestSignal.agent === agent.id } : m
    )
    chat.update({ messages: msgs })
  }, [bestSignal?.n])

  useEffect(() => onRunning(agent.id, running), [running])

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [session])

  if (!session) return <div className="column" />
  return (
    <div className="column" style={{ '--agent': agent.color }}>
      <div className="column-head">
        <span className="tab-color" />
        <strong className="grow ellipsis">{agent.name}</strong>
        {worktree && (
          <span className="chip wt" title={worktree.path}>
            ⑂ {worktree.branch.split('/').pop()}
          </span>
        )}
        {running && <span className="spinner" />}
        <button className="btn small" onClick={() => setShowDiff(true)}>
          ± Diff
        </button>
      </div>
      <Messages
        ref={listRef}
        session={session}
        running={running}
        status={status}
        onBest={(i) => onBest(agent.id, i)}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        empty={<div className="chat-empty muted small">{t('waitingPrompt')}</div>}
      />
      {showDiff && (
        <DiffModal
          title={agent.name}
          dir={session.cwd}
          base={session.worktree?.base}
          worktree={session.worktree}
          onClose={() => setShowDiff(false)}
          onWorktreeRemoved={() => chat.update({ worktree: null })}
        />
      )}
    </div>
  )
}

// Send one prompt to several agents at once and compare the answers side by side.
export default function CompareView({ tab, visible, focused, agents, detect, settings, setSettings, onSaved, onFocus, onTitle }) {
  const t = useT()
  const installed = Object.values(agents).filter((a) => detect?.agents[a.id]?.installed !== false)
  const [picked, setPicked] = useState(() => installed.map((a) => a.id))
  const [isolate, setIsolate] = useState(true)
  const [gitInfo, setGitInfo] = useState(null)
  const [setup, setSetup] = useState(null) // { agents: [...], worktrees: {id: wt} }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [sendSignal, setSendSignal] = useState(null)
  const [bestSignal, setBestSignal] = useState(null)
  const [stopSignal, setStopSignal] = useState(0)
  const [runningMap, setRunningMap] = useState({})
  const bestByTurn = useRef({})
  const [groupId] = useState(uid)
  const [pendingDirs, setPendingDirs] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    window.api.git.info(tab.cwd).then(setGitInfo)
  }, [tab.cwd])

  const canIsolate = gitInfo?.repo && gitInfo?.hasCommit
  const anyRunning = Object.values(runningMap).some(Boolean)

  const start = async () => {
    setBusy(true)
    setError(null)
    const worktrees = {}
    try {
      if (isolate && canIsolate) for (const id of picked) worktrees[id] = await window.api.git.createWorktree(tab.cwd, id)
      setSetup({ agents: picked, worktrees })
    } catch (e) {
      setError(e.message)
      for (const wt of Object.values(worktrees)) window.api.git.removeWorktree(wt)
    }
    setBusy(false)
  }

  const submit = () => {
    const text = input.trim()
    if (!text || anyRunning) return
    setInput('')
    setSendSignal((s) => ({ n: (s?.n || 0) + 1, text, dirs: pendingDirs }))
    setPendingDirs([])
    if (!tab.titled) onTitle(text.split('\n')[0].slice(0, 60))
  }

  // Mark one agent's answer for a turn as best; keeps win statistics in settings.
  const onBest = async (agentId, index) => {
    const prev = bestByTurn.current[index]
    if (prev === agentId) return
    bestByTurn.current[index] = agentId
    setBestSignal((s) => ({ n: (s?.n || 0) + 1, agent: agentId, index }))
    const stats = { comparisons: 0, wins: {}, ...(settings.stats || {}) }
    const wins = { ...stats.wins }
    if (prev) wins[prev] = Math.max(0, (wins[prev] || 0) - 1)
    wins[agentId] = (wins[agentId] || 0) + 1
    setSettings(
      await window.api.settings.update({ stats: { comparisons: stats.comparisons + (prev ? 0 : 1), wins } })
    )
  }

  const onDrop = (e) => {
    e.preventDefault()
    const { paths, dirs } = droppedFiles(e, tab.cwd)
    if (!paths.length) return
    setPendingDirs((d) => [...new Set([...d, ...dirs])])
    // @path works for Claude and Gemini, and Codex reads plain paths fine too.
    setInput((v) => v + fileRefs('claude', paths))
  }

  const stats = settings.stats || { wins: {} }

  return (
    <div
      className={'compare pane' + (focused ? ' focused' : '')}
      style={{ display: visible ? 'flex' : 'none' }}
      onMouseDown={onFocus}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="toolbar">
        <span className="tb-title ellipsis">
          <strong>⚖ {t('compare')}</strong> <span className="muted">· {tab.cwd}</span>
        </span>
        {Object.values(agents).map((a) => (
          <span key={a.id} className="chip" style={{ color: a.color }} title={t('wins')}>
            ★ {a.name.split(' ')[0]} {stats.wins?.[a.id] || 0}
          </span>
        ))}
      </div>

      {!setup ? (
        <div className="compare-setup">
          <h2>{t('compareTitle')}</h2>
          <p className="muted">{t('compareSub')}</p>
          <div className="pick-agents">
            {Object.values(agents).map((a) => {
              const ok = detect?.agents[a.id]?.installed !== false
              return (
                <label key={a.id} className={'pick' + (ok ? '' : ' off')} style={{ '--agent': a.color }}>
                  <input
                    type="checkbox"
                    disabled={!ok}
                    checked={picked.includes(a.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))}
                  />
                  {a.name}
                </label>
              )
            })}
          </div>
          <label className={'check big' + (canIsolate ? '' : ' off')}>
            <input type="checkbox" disabled={!canIsolate} checked={isolate && !!canIsolate} onChange={(e) => setIsolate(e.target.checked)} />
            {t('isolateWorktrees')}
          </label>
          <p className="muted small">
            {gitInfo === null
              ? t('checking')
              : !gitInfo.git
                ? t('gitMissing')
                : !gitInfo.repo
                  ? t('notRepo')
                  : !gitInfo.hasCommit
                    ? t('noCommits')
                    : t('isolateHint')}
          </p>
          {error && <p className="msg-error">{error}</p>}
          <button className="btn primary" disabled={picked.length < 1 || busy} onClick={start}>
            {busy ? t('preparing') : t('startCompare')}
          </button>
        </div>
      ) : (
        <>
          <div className={'columns n' + setup.agents.length}>
            {setup.agents.map((id) => (
              <Column
                key={id}
                agent={agents[id]}
                project={tab.cwd}
                worktree={setup.worktrees[id] || null}
                groupId={groupId}
                settings={settings}
                onSaved={onSaved}
                sendSignal={sendSignal}
                bestSignal={bestSignal}
                stopSignal={stopSignal}
                onBest={onBest}
                onRunning={(a, r) => setRunningMap((m) => ({ ...m, [a]: r }))}
              />
            ))}
          </div>
          <div className="composer">
            <textarea
              ref={inputRef}
              value={input}
              placeholder={t('comparePlaceholder')}
              rows={Math.min(8, Math.max(2, input.split('\n').length))}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <div className="composer-bar">
              <TemplatesMenu templates={settings.templates || []} onPick={(text) => setInput((v) => v + text)} />
              <span className="muted small grow">{t('dropHint')}</span>
              {anyRunning ? (
                <button className="btn small danger" onClick={() => setStopSignal((n) => n + 1)}>
                  ■ {t('stopAll')}
                </button>
              ) : (
                <button className="btn primary small" disabled={!input.trim()} onClick={submit}>
                  {t('sendAll')} ↵
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
