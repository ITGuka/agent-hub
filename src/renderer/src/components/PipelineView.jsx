import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import Messages from '../chat/Messages'
import DiffModal from './DiffModal'
import { useChat, newSession, uid } from '../chat/useChat'
import { notify, messageText } from '../notify'

const MAX_HANDOFF = 20000

// One step of a running pipeline: its own chat session with one agent.
function Step({ index, step, agent, cwd, worktree, groupId, title, settings, onSaved, trigger, stopSignal, onDone }) {
  const t = useT()
  const chat = useChat({
    init: { session: { ...newSession({ agent: step.agent, cwd, worktree, groupId }), title } },
    settings,
    onSaved,
    onFinish: (s) => {
      const last = s.messages[s.messages.length - 1]
      onDone(index, { text: messageText(last), error: last?.error })
    }
  })
  const listRef = useRef(null)
  const handled = useRef(0)

  // The first step's trigger arrives together with mounting, before the session
  // exists, so also re-check once the session is ready.
  useEffect(() => {
    if (trigger && chat.session && trigger.n !== handled.current) {
      handled.current = trigger.n
      chat.send(trigger.prompt)
    }
  }, [trigger?.n, !!chat.session])

  useEffect(() => {
    if (stopSignal) chat.stop()
  }, [stopSignal])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.session])

  const last = chat.session?.messages[chat.session.messages.length - 1]
  const state = chat.running ? 'running' : last?.error ? 'error' : last?.done ? 'done' : 'waiting'

  return (
    <div className={'step ' + state} style={{ '--agent': agent.color }}>
      <div className="step-head">
        <span className="step-n">{index + 1}</span>
        <strong>{agent.name}</strong>
        <span className="muted small ellipsis grow">{step.instruction}</span>
        {state === 'running' && <span className="spinner" />}
        {state === 'done' && <span className="ok-text">✓</span>}
        {state === 'error' && <span className="msg-error-inline">⚠</span>}
        {state === 'waiting' && <span className="muted small">{t('stepWaiting')}</span>}
      </div>
      {chat.session && chat.session.messages.length > 0 && (
        <Messages ref={listRef} session={chat.session} running={chat.running} status={chat.status} />
      )}
    </div>
  )
}

function buildPrompt(step, task, prev) {
  let p = `${step.instruction}\n\n## Task\n${task}`
  if (prev) {
    const out = prev.text.length > MAX_HANDOFF ? prev.text.slice(0, MAX_HANDOFF) + '\n…' : prev.text
    p += `\n\n## Output of the previous step (${prev.agentName})\n${out}`
  }
  return p
}

