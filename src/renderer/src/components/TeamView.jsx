import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import TemplatesMenu from './TemplatesMenu'
import DiffModal from './DiffModal'
import { Parts, onLinkClick } from '../chat/Messages'
import { useTeam, newTeamSession } from '../team/useTeam'
import { DEFAULT_TEAM, ROLE_KEYS, buildSteps } from '../team/flow'

const STAGES = [
  ['spec', 'spec'],
  ['g1', 'gate'],
  ['plan', 'plan'],
  ['planReview', 'planReview'],
  ['g2', 'gate'],
  ['impl', 'impl'],
  ['check', 'check'],
  ['codeReview', 'codeReview'],
  ['g3', 'gate']
]

function Config({ cfg, setCfg, agents, t, onClose }) {
  const conflict = (a, b) => cfg.roles[a] === cfg.roles[b]
  return (
    <div className="team-config">
      <div className="team-roles">
        {ROLE_KEYS.map((r) => (
          <label key={r} className="team-role">
            <span>{t('role_' + r)}</span>
            <select value={cfg.roles[r]} onChange={(e) => setCfg({ ...cfg, roles: { ...cfg.roles, [r]: e.target.value } })}>
              {Object.values(agents).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {(conflict('plan', 'planReview') || conflict('impl', 'codeReview')) && <p className="warn small">⚠ {t('authorIsReviewer')}</p>}
      <div className="row">
        <label className="grow">
          <span className="muted small">{t('testCommand')}</span>
          <input
            className="mono"
            placeholder="composer test   /   npm test   /   vendor/bin/phpunit"
            value={cfg.testCommand}
            onChange={(e) => setCfg({ ...cfg, testCommand: e.target.value })}
          />
        </label>
        <label>
          <span className="muted small">{t('maxRetries')}</span>
          <input type="number" min={1} max={10} value={cfg.maxRetries} onChange={(e) => setCfg({ ...cfg, maxRetries: Math.max(1, +e.target.value || 1) })} style={{ width: 80 }} />
        </label>
      </div>
      <div className="row between">
        <label className="check">
          <input type="checkbox" checked={!!cfg.isolate} onChange={(e) => setCfg({ ...cfg, isolate: e.target.checked })} />
          {t('teamIsolate')}
        </label>
        <button className="btn small" onClick={onClose}>
          {t('done')}
        </button>
      </div>
    </div>
  )
}

function GateCard({ m, pending, worktree, cwd, onDecide, t }) {
  const [text, setText] = useState('')
  const statusText = { approve: '✓ ' + t('approved'), return: '↩ ' + t('returned'), stop: '■ ' + t('pipelineStopped') }[m.status]
  return (
    <div className={'gate-card ' + (m.kind || 'gate') + (pending ? ' pending' : '')}>
      <div className="gate-title">
        <span className="gate-mark" />
        <strong>{m.label}</strong>
        {!pending && <span className="muted small">{statusText}</span>}
      </div>
      {m.files?.length > 0 && (
        <div className="gate-files">
          {m.files.map((f) => (
            <button key={f} className="file-chip" title={t('openFile')} onClick={() => window.api.projects.reveal(cwd + '/' + f)}>
              📄 {f}
            </button>
          ))}
        </div>
      )}
      {!pending && m.feedback && <div className="gate-feedback">“{m.feedback}”</div>}
      {pending && (
        <>
          <textarea rows={2} value={text} placeholder={t('returnFeedback')} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            {m.final && worktree ? (
              <>
                <button className="btn primary small" onClick={() => onDecide('approve', '', true)}>
                  ✓ {t('approveApply')}
                </button>
                <button className="btn small" onClick={() => onDecide('approve', '', false)}>
                  ✓ {t('approveOnly')}
                </button>
              </>
            ) : (
              <button className="btn primary small" onClick={() => onDecide('approve')}>
                ✓ {m.kind === 'gate' ? t('approve') : t('continueAnyway')}
              </button>
            )}
            <button className="btn small" onClick={() => onDecide('return', text)}>
              ↩ {t('returnBack')}
            </button>
            <span className="grow" />
            <button className="btn small danger" onClick={() => onDecide('stop')}>
              ■ {t('stop')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// One chat window for the whole team: a task goes through spec → plan → review →
// implementation → tests → code review, with human approval gates.
export default function TeamView({ tab, visible, focused, agents, settings, setSettings, onSaved, onFocus, onTitle }) {
  const t = useT()
  const cfg = { ...DEFAULT_TEAM, ...(settings.team || {}), roles: { ...DEFAULT_TEAM.roles, ...(settings.team?.roles || {}) } }
  const setCfg = async (c) => setSettings(await window.api.settings.update({ team: c }))
  const team = useTeam({
    init: tab.sessionId ? { sessionId: tab.sessionId, fallback: newTeamSession(tab.cwd) } : { session: newTeamSession(tab.cwd) },
    agents,
    settings,
    cfg,
    onSaved,
    onFocus,
    t
  })
  const { session, phase, status } = team
  const [input, setInput] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const stick = useRef(true)

  useEffect(() => {
    if (session?.title) onTitle(session.title, session.id)
    else if (session) onTitle(null, session.id)
  }, [session?.id, session?.title])

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [session])

  useEffect(() => {
    if (focused && visible) requestAnimationFrame(() => inputRef.current?.focus())
  }, [focused, visible])

  if (!session) return <div className="team pane" style={{ display: visible ? 'flex' : 'none' }} />

  const msgs = session.messages
  const pendingGate = phase === 'gate' ? [...msgs].reverse().find((m) => m.role === 'gate' && m.status === 'pending') : null
  // Stage progress: the most recent step seen in this run.
  const runStart = msgs.map((m) => m.role).lastIndexOf('user')
  const seen = new Set(msgs.slice(runStart).map((m) => m.stepId).filter(Boolean))
  const activeStep = [...msgs.slice(runStart)].reverse().find((m) => m.stepId)?.stepId
  const finished = msgs.slice(runStart).some((m) => m.final)
  const steps = buildSteps(cfg)

  const decide = (action, feedback = '', apply = false) => team.decide(action, feedback, apply)

  const submit = () => {
    const text = input.trim()
    if (phase === 'gate') {
      if (!pendingGate) return
      setInput('')
      decide('return', text)
      return
    }
    if (!text || phase !== 'idle') return
    setInput('')
    stick.current = true
    team.start(text)
  }

  const agentName = (id) => agents[id]?.name || id

  return (
    <div className={'team pane' + (focused ? ' focused' : '')} style={{ display: visible ? 'flex' : 'none' }} onMouseDown={onFocus}>
      <div className="toolbar">
        <span className="tb-title ellipsis">
          <strong>👥 {t('teamChat')}</strong> <span className="muted">· {session.project}</span>
        </span>
        {session.worktree && (
          <span className="chip wt" title={session.worktree.path}>
            ⑂ {session.worktree.branch}
          </span>
        )}
        <button className="btn small" disabled={phase !== 'idle'} onClick={() => setShowConfig((v) => !v)}>
          ⚙ {t('teamSetup')}
        </button>
        <button className="btn small" onClick={() => setShowDiff(true)}>
          ± Diff
        </button>
        <button className="btn small" disabled={!msgs.length} onClick={() => window.api.sessions.export(session.id)}>
          ⤓ {t('export')}
        </button>
      </div>

      <div className="stages">
        {STAGES.filter(([id]) => id !== 'check' || cfg.testCommand).map(([id, kind]) => {
          const step = steps.find((s) => s.id === id)
          const agent = step?.role ? agents[cfg.roles[step.role]] : null
          const state = finished && runStart >= 0 ? 'done' : id === activeStep && phase !== 'idle' ? 'active' : seen.has(id) ? 'done' : ''
          return (
            <div key={id} className={'stage-pill ' + kind + ' ' + state} style={{ '--agent': agent?.color }} title={agent?.name}>
              {kind === 'gate' ? '✋' : kind === 'check' ? '🧪' : <span className="tab-color" />}
              <span>{kind === 'gate' ? t('gate_' + id) : kind === 'check' ? t('tests') : t('role_' + step.role)}</span>
            </div>
          )
        })}
      </div>

      {showConfig && <Config cfg={cfg} setCfg={setCfg} agents={agents} t={t} onClose={() => setShowConfig(false)} />}

      <div
        className="messages"
        ref={listRef}
        onClick={onLinkClick}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {msgs.length === 0 && (
          <div className="chat-empty muted team-empty">
            <div className="chat-empty-title">👥 {t('teamChat')}</div>
            <p>{t('teamEmpty')}</p>
            <div className="team-lineup">
              {ROLE_KEYS.map((r) => (
                <span key={r} className="chip" style={{ color: agents[cfg.roles[r]]?.color }}>
                  {t('role_' + r)}: {agentName(cfg.roles[r])}
                </span>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => {
          if (m.role === 'user')
            return (
              <div key={m.id} className="msg user">
                <div className="bubble">{m.text}</div>
              </div>
            )
          if (m.role === 'gate')
            return (
              <div key={m.id} className="msg">
                <GateCard m={m} pending={m.status === 'pending' && phase === 'gate'} worktree={session.worktree} cwd={session.cwd} onDecide={decide} t={t} />
              </div>
            )
          if (m.role === 'note') return <div key={m.id} className={'team-note' + (m.final ? ' final' : '')}>{m.text}</div>
          if (m.role === 'check')
            return (
              <div key={m.id} className="msg">
                <details className={'tool check' + (m.ok === false ? ' failed' : '')} open={m.ok === false}>
                  <summary>
                    <span className="tool-name">🧪 {t('tests')}</span>
                    <span className="tool-detail ellipsis">{m.text}</span>
                    {m.running && <span className="spinner" />}
                  </summary>
                  {m.output && <pre>{m.output.slice(-6000)}</pre>}
                </details>
              </div>
            )
          const color = agents[m.agent]?.color
          return (
            <div key={m.id} className="msg assistant team-msg" style={{ '--agent': color }}>
              <div className="team-msg-head">
                <span className="tab-color" />
                <strong>{m.agentName}</strong>
                <span className="muted small">· {m.stepLabel}</span>
                {m.attempt && <span className="chip">{t('attempt')} {m.attempt}</span>}
              </div>
              <Parts m={m} />
              {m.error && <div className="msg-error">⚠ {m.error}</div>}
              {!m.done && (
                <div className="typing">
                  <span className="spinner" /> {status || t('thinking')}
                </div>
              )}
              {m.done && (m.tokens || m.cost) ? (
                <div className="msg-meta muted">
                  {m.tokens ? `${m.tokens.toLocaleString()} tokens` : ''}
                  {m.cost ? ` · $${m.cost.toFixed(4)}` : ''}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          value={input}
          disabled={phase === 'running'}
          placeholder={phase === 'gate' ? t('gatePlaceholder') : phase === 'running' ? t('teamWorking') : t('teamPlaceholder')}
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
          <TemplatesMenu templates={settings.templates || []} onPick={(x) => setInput((v) => v + x)} />
          <span className="muted small grow ellipsis">
            {phase === 'idle'
              ? ROLE_KEYS.map((r) => agentName(cfg.roles[r]).split(' ')[0]).join(' → ')
              : phase === 'gate'
                ? t('gateHint')
                : status}
          </span>
          {phase !== 'idle' ? (
            <>
              {phase === 'gate' && (
                <button className="btn small primary" onClick={() => decide('approve', '', !!pendingGate?.final)}>
                  ✓ {t('approve')}
                </button>
              )}
              <button className="btn small danger" onClick={team.stop}>
                ■ {t('stop')}
              </button>
            </>
          ) : (
            <button className="btn primary small" disabled={!input.trim()} onClick={submit}>
              {t('sendToTeam')} ↵
            </button>
          )}
        </div>
      </div>

      {showDiff && (
        <DiffModal
          title={t('teamChat')}
          dir={session.cwd}
          base={session.worktree?.base}
          worktree={session.worktree}
          onClose={() => setShowDiff(false)}
          onWorktreeRemoved={() => team.setSession((s) => ({ ...s, worktree: null, cwd: s.project }))}
        />
      )}
    </div>
  )
}
