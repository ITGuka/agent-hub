import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Chat sessions are stored one JSON file per session:
// { id, agent, cwd, title, createdAt, updatedAt, agentSessionId, messages: [...] }
const dir = () => path.join(app.getPath('userData'), 'sessions')
const file = (id) => path.join(dir(), id.replace(/[^\w-]/g, '') + '.json')

function readAll() {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'))
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

const meta = ({ messages, ...m }) => ({ ...m, count: messages?.length || 0 })

export function list() {
  return readAll()
    .map(meta)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function get(id) {
  try {
    return JSON.parse(fs.readFileSync(file(id), 'utf8'))
  } catch {
    return null
  }
}

export function save(session) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(file(session.id), JSON.stringify(session))
  return meta(session)
}

export function remove(id) {
  try {
    fs.unlinkSync(file(id))
  } catch {}
}

export function messageText(m) {
  if (m.role === 'user') return m.text || ''
  return (m.parts || [])
    .map((p) => (p.type === 'text' ? p.text : `${p.name} ${p.detail || ''}`))
    .join('\n')
}

// Case-insensitive search over titles and message text; returns snippets.
export function search(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  const results = []
  for (const s of readAll()) {
    let snippet = null
    if ((s.title || '').toLowerCase().includes(q)) snippet = s.title
    for (const m of s.messages || []) {
      if (snippet) break
      const t = messageText(m)
      const i = t.toLowerCase().indexOf(q)
      if (i >= 0) snippet = (i > 40 ? '…' : '') + t.slice(Math.max(0, i - 40), i + q.length + 60).replace(/\s+/g, ' ')
    }
    if (snippet) results.push({ ...meta(s), snippet })
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
}

export function toMarkdown(s, agentName) {
  const lines = [`# ${s.title}`, '', `- Agent: ${agentName}`, `- Project: ${s.cwd || ''}`, `- Date: ${new Date(s.createdAt).toLocaleString()}`, '']
  for (const m of s.messages || []) {
    if (m.role === 'user') {
      lines.push('## 🧑 User', '', m.text, '')
    } else {
      lines.push(`## 🤖 ${agentName}`, '')
      for (const p of m.parts || []) {
        if (p.type === 'text') lines.push(p.text, '')
        else lines.push(`> **${p.name}** \`${(p.detail || '').split('\n')[0]}\``, '')
      }
      if (m.error) lines.push(`> ⚠️ ${m.error}`, '')
    }
  }
  return lines.join('\n')
}

// Cost / token totals per agent for today, last 7 days, last 30 days and all time.
// Claude reports cost; Codex and Gemini report tokens only.
export function usage() {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ranges = { today: startOfDay, week: Date.now() - 7 * 864e5, month: Date.now() - 30 * 864e5, all: 0 }
  const out = {}
  for (const s of readAll()) {
    for (const m of s.messages || []) {
      if (m.role !== 'assistant' || (!m.cost && !m.tokens)) continue
      const a = (out[s.agent] = out[s.agent] || {})
      for (const [r, from] of Object.entries(ranges)) {
        if ((m.ts || s.updatedAt) < from) continue
        const x = (a[r] = a[r] || { cost: 0, tokens: 0, turns: 0 })
        x.cost += m.cost || 0
        x.tokens += m.tokens || 0
        x.turns += 1
      }
    }
  }
  return out
}