// Chain of agents: each step gets the task plus the previous step's answer.
export default function PipelineView({ tab, visible, focused, agents, settings, setSettings, onSaved, onFocus, onTitle }) {
  const t = useT()
  const presets = settings.pipelines || []
  const [steps, setSteps] = useState(() => structuredClone(presets[0]?.steps || []))
  const [presetName, setPresetName] = useState(presets[0]?.name || '')
  const [task, setTask] = useState('')
  const [isolate, setIsolate] = useState(false)
  const [gitInfo, setGitInfo] = useState(null)
  const [run, setRun] = useState(null) // { id, steps, task, worktree }
  const [triggers, setTriggers] = useState({})
  const [current, setCurrent] = useState(-1)
  const [stopSignal, setStopSignal] = useState(0)
  const [result, setResult] = useState(null) // 'done' | 'error' | 'stopped'
  const [showDiff, setShowDiff] = useState(false)
  const outputs = useRef([])
  const [error, setError] = useState(null)

  useEffect(() => {
    window.api.git.info(tab.cwd).then(setGitInfo)
  }, [tab.cwd])
  const canIsolate = gitInfo?.repo && gitInfo?.hasCommit

  const setStep = (i, patch) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i, d) =>
    setSteps((s) => {
      const n = [...s]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })

  const loadPreset = (name) => {
    const p = presets.find((x) => x.name === name)
    if (p) {
      setSteps(structuredClone(p.steps))
      setPresetName(p.name)
    }
  }

  const savePreset = async () => {
    const name = prompt(t('pipelineName'), presetName || 'Pipeline')
    if (!name) return
    const list = [...presets.filter((p) => p.name !== name), { name, steps }]
    setSettings(await window.api.settings.update({ pipelines: list }))
    setPresetName(name)
  }

  const deletePreset = async () => {
    if (!presetName || !confirm(t('confirmDelete'))) return
    const list = presets.filter((p) => p.name !== presetName)
    setSettings(await window.api.settings.update({ pipelines: list }))
    setPresetName(list[0]?.name || '')
    if (list[0]) setSteps(structuredClone(list[0].steps))
  }

  const start = async () => {
    const text = task.trim()
    if (!text || !steps.length) return
    setError(null)
    let worktree = null
    if (isolate && canIsolate) {
      try {
        worktree = await window.api.git.createWorktree(tab.cwd, 'pipeline')
      } catch (e) {
        return setError(e.message)
      }
    }
    outputs.current = []
    setResult(null)
    setRun({ id: uid(), steps: structuredClone(steps), task: text, worktree })
    setCurrent(0)
    setTriggers({ 0: { n: 1, prompt: buildPrompt(steps[0], text, null) } })
    onTitle(text.split('\n')[0].slice(0, 50))
  }

  const onDone = (i, out) => {
    if (!run || i !== current) return
    outputs.current[i] = out
    if (out.error) {
      setResult('error')
      setCurrent(-1)
      return notify(settings, { title: `⛓ ${t('pipeline')}: ⚠`, body: out.error, onClick: onFocus })
    }
    const next = i + 1
    if (next >= run.steps.length) {
      setResult('done')
      setCurrent(-1)
      return notify(settings, { title: `⛓ ${t('pipeline')}: ✓`, body: out.text, onClick: onFocus })
    }
    const prev = { text: out.text, agentName: agents[run.steps[i].agent]?.name }
    setCurrent(next)
    setTriggers((tr) => ({ ...tr, [next]: { n: 1, prompt: buildPrompt(run.steps[next], run.task, prev) } }))
  }

  const stop = () => {
    setStopSignal((n) => n + 1)
    setResult('stopped')
    setCurrent(-1)
  }

  const agentList = Object.values(agents)

  return (
    <div className={'pipeline pane' + (focused ? ' focused' : '')} style={{ display: visible ? 'flex' : 'none' }} onMouseDown={onFocus}>
      <div className="toolbar">
        <span className="tb-title ellipsis">
          <strong>⛓ {t('pipeline')}</strong> <span className="muted">· {tab.cwd}</span>
        </span>
        {run?.worktree && (
          <span className="chip wt" title={run.worktree.path}>
            ⑂ {run.worktree.branch}
          </span>
        )}
        {run && (
          <button className="btn small" onClick={() => setShowDiff(true)}>
            ± Diff
          </button>
        )}
        {run && current < 0 && (
          <button className="btn small" onClick={() => setRun(null)}>
            ✎ {t('newRun')}
          </button>
        )}
      </div>

      {!run ? (
        <div className="pipeline-setup">
          <div className="row">
            <select value={presetName} onChange={(e) => loadPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
              {!presets.some((p) => p.name === presetName) && <option value={presetName}>{presetName || '—'}</option>}
            </select>
            <button className="btn small" onClick={savePreset}>
              💾 {t('savePreset')}
            </button>
            <button className="btn small" disabled={!presets.some((p) => p.name === presetName)} onClick={deletePreset}>
              🗑
            </button>
          </div>

          {steps.map((st, i) => (
            <div key={i} className="step-edit" style={{ '--agent': agents[st.agent]?.color }}>
              <div className="row">
                <span className="step-n">{i + 1}</span>
                <select value={st.agent} onChange={(e) => setStep(i, { agent: e.target.value })}>
                  {agentList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <span className="grow" />
                <button className="x" disabled={i === 0} onClick={() => move(i, -1)} title="↑">
                  ↑
                </button>
                <button className="x" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title="↓">
                  ↓
                </button>
                <button className="x" onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} title={t('remove')}>
                  ×
                </button>
              </div>
              <textarea rows={2} value={st.instruction} placeholder={t('stepInstruction')} onChange={(e) => setStep(i, { instruction: e.target.value })} />
            </div>
          ))}
          <button className="btn small" onClick={() => setSteps((s) => [...s, { agent: 'claude', instruction: '' }])}>
            + {t('addStep')}
          </button>

          <h3>{t('task')}</h3>
          <textarea rows={4} value={task} placeholder={t('pipelineTask')} onChange={(e) => setTask(e.target.value)} />
          <label className={'check' + (canIsolate ? '' : ' off')}>
            <input type="checkbox" disabled={!canIsolate} checked={isolate && !!canIsolate} onChange={(e) => setIsolate(e.target.checked)} />
            {t('pipelineIsolate')}
          </label>
          <p className="muted small">{t('pipelineHint')}</p>
          {error && <p className="msg-error">{error}</p>}
          <button className="btn primary" disabled={!task.trim() || !steps.length || steps.some((s) => !s.instruction.trim())} onClick={start}>
            ▶ {t('runPipeline')}
          </button>
        </div>
      ) : (
        <>
          <div className="steps">
            <div className="msg user pipeline-task">
              <div className="bubble">{run.task}</div>
            </div>
            {run.steps.map((st, i) => (
              <Step
                key={run.id + i}
                index={i}
                step={st}
                agent={agents[st.agent]}
                cwd={tab.cwd}
                worktree={run.worktree}
                groupId={run.id}
                title={`⛓ ${run.task.split('\n')[0].slice(0, 50)} · ${i + 1}/${run.steps.length}`}
                settings={settings}
                onSaved={onSaved}
                trigger={triggers[i]}
                stopSignal={stopSignal}
                onDone={onDone}
              />
            ))}
          </div>
          <div className="pipeline-bar">
            {current >= 0 ? (
              <>
                <span className="spinner" />
                <span className="grow">
                  {t('stepRunning')
                    .replace('{n}', current + 1)
                    .replace('{total}', run.steps.length)}
                </span>
                <button className="btn small danger" onClick={stop}>
                  ■ {t('stop')}
                </button>
              </>
            ) : (
              <span className={result === 'done' ? 'ok-text' : 'muted'}>
                {result === 'done' ? '✓ ' + t('pipelineDone') : result === 'error' ? '⚠ ' + t('pipelineFailed') : t('pipelineStopped')}
              </span>
            )}
          </div>
        </>
      )}

      {showDiff && run && (
        <DiffModal
          title={t('pipeline')}
          dir={run.worktree?.path || tab.cwd}
          base={run.worktree?.base}
          worktree={run.worktree}
          onClose={() => setShowDiff(false)}
          onWorktreeRemoved={() => setRun((r) => ({ ...r, worktree: null }))}
        />
      )}
    </div>
  )
}
