import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { AGENTS } from './agents'
import * as store from './store'
import { getEnv } from './env'

const isWin = process.platform === 'win32'
const runs = new Map() // runId -> ChildProcess
const stopped = new Set()

// Agent errors often wrap JSON inside JSON (e.g. Gemini API errors). Pull out the
// innermost human-readable message and HTTP code.
export function cleanError(text) {
  const s = String(text || '')
  const msgs = [...s.matchAll(/message\\*"\s*:\s*\\*"([^"\\]{6,})/g)].map((m) => m[1].trim())
  if (!msgs.length) return s.trim()
  const code = s.match(/code\\*"\s*:\s*(\d{3})/)?.[1]
  return (code ? code + ': ' : '') + msgs[msgs.length - 1]
}

function splitArgs(s) {
  return (s || '').match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? []
}

// cmd.exe quoting for the few args we pass (ids, flags, user extra args).
// The prompt itself always goes through stdin, so it never needs escaping.
function winQuote(a) {
  if (a === '') return '""'
  return /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a
}

// Build the headless command for one turn. The prompt is written to stdin.
function buildArgs(agent, { resumeId, autoApprove }) {
  const extra = splitArgs(store.load().agentArgs[agent])
  if (agent === 'claude') {
    return [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      ...(autoApprove ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits']),
      ...(resumeId ? ['--resume', resumeId] : []),
      ...extra
    ]
  }
  if (agent === 'codex') {
    const common = [
      '--json',
      '--skip-git-repo-check',
      ...(autoApprove ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-c', 'sandbox_mode=workspace-write']),
      ...extra
    ]
    return resumeId ? ['exec', 'resume', resumeId, ...common, '-'] : ['exec', ...common, '-']
  }
  if (agent === 'gemini') {
    return [
      '--output-format', 'stream-json',
      ...(autoApprove ? ['--yolo'] : ['--approval-mode', 'auto_edit']),
      ...(resumeId ? ['--resume', resumeId] : []),
      ...extra,
      '-p', ''
    ]
  }
  throw new Error('Unknown agent: ' + agent)
}

// ---- Parsers: turn each agent's JSON lines into common events ----
//   { kind: 'session', id }            agent's own session id (for resume)
//   { kind: 'text', text, delta }      assistant text (delta = append to last text)
//   { kind: 'tool', id, name, detail } a tool call started
//   { kind: 'toolResult', id, ok, output }
//   { kind: 'status', text }           transient status (reconnecting, etc.)
//   { kind: 'error', text }
//   { kind: 'done', cost, tokens }

const short = (v, n = 4000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s && s.length > n ? s.slice(0, n) + '\n…' : s || ''
}

function toolDetail(name, input) {
  if (!input || typeof input !== 'object') return short(input, 300)
  const key = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'].find(
    (k) => typeof input[k] === 'string'
  )
  return key ? input[key] : short(input, 300)
}

function parseClaude(e) {
  const out = []
  if (e.type === 'system' && e.subtype === 'init') out.push({ kind: 'session', id: e.session_id })
  else if (e.type === 'assistant') {
    for (const c of e.message?.content || []) {
      if (c.type === 'text' && c.text) out.push({ kind: 'text', text: c.text })
      else if (c.type === 'tool_use') out.push({ kind: 'tool', id: c.id, name: c.name, detail: toolDetail(c.name, c.input) })
    }
  } else if (e.type === 'user') {
    for (const c of e.message?.content || []) {
      if (c.type === 'tool_result') {
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('\n') : c.content
        out.push({ kind: 'toolResult', id: c.tool_use_id, ok: !c.is_error, output: short(text) })
      }
    }
  } else if (e.type === 'result') {
    if (e.is_error) out.push({ kind: 'error', text: e.result || e.subtype })
    const u = e.usage || {}
    out.push({
      kind: 'done',
      cost: e.total_cost_usd,
      tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    })
  }
  return out
}

function parseCodex(e) {
  const out = []
  if (e.type === 'thread.started') out.push({ kind: 'session', id: e.thread_id })
  else if (e.type === 'error') out.push({ kind: 'status', text: e.message })
  else if (e.type === 'turn.failed') out.push({ kind: 'error', text: e.error?.message || 'Turn failed' })
  else if (e.type === 'turn.completed') {
    const u = e.usage || {}
    out.push({ kind: 'done', tokens: (u.input_tokens || 0) + (u.output_tokens || 0) })
  } else if (e.type === 'item.started' || e.type === 'item.completed') {
    const it = e.item || {}
    const done = e.type === 'item.completed'
    if (it.type === 'agent_message' && done) out.push({ kind: 'text', text: it.text })
    else if (it.type === 'command_execution') {
      if (!done) out.push({ kind: 'tool', id: it.id, name: 'shell', detail: it.command })
      else {
        out.push({ kind: 'tool', id: it.id, name: 'shell', detail: it.command })
        out.push({ kind: 'toolResult', id: it.id, ok: it.exit_code === 0 || it.exit_code == null, output: short(it.aggregated_output) })
      }
    } else if (it.type === 'file_change' && done)
      out.push({ kind: 'tool', id: it.id, name: 'edit', detail: (it.changes || []).map((c) => `${c.kind} ${c.path}`).join('\n') })
    else if (it.type === 'mcp_tool_call' && done) out.push({ kind: 'tool', id: it.id, name: `${it.server}.${it.tool}`, detail: '' })
    else if (it.type === 'web_search' && done) out.push({ kind: 'tool', id: it.id, name: 'web_search', detail: it.query })
    else if (it.type === 'error' && done) out.push({ kind: 'status', text: it.message })
  }
  return out
}

function parseGemini(e) {
  const out = []
  if (e.type === 'init') out.push({ kind: 'session', id: e.session_id })
  else if (e.type === 'message' && e.role === 'assistant') out.push({ kind: 'text', text: e.content, delta: !!e.delta })
  else if (e.type === 'tool_use') out.push({ kind: 'tool', id: e.tool_id, name: e.tool_name, detail: toolDetail(e.tool_name, e.parameters) })
  else if (e.type === 'tool_result')
    out.push({ kind: 'toolResult', id: e.tool_id, ok: e.status !== 'error', output: short(e.output || e.error?.message) })
  else if (e.type === 'error') out.push({ kind: 'status', text: e.message })
  else if (e.type === 'result') {
    if (e.status === 'error') out.push({ kind: 'error', text: e.error?.message || 'Error' })
    out.push({ kind: 'done', tokens: e.stats?.total_tokens })
  }
  return out
}

const PARSERS = { claude: parseClaude, codex: parseCodex, gemini: parseGemini }
const tidy = (ev) => (ev.kind === 'error' || ev.kind === 'status' ? { ...ev, text: cleanError(ev.text) } : ev)

export async function startRun(send, { runId, agent, cwd, prompt, resumeId, autoApprove }) {
  if (!AGENTS[agent]) throw new Error('Unknown agent: ' + agent)
  const env = { ...(await getEnv()), NO_COLOR: '1', GEMINI_CLI_TRUST_WORKSPACE: 'true' }
  for (const a of Object.values(AGENTS)) {
    const key = store.getSecret(a.id)
    if (key) env[a.keyEnv] = key
  }
  const args = buildArgs(agent, { resumeId, autoApprove })
  const cmd = AGENTS[agent].command
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const child = isWin
    ? spawn([cmd, ...args.map(winQuote)].join(' '), { cwd: workdir, env, shell: true, windowsHide: true })
    : spawn(cmd, args, { cwd: workdir, env })
  runs.set(runId, child)

  const parse = PARSERS[agent]
  const emit = (ev) => send('chat:event', runId, ev)
  let buf = ''
  let sawDone = false
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let e
      try {
        e = JSON.parse(line)
      } catch {
        continue // non-JSON noise (warnings, logs)
      }
      for (const ev of parse(e)) {
        if (ev.kind === 'done') sawDone = true
        emit(tidy(ev))
      }
    }
  })
  child.stderr.on('data', (d) => {
    stderr = (stderr + d.toString('utf8')).slice(-4000)
  })
  child.on('error', (err) => emit({ kind: 'error', text: err.message }))
  let ended = false
  const end = (code) => {
    if (ended) return
    ended = true
    runs.delete(runId)
    const wasStopped = stopped.delete(runId)
    if (!sawDone) {
      if (code !== 0 && !wasStopped) emit({ kind: 'error', text: stderr.trim().split('\n').slice(-8).join('\n') || `exit code ${code}` })
      emit({ kind: 'done' })
    }
    emit({ kind: 'exit', code })
  }
  child.on('close', end)
  // Some CLIs leave helper processes holding stdout open; don't wait on them.
  child.on('exit', (code) => setTimeout(() => end(code), 1500))

  child.stdin.on('error', () => {})
  child.stdin.end(prompt)
  return { ok: true }
}

export function stopRun(runId) {
  const child = runs.get(runId)
  if (!child) return
  stopped.add(runId)
  if (isWin) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
  else child.kill('SIGTERM')
}

export function stopAll() {
  for (const id of runs.keys()) stopRun(id)
}
