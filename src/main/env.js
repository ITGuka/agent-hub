import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const isWin = process.platform === 'win32'
let cached = null

function exec(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true, ...opts }, (err, stdout) =>
      resolve(err ? '' : String(stdout))
    )
  })
}

function expand(str, env) {
  return str.replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? env[key] : m
  })
}

// Read the *current* PATH from the registry. The process PATH can be stale (e.g. Node
// was installed after Explorer started) or incomplete when launched from a shortcut.
async function registryPath(key) {
  const out = await exec('reg.exe', ['query', key, '/v', 'Path'])
  const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i)
  return m ? m[1].trim() : ''
}

// Common per-user install locations for node, npm and the agent CLIs.
function knownWindowsDirs(env) {
  const home = os.homedir()
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const pf = env.ProgramFiles || 'C:\\Program Files'
  return [
    path.join(appData, 'npm'), // npm -g bins
    path.join(home, '.local', 'bin'), // Claude Code native installer
    path.join(pf, 'nodejs'),
    path.join(local, 'Programs', 'nodejs'),
    env.NVM_SYMLINK, // nvm-windows
    path.join(pf, 'Volta'),
    path.join(local, 'Volta', 'bin'),
    path.join(home, 'scoop', 'shims'),
    path.join(local, 'Microsoft', 'WinGet', 'Links'),
    path.join(local, 'pnpm'),
    path.join(home, '.bun', 'bin')
  ].filter(Boolean)
}

async function computeEnv() {
  const env = { ...process.env }
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
  const sep = isWin ? ';' : ':'
  let parts = []
  if (isWin) {
    const [machine, user] = await Promise.all([
      registryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
      registryPath('HKCU\\Environment')
    ])
    parts = [...expand(machine, env).split(sep), ...expand(user, env).split(sep)]
    parts.push(...knownWindowsDirs(env))
  } else {
    const shell = env.SHELL || '/bin/bash'
    const out = await exec(shell, ['-ilc', 'echo "__PATH__$PATH"'])
    const m = out.match(/__PATH__(.*)/)
    if (m) parts = m[1].trim().split(sep)
    parts.push(path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin')
  }
  parts.push(...(env[pathKey] || '').split(sep))
  const seen = new Set()
  const merged = parts
    .map((p) => p.trim())
    .filter((p) => {
      const k = isWin ? p.toLowerCase() : p
      if (!p || seen.has(k)) return false
      seen.add(k)
      return fs.existsSync(p)
    })
  if (isWin) for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k]
  env[isWin ? 'Path' : 'PATH'] = merged.join(sep)
  return env
}

export function getEnv(refresh = false) {
  if (refresh || !cached) cached = computeEnv()
  return cached
}
