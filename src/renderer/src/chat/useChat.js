import { useEffect, useRef, useState } from 'react'

export const uid = () => crypto.randomUUID()

export function newSession({ agent, cwd, worktree = null, groupId = null }) {
  const now = Date.now()
  return {
    id: uid(),
    agent,
    cwd: worktree?.path || cwd,
    project: cwd,
    worktree,
    groupId,
    title: '',
    createdAt: now,
    updatedAt: now,
    agentSessionId: null,
    messages: []
  }
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

// One chat session with one agent: loading, sending, streaming events, saving.
// `init` is { sessionId } for an existing session or { session } for a new one.
export function useChat({ init, settings, onSaved }) {
  const [session, setSession] = useState(null)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const runRef = useRef(null)

  useEffect(() => {
    if (init.sessionId) window.api.sessions.get(init.sessionId).then((s) => setSession(s || init.fallback))
    else setSession(init.session)
  }, [])

  const persist = (s) => window.api.sessions.save(s).then(() => onSaved?.())

  // End of a turn: on the agent's final result event or when the process exits.
  const finish = () => {
    if (!runRef.current) return
    runRef.current = null
    setRunning(false)
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

  const send = async (text, base = session) => {
    if (!text || runRef.current || !base) return
    const id = uid()
    const s = {
      ...base,
      title: base.title || text.split('\n')[0].slice(0, 70),
      updatedAt: Date.now(),
      messages: [...base.messages, { role: 'user', text, ts: Date.now() }, { role: 'assistant', parts: [], ts: Date.now() }]
    }
    setSession(s)
    runRef.current = id
    setRunning(true)
    setStatus('')
    persist(s)
    try {
      await window.api.chat.start({
        runId: id,
        agent: s.agent,
        cwd: s.cwd,
        prompt: text,
        resumeId: s.agentSessionId,
        autoApprove: settings.chatAutoApprove,
        extraDirs: s.extraDirs || []
      })
    } catch (err) {
      setSession((cur) => {
        const msgs = [...cur.messages]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], error: err.message, done: true }
        return { ...cur, messages: msgs }
      })
      runRef.current = null
      setRunning(false)
    }
  }

  const stop = () => runRef.current && window.api.chat.stop(runRef.current)

  const addDirs = (dirs) => {
    if (dirs.length)
      setSession((cur) => ({ ...cur, extraDirs: [...new Set([...(cur.extraDirs || []), ...dirs])] }))
  }

  const update = (patch) =>
    setSession((cur) => {
      const next = { ...cur, ...patch }
      persist(next)
      return next
    })

  return { session, running, status, send, stop, addDirs, update }
}

// Paths of dropped files, and the folders outside `cwd` the agent needs access to.
export function droppedFiles(e, cwd) {
  const paths = [...e.dataTransfer.files].map((f) => window.api.files.pathFor(f)).filter(Boolean)
  const parent = (p) => {
    const d = p.replace(/[\\/][^\\/]*$/, '')
    return /^[A-Za-z]:$/.test(d) ? d + '\\' : d || '/'
  }
  const dirs = paths.map(parent).filter((d) => !cwd || !d.toLowerCase().startsWith(cwd.toLowerCase()))
  return { paths, dirs }
}

// Claude Code and Gemini CLI understand @path references; Codex gets plain paths.
export function fileRefs(agent, paths) {
  const q = (p) => (/\s/.test(p) ? `"${p}"` : p)
  return paths.map((p) => (agent === 'codex' ? q(p) : '@' + q(p))).join(' ') + ' '
}
