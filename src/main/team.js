import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getEnv } from './env'

const isWin = process.platform === 'win32'
const checks = new Map()

// Run a project check command (tests, linters) and return exit code + output tail.
export async function runCheck(id, cwd, command) {
  const env = { ...(await getEnv()), CI: '1', FORCE_COLOR: '0', PYTHONDONTWRITEBYTECODE: '1' }
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true })
    checks.set(id, child)
    let out = ''
    const add = (d) => (out = (out + d.toString('utf8')).slice(-30000))
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => stopCheck(id), 15 * 60 * 1000)
    child.on('error', (e) => add('\n' + e.message))
    child.on('close', (code) => {
      clearTimeout(timer)
      checks.delete(id)
      resolve({ code, ok: code === 0, output: out.trim() })
    })
  })
}

export function stopCheck(id) {
  const c = checks.get(id)
  if (!c) return
  if (isWin) execFile('taskkill', ['/pid', String(c.pid), '/T', '/F'], () => {})
  else c.kill('SIGTERM')
}

// Files are handed between steps; paths are relative to the working folder.
const inside = (cwd, rel) => {
  const p = path.resolve(cwd, rel)
  if (!p.startsWith(path.resolve(cwd))) throw new Error('Path outside the project: ' + rel)
  return p
}

export function readFile(cwd, rel) {
  const p = inside(cwd, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

export function writeFile(cwd, rel, text) {
  const p = inside(cwd, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text, 'utf8')
  return true
}
