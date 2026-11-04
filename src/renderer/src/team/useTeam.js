import { useEffect, useRef, useState } from 'react'
import { buildSteps, buildPrompt, parseVerdict, outputPath, makeSlug } from './flow'
import { uid } from '../chat/useChat'
import { messageText, notify } from '../notify'

const MAX_DIFF = 60000

// Apply one normalized agent event to an assistant message (same rules as chat).
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
  } else if (ev.kind === 'error') return { ...msg, parts, error: ev.text }
  else if (ev.kind === 'done') return { ...msg, parts, cost: ev.cost ?? msg.cost, tokens: ev.tokens ?? msg.tokens, done: true }
  return { ...msg, parts }
}

export function newTeamSession(project) {
  const now = Date.now()
  return { id: uid(), agent: 'team', type: 'team', cwd: project, project, title: '', createdAt: now, updatedAt: now, messages: [] }
}

// Runs the team flow inside one chat timeline.
export function useTeam({ init, agents, settings, cfg, onSaved, onFocus, t }) {
  const [session, setSession] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | running | gate
  const [status, setStatus] = useState('')
  const sessionRef = useRef(null)
  const runs = useRef(new Map()) // runId -> { msgId, resolve }
  const gateResolve = useRef(null)
  const abort = useRef(false)
  const current = useRef(null) // { runId } | { checkId }
  const agentSessions = useRef({}) // stepId -> agent session id (resume on retries)
  const saveTimer = useRef(null)

  useEffect(() => {
    if (init.sessionId) window.api.sessions.get(init.sessionId).then((s) => setSession(s || init.fallback))
    else setSession(init.session)
  }, [])

  // Keep a ref in sync and save (debounced) on every change.
  useEffect(() => {
    sessionRef.current = session
    if (!session) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.api.sessions.save({ ...session, updatedAt: Date.now() }).then(onSaved), 600)
  }, [session])

  const push = (msg) => {
    const m = { id: uid(), ts: Date.now(), ...msg }
    setSession((s) => ({ ...s, messages: [...s.messages, m] }))
    return m.id
  }
  const patch = (id, fn) => setSession((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }))

  useEffect(
    () =>
      window.api.chat.onEvent((runId, ev) => {
        const r = runs.current.get(runId)
        if (!r) return
        if (ev.kind === 'status') return setStatus(ev.text)
        if (ev.kind === 'session') agentSessions.current[r.stepId] = ev.id
        else if (ev.kind !== 'exit') patch(r.msgId, (m) => applyEvent(m, ev))
        if (ev.kind === 'done' || ev.kind === 'exit') {
          runs.current.delete(runId)
          setStatus('')
          // Let the last state update land before reading the answer.
          setTimeout(() => {
            const m = sessionRef.current.messages.find((x) => x.id === r.msgId)
            patch(r.msgId, (x) => ({ ...x, done: true }))
            r.resolve({ text: messageText(m), error: m?.error })
          }, 50)
        }
      }),
    []
  )

  const roleLabel = (role) => t('role_' + role)

  async function runAgent(step, ctx, extra = {}) {
    const agentId = cfg.roles[step.role]
    const agent = agents[agentId]
    const attempt = (ctx.attempts[step.target || step.id] || 0) + 1
    const msgId = push({
      role: 'assistant',
      agent: agentId,
      agentName: agent?.name,
      stepId: step.id,
      stepLabel: roleLabel(step.role),
      attempt: step.kind === 'agent' && attempt > 1 ? attempt : null,
      parts: []
    })
    const prompt = buildPrompt({ step, steps: ctx.steps, task: ctx.task, slug: ctx.slug, feedback: extra.feedback, diff: extra.diff, agentName: agent?.name })
    const runId = uid()
    current.current = { runId }
    const done = new Promise((resolve) => runs.current.set(runId, { msgId, stepId: step.id, resolve }))
    try {
      await window.api.chat.start({
        runId,
        agent: agentId,
        cwd: ctx.cwd,
        prompt,
        resumeId: agentSessions.current[step.id] || null,
        autoApprove: settings.chatAutoApprove
      })
    } catch (e) {
      runs.current.delete(runId)
      patch(msgId, (m) => ({ ...m, error: e.message, done: true }))
      return { text: '', error: e.message }
    }
    const res = await done
    current.current = null
    // Hand-off by file: if the agent didn't write its output file, save its answer there.
    const out = outputPath(step, ctx.slug)
    if (out && !res.error && res.text) {
      const existing = await window.api.team.readFile(ctx.cwd, out)
      if (existing == null) await window.api.team.writeFile(ctx.cwd, out, res.text + '\n')
    }
    return res
  }

  // Wait for the human at a gate. Resolves { action: 'approve' | 'return' | 'stop', feedback }.
  function waitGate(gate) {
    setPhase('gate')
    const msgId = push({ role: 'gate', ...gate, status: 'pending' })
    notify(settings, { title: '👥 ' + t('teamChat') + ': ✋', body: gate.label, onClick: onFocus })
    return new Promise((resolve) => {
      gateResolve.current = (d) => {
        gateResolve.current = null
        patch(msgId, (m) => ({ ...m, status: d.action, feedback: d.feedback }))
        setPhase('running')
        resolve(d)
      }
    })
  }

  const decide = (action, feedback = '', apply = false) => gateResolve.current?.({ action, feedback, apply })

  async function start(task) {
    if (phase !== 'idle' || !sessionRef.current) return
    abort.current = false
    agentSessions.current = {}
    setPhase('running')
    const s = sessionRef.current
    if (!s.title) setSession((x) => ({ ...x, title: '👥 ' + task.split('\n')[0].slice(0, 60) }))
    push({ role: 'user', text: task })

    let cwd = s.cwd
    let worktree = s.worktree || null
    if (cfg.isolate && !worktree) {
      const info = await window.api.git.info(s.project)
      if (info.repo && info.hasCommit) {
        try {
          worktree = await window.api.git.createWorktree(s.project, 'team')
          cwd = worktree.path
          setSession((x) => ({ ...x, worktree, cwd }))
          push({ role: 'note', text: `⑂ ${t('worktreeCreated')}: ${worktree.branch}` })
        } catch (e) {
          push({ role: 'note', text: '⚠ worktree: ' + e.message })
        }
      }
    }

    const steps = buildSteps(cfg)
    const ctx = { steps, task, slug: makeSlug(task), cwd, attempts: {} }
    const feedback = {}
    const idx = (id) => steps.findIndex((x) => x.id === id)
    let i = 0
    let result = 'done'

    try {
      while (i < steps.length) {
        if (abort.current) throw new Error('stopped')
        const step = steps[i]

        if (step.kind === 'agent') {
          const r = await runAgent(step, ctx, { feedback: feedback[step.id] })
          feedback[step.id] = null
          if (abort.current) throw new Error('stopped')
          if (r.error) {
            const d = await waitGate({ stepId: step.id, label: t('stepFailed').replace('{step}', roleLabel(step.role)), kind: 'error', back: step.id })
            if (d.action === 'stop') throw new Error('stopped')
            if (d.action === 'return') {
              feedback[step.id] = d.feedback
              continue
            }
          }
          i++
        } else if (step.kind === 'check') {
          if (!step.enabled) {
            i++
            continue
          }
          setStatus(cfg.testCommand)
          const checkId = uid()
          current.current = { checkId }
          const msgId = push({ role: 'check', stepId: step.id, text: `▶ ${cfg.testCommand}`, running: true })
          const r = await window.api.team.check(checkId, cwd, cfg.testCommand)
          current.current = null
          setStatus('')
          patch(msgId, (m) => ({ ...m, running: false, ok: r.ok, output: r.output, text: `${r.ok ? '✓' : '✗'} ${cfg.testCommand} (exit ${r.code})` }))
          if (abort.current) throw new Error('stopped')
          if (r.ok) i++
          else {
            const n = (ctx.attempts[step.target] = (ctx.attempts[step.target] || 0) + 1)
            const fb = `The test command \`${cfg.testCommand}\` failed:\n\`\`\`\n${r.output.slice(-8000)}\n\`\`\``
            if (n >= cfg.maxRetries) {
              const d = await waitGate({ stepId: step.id, label: t('retriesExhausted').replace('{n}', n), kind: 'exhausted', back: step.target })
              if (d.action === 'stop') throw new Error('stopped')
              if (d.action === 'approve') {
                i++
                continue
              }
              ctx.attempts[step.target] = 0
              feedback[step.target] = (d.feedback ? d.feedback + '\n\n' : '') + fb
            } else feedback[step.target] = fb
            i = idx(step.target)
          }
        } else if (step.kind === 'review') {
          let diff
          if (step.includeDiff) {
            const d = await window.api.git.diff(cwd, worktree?.base)
            diff = d.ok ? (d.patch.length > MAX_DIFF ? d.patch.slice(0, MAX_DIFF) + '\n… (truncated)' : d.patch) : `(git diff unavailable: ${d.error}. Inspect the changed files directly.)`
          }
          const r = await runAgent(step, ctx, { diff })
          if (abort.current) throw new Error('stopped')
          const verdict = r.error ? null : parseVerdict(r.text)
          const n = ctx.attempts[step.target] || 0
          if (verdict === 'APPROVE') {
            push({ role: 'note', text: `✓ ${roleLabel(step.role)}: ${t('approved')}` })
            i++
          } else if (verdict === 'CHANGES' && n + 1 < cfg.maxRetries) {
            ctx.attempts[step.target] = n + 1
            push({ role: 'note', text: `↺ ${t('changesRequested')} → ${roleLabel(steps[idx(step.target)].role)} (${n + 2}/${cfg.maxRetries})` })
            feedback[step.target] = `The reviewer (${agents[cfg.roles[step.role]]?.name}) requested changes:\n\n${r.text}`
            i = idx(step.target)
          } else {
            const label = r.error
              ? t('stepFailed').replace('{step}', roleLabel(step.role))
              : verdict === 'CHANGES'
                ? t('retriesExhausted').replace('{n}', n + 1)
                : t('verdictUnclear')
            const d = await waitGate({ stepId: step.id, label, kind: 'exhausted', back: step.target })
            if (d.action === 'stop') throw new Error('stopped')
            if (d.action === 'approve') i++
            else {
              ctx.attempts[step.target] = 0
              feedback[step.target] = (d.feedback ? d.feedback + '\n\n' : '') + (r.text ? `Reviewer notes:\n${r.text}` : '')
              i = idx(step.target)
            }
          }
        } else if (step.kind === 'gate') {
          const d = await waitGate({
            stepId: step.id,
            label: t('gate_' + step.id),
            kind: 'gate',
            back: step.back,
            final: !!step.final,
            files: steps
              .slice(0, i)
              .map((x) => outputPath(x, ctx.slug))
              .filter(Boolean)
          })
          if (d.action === 'stop') throw new Error('stopped')
          if (d.action === 'approve') {
            if (step.final && d.apply && worktree) {
              const a = await window.api.git.apply(worktree)
              push({ role: 'note', text: a.ok ? '⇪ ' + t('applied').replace('{n}', a.files) : '⚠ ' + a.error })
            }
            i++
          } else {
            ctx.attempts[step.back] = 0
            feedback[step.back] = `The human reviewer returned this step with feedback:\n${d.feedback || '(no comment)'}`
            i = idx(step.back)
          }
        }
      }
    } catch (e) {
      result = e.message === 'stopped' ? 'stopped' : 'error'
      if (result === 'error') push({ role: 'note', text: '⚠ ' + e.message })
    }

    push({ role: 'note', text: result === 'done' ? '✅ ' + t('teamDone') : '■ ' + t('pipelineStopped'), final: true })
    if (result === 'done') notify(settings, { title: '👥 ' + t('teamChat') + ': ✅', body: task, onClick: onFocus })
    setStatus('')
    setPhase('idle')
  }

  function stop() {
    abort.current = true
    const c = current.current
    if (c?.runId) window.api.chat.stop(c.runId)
    if (c?.checkId) window.api.team.stopCheck(c.checkId)
    gateResolve.current?.({ action: 'stop' })
  }

  return { session, setSession, phase, status, start, decide, stop }
}
