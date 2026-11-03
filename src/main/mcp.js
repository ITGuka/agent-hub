import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getEnv } from './env'

// Unified MCP server definition used by the UI:
//   { name, type: 'stdio' | 'http', command, args: [], env: {}, url }
// Stored per agent at user scope:
//   Claude Code: ~/.claude.json            -> mcpServers
//   Gemini CLI:  ~/.gemini/settings.json   -> mcpServers
//   Codex:       ~/.codex/config.toml      -> via `codex mcp` CLI (TOML)

const isWin = process.platform === 'win32'
const claudeFile = () => path.join(os.homedir(), '.claude.json')
const geminiFile = () => path.join(os.homedir(), '.gemini', 'settings.json')

function readJson(file) {
  if (!fs.existsSync(file)) return {}
  const text = fs.readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    // settings.json may contain // comments; strip them conservatively.
    return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.agenthub-backup')
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function fromJsonEntry(name, e) {
  const url = e.url || e.httpUrl
  if (url) return { name, type: 'http', url }
  return { name, type: 'stdio', command: e.command || '', args: e.args || [], env: e.env || {} }
}

const winQuote = (a) => (a === '' ? '""' : /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)

function codex(args) {
  return new Promise(async (resolve) => {
    const env = await getEnv()
    const cmd = isWin ? ['codex', ...args.map(winQuote)].join(' ') : 'codex'
    execFile(cmd, isWin ? [] : args, { env, shell: isWin, windowsHide: true, timeout: 30000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout), err: String(stderr || err?.message || '').trim() })
    )
  })
}

async function listCodex() {
  const r = await codex(['mcp', 'list', '--json'])
  if (!r.ok) return null
  try {
    const json = JSON.parse(r.out.slice(r.out.indexOf('[')))
    return json.map((s) =>
      s.transport?.type === 'stdio'
        ? { name: s.name, type: 'stdio', command: s.transport.command, args: s.transport.args || [], env: s.transport.env || {} }
        : { name: s.name, type: 'http', url: s.transport?.url }
    )
  } catch {
    return null
  }
}

// Returns { servers: [{...def, agents: {claude, codex, gemini}}], errors: {agent: msg} }
export async function list() {
  const errors = {}
  const per = { claude: [], codex: [], gemini: [] }
  try {
    per.claude = Object.entries(readJson(claudeFile()).mcpServers || {}).map(([n, e]) => fromJsonEntry(n, e))
  } catch (e) {
    errors.claude = e.message
  }
  try {
    per.gemini = Object.entries(readJson(geminiFile()).mcpServers || {}).map(([n, e]) => fromJsonEntry(n, e))
  } catch (e) {
    errors.gemini = e.message
  }
  const c = await listCodex()
  if (c) per.codex = c
  else errors.codex = 'codex mcp list failed'

  const byName = new Map()
  for (const [agent, defs] of Object.entries(per)) {
    for (const d of defs) {
      if (!byName.has(d.name)) byName.set(d.name, { ...d, agents: {} })
      byName.get(d.name).agents[agent] = true
    }
  }
  return { servers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), errors }
}

export async function add(agent, def) {
  if (!/^[\w.-]+$/.test(def.name)) throw new Error('Name may contain only letters, digits, - _ .')
  if (agent === 'claude' || agent === 'gemini') {
    const file = agent === 'claude' ? claudeFile() : geminiFile()
    const data = readJson(file)
    data.mcpServers = data.mcpServers || {}
    data.mcpServers[def.name] =
      def.type === 'http'
        ? agent === 'claude'
          ? { type: 'http', url: def.url }
          : { httpUrl: def.url }
        : {
            ...(agent === 'claude' ? { type: 'stdio' } : {}),
            command: def.command,
            args: def.args || [],
            env: def.env || {}
          }
    writeJson(file, data)
    return { ok: true }
  }
  if (agent === 'codex') {
    const args =
      def.type === 'http'
        ? ['mcp', 'add', def.name, '--url', def.url]
        : [
            'mcp',
            'add',
            def.name,
            ...Object.entries(def.env || {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
            '--',
            def.command,
            ...(def.args || [])
          ]
    const r = await codex(args)
    if (!r.ok) throw new Error(r.err)
    return { ok: true }
  }
  throw new Error('Unknown agent')
}

export async function remove(agent, name) {
  if (agent === 'claude' || agent === 'gemini') {
    const file = agent === 'claude' ? claudeFile() : geminiFile()
    const data = readJson(file)
    if (data.mcpServers?.[name]) {
      delete data.mcpServers[name]
      writeJson(file, data)
    }
    return { ok: true }
  }
  if (agent === 'codex') {
    const r = await codex(['mcp', 'remove', name])
    if (!r.ok) throw new Error(r.err)
    return { ok: true }
  }
  throw new Error('Unknown agent')
}
