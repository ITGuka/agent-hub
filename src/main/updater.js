import { app, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

// Update state pushed to the renderer:
// idle | checking | available | downloading | ready | latest | error | dev
let state = { status: 'idle' }

export function initUpdater(sendToWindow) {
  const send = (patch) => {
    state = { ...state, ...patch }
    sendToWindow('update:state', state)
  }

  ipcMain.handle('update:state', () => state)
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate().catch(() => {}))
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(false, true))

  if (!app.isPackaged) {
    state = { status: 'dev' }
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (info) => send({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ status: 'latest' }))
  autoUpdater.on('download-progress', (p) => send({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => send({ status: 'error', error: String(err?.message || err).split('\n')[0] }))

  function check() {
    return autoUpdater.checkForUpdates().catch(() => {})
  }

  // Check shortly after start, every 30 minutes, and when the window regains
  // focus (at most every 10 minutes), so a new release shows up on its own.
  let last = 0
  const maybeCheck = () => {
    if (Date.now() - last < 10 * 60 * 1000) return
    if (['downloading', 'ready', 'checking'].includes(state.status)) return
    last = Date.now()
    check()
  }
  setTimeout(maybeCheck, 4000)
  setInterval(maybeCheck, 30 * 60 * 1000)
  app.on('browser-window-focus', maybeCheck)
}
