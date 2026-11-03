import { execFile } from 'node:child_process'
import { AGENTS } from './agents'
import { getEnv } from './env'

const isWin = process.platform === 'win32'

function run(cmd, args, env, timeout = 15000) {
  return new Promise((resolve) => {
    // npm global bins on Windows are .cmd shims, so go through the shell.
    execFile(cmd, args, { timeout, shell: isWin, windowsHide: true, env }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || stderr || '').trim() })
    })
  })
}

async function whichPath(command, env) {
  const r = await run(isWin ? 'where' : 'which', [command], env, 5000)
  return r.ok ? r.out.split(/\r?\n/)[0] : null
}

async function version(command, env) {
  const r = await run(command, ['--version'], env)
  if (!r.ok) return null
  const m = r.out.match(/\d+\.\d+\.\d+[\w.-]*/)
  return m ? m[0] : r.out.split(/\r?\n/)[0].slice(0, 40)
}

export async function detectAll() {
  const env = await getEnv(true)
  const [node, npm] = await Promise.all([whichPath('node', env), whichPath('npm', env)])
  const agents = await Promise.all(
    Object.values(AGENTS).map(async (a) => {
      const p = await whichPath(a.command, env)
      return { id: a.id, installed: !!p, path: p, version: p ? await version(a.command, env) : null }
    })
  )
  return {
    node: node ? await version('node', env) : null,
    nodePath: node,
    npm: !!npm,
    agents: Object.fromEntries(agents.map((a) => [a.id, a]))
  }
}
