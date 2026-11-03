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

  // Check shortly after start, then every 4 hours.
  setTimeout(check, 5000)
  setInterval(check, 4 * 60 * 60 * 1000)
}
