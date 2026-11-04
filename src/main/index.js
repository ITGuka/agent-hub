import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import * as pty from 'node-pty'
import { AGENTS } from './agents'
import * as store from './store'
import { detectAll } from './detect'
import { getEnv } from './env'
import { initUpdater } from './updater'
import { checkKey } from './keycheck'
import * as chat from './chat'
import * as sessions from './sessions'
import * as git from './git'
import * as mcp from './mcp'
import * as context from './context'
import * as team from './team'

const isWin = process.platform === 'win32'
const terms = new Map() // id -> IPty
let win = null
let nextId = 1

// Send to the renderer only while the window is alive. A pty can still emit
// output after the window is closed (quit, restart-to-update), and sending to a
// destroyed webContents throws "Object has been destroyed".
function send(channel, ...args) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

function killAll() {
  for (const p of terms.values()) {
    try {
      p.kill()
    } catch {}
  }
  terms.clear()
  chat.stopAll()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 520,
    backgroundColor: '#14161a',
    title: 'Agent Hub',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.on('closed', () => {
    killAll()
    win = null
  })
  // Never navigate the app window away (e.g. a link clicked in a chat answer).
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function splitArgs(s) {
  return (s || '').match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? []
}

// Build the command line for a tab. kind: agent id | 'shell' | 'install:<agentId>'
function commandFor(kind) {
  if (kind === 'shell') return null
  if (kind === 'install:node') {
    // Node.js LTS via winget (Windows) or Homebrew (macOS).
    if (isWin)
      return {
        cmd: 'winget',
        args: ['install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements', '--accept-package-agreements']
      }
    return { cmd: 'brew', args: ['install', 'node'] }
  }
  if (kind.startsWith('install:')) {
    // One or more agents, e.g. install:claude or install:claude+codex
    const pkgs = kind
      .slice(8)
      .split('+')
      .map((id) => AGENTS[id])
      .filter(Boolean)
      .map((a) => `${a.npmPackage}@latest`)
    if (!pkgs.length) throw new Error('Unknown agent: ' + kind)
    return { cmd: 'npm', args: ['install', '-g', ...pkgs] }
  }
  const a = AGENTS[kind]
  if (!a) throw new Error('Unknown agent: ' + kind)
  return { cmd: a.command, args: splitArgs(store.load().agentArgs[kind]) }
}

async function hasNpm(env) {
  return new Promise((r) =>
    execFile(isWin ? 'where' : 'which', ['npm'], { env, shell: isWin, windowsHide: true }, (err) => r(!err))
  )
}

async function spawnTerm({ kind, cwd, cols, rows }) {
  const env = { ...(await getEnv()), FORCE_COLOR: '1', COLORTERM: 'truecolor' }
  for (const a of Object.values(AGENTS)) {
    const key = store.getSecret(a.id)
    if (key) env[a.keyEnv] = key
  }
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const c = commandFor(kind)
  if (c && kind.startsWith('install:') && kind !== 'install:node' && !(await hasNpm(env)))
    throw new Error('npm not found. Install Node.js 20+ from https://nodejs.org, then press "Check again" in Settings.')
  let file, args
  if (isWin) {
    file = process.env.COMSPEC || 'cmd.exe'
    args = c ? ['/d', '/s', '/c', [c.cmd, ...c.args].join(' ')] : []
    if (!c) {
      // Process-scoped Bypass so npm's .ps1 shims (gemini.ps1, npm.ps1, ...) run
      // even when the machine's execution policy is Restricted. Does not change
      // the system policy.
      file = 'powershell.exe'
      args = ['-NoLogo', '-ExecutionPolicy', 'Bypass']
    }
  } else {
    file = process.env.SHELL || '/bin/bash'
    const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`
    args = c ? ['-lc', [c.cmd, ...c.args].map(quote).join(' ')] : ['-l']
  }
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: workdir,
    env,
    useConpty: true
  })
  const id = nextId++
  terms.set(id, p)
  p.onData((data) => send('term:data', id, data))
  p.onExit(({ exitCode }) => {
    terms.delete(id)
    send('term:exit', id, exitCode)
  })
  return { id, cwd: workdir }
}

ipcMain.handle('term:create', (_e, opts) => spawnTerm(opts))
ipcMain.on('term:write', (_e, id, data) => terms.get(id)?.write(data))
ipcMain.on('term:resize', (_e, id, cols, rows) => {
  try {
    terms.get(id)?.resize(Math.max(cols, 2), Math.max(rows, 2))
  } catch {}
})
ipcMain.on('term:kill', (_e, id) => {
  try {
    terms.get(id)?.kill()
  } catch {}
  terms.delete(id)
})

ipcMain.handle('agents:list', () => AGENTS)
ipcMain.handle('agents:detect', () => detectAll())

ipcMain.handle('settings:get', () => store.publicSettings())
ipcMain.handle('settings:update', (_e, patch) => store.update(patch))
ipcMain.handle('settings:setKey', (_e, agentId, value) => store.setSecret(agentId, value))
ipcMain.handle('settings:checkKey', (_e, agentId, typed) => checkKey(agentId, typed))

ipcMain.handle('projects:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return { dir: r.filePaths[0], recent: store.addRecentProject(r.filePaths[0]) }
})
ipcMain.handle('projects:open', (_e, dir) =>
  fs.existsSync(dir) ? { dir, recent: store.addRecentProject(dir) } : null
)
ipcMain.handle('projects:remove', (_e, dir) => store.removeRecentProject(dir))
ipcMain.handle('projects:reveal', (_e, dir) => shell.openPath(dir))
ipcMain.handle('chat:start', (_e, opts) => chat.startRun(send, opts))
ipcMain.handle('chat:stop', (_e, runId) => chat.stopRun(runId))

ipcMain.handle('sessions:list', () => sessions.list())
ipcMain.handle('sessions:get', (_e, id) => sessions.get(id))
ipcMain.handle('sessions:save', (_e, s) => sessions.save(s))
ipcMain.handle('sessions:remove', (_e, id) => sessions.remove(id))
ipcMain.handle('sessions:search', (_e, q) => sessions.search(q))
ipcMain.handle('sessions:export', async (_e, id) => {
  const s = sessions.get(id)
  if (!s) return false
  return saveText(s.title, sessions.toMarkdown(s, AGENTS[s.agent]?.name || s.agent))
})
ipcMain.handle('git:info', (_e, dir) => git.info(dir))
ipcMain.handle('git:createWorktree', (_e, project, agent) => git.createWorktree(project, agent))
ipcMain.handle('git:diff', (_e, dir, base) => git.diff(dir, base))
ipcMain.handle('git:apply', (_e, wt) => git.applyToProject(wt))
ipcMain.handle('git:removeWorktree', (_e, wt) => git.removeWorktree(wt))
ipcMain.handle('team:check', (_e, id, cwd, command) => team.runCheck(id, cwd, command))
ipcMain.handle('team:stopCheck', (_e, id) => team.stopCheck(id))
ipcMain.handle('team:readFile', (_e, cwd, rel) => team.readFile(cwd, rel))
ipcMain.handle('team:writeFile', (_e, cwd, rel, text) => team.writeFile(cwd, rel, text))
ipcMain.handle('usage:get', () => sessions.usage())
ipcMain.handle('mcp:list', () => mcp.list())
ipcMain.handle('mcp:add', (_e, agent, def) => mcp.add(agent, def))
ipcMain.handle('mcp:remove', (_e, agent, name) => mcp.remove(agent, name))
ipcMain.handle('context:read', (_e, project) => context.read(project))
ipcMain.handle('context:write', (_e, project, text, agents) => context.write(project, text, agents))
ipcMain.handle('app:focus', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})
ipcMain.handle('app:attention', () => {
  if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
})
ipcMain.handle('file:saveText', (_e, name, text) => saveText(name, text))

async function saveText(name, text) {
  const safe = (name || 'export').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'export'
  const r = await dialog.showSaveDialog(win, {
    defaultPath: safe + '.md',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] }
    ]
  })
  if (r.canceled || !r.filePath) return false
  fs.writeFileSync(r.filePath, text, 'utf8')
  return true
}

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))

// Needed on Windows for notifications to show the app's name and icon.
if (process.platform === 'win32') app.setAppUserModelId('com.itguka.agenthub')

app.whenReady().then(() => {
  initUpdater(send)
  createWindow()
})
app.on('before-quit', killAll)
app.on('window-all-closed', () => {
  killAll()
  app.quit()
})
