import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULTS = {
  language: 'ka',
  recentProjects: [],
  agentArgs: { claude: '', codex: '', gemini: '' },
  secrets: {} // agentId -> encrypted base64 API key
}

const file = () => path.join(app.getPath('userData'), 'settings.json')
let cache = null

export function load() {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    cache = { ...DEFAULTS, ...raw, agentArgs: { ...DEFAULTS.agentArgs, ...raw.agentArgs } }
  } catch {
    cache = structuredClone(DEFAULTS)
  }
  return cache
}

function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2))
}

// Settings as the renderer sees them: secrets reduced to "is it set".
export function publicSettings() {
  const s = load()
  const { secrets, ...rest } = s
  return { ...rest, keysSet: Object.fromEntries(Object.keys(secrets).map((k) => [k, true])) }
}

export function update(patch) {
  const s = load()
  for (const key of ['language', 'agentArgs']) if (key in patch) s[key] = patch[key]
  save()
  return publicSettings()
}

export function addRecentProject(dir) {
  const s = load()
  s.recentProjects = [dir, ...s.recentProjects.filter((p) => p !== dir)].slice(0, 12)
  save()
  return s.recentProjects
}

export function removeRecentProject(dir) {
  const s = load()
  s.recentProjects = s.recentProjects.filter((p) => p !== dir)
  save()
  return s.recentProjects
}

// API keys are encrypted with the OS keychain (DPAPI on Windows) via safeStorage.
export function setSecret(agentId, value) {
  const s = load()
  value = (value || '').trim()
  if (!value) delete s.secrets[agentId]
  else if (safeStorage.isEncryptionAvailable())
    s.secrets[agentId] = 'enc:' + safeStorage.encryptString(value).toString('base64')
  else s.secrets[agentId] = 'raw:' + Buffer.from(value).toString('base64')
  save()
  return publicSettings()
}

export function getSecret(agentId) {
  const v = load().secrets[agentId]
  if (!v) return null
  try {
    const buf = Buffer.from(v.slice(4), 'base64')
    return v.startsWith('enc:') ? safeStorage.decryptString(buf) : buf.toString()
  } catch {
    return null
  }
}
