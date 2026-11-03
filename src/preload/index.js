const { contextBridge, ipcRenderer } = require('electron')

const on = (channel) => (cb) => {
  const h = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('api', {
  term: {
    create: (opts) => ipcRenderer.invoke('term:create', opts),
    write: (id, data) => ipcRenderer.send('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('term:kill', id),
    onData: on('term:data'),
    onExit: on('term:exit')
  },
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    detect: () => ipcRenderer.invoke('agents:detect')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    setKey: (agentId, value) => ipcRenderer.invoke('settings:setKey', agentId, value),
    checkKey: (agentId, typed) => ipcRenderer.invoke('settings:checkKey', agentId, typed)
  },
  projects: {
    pick: () => ipcRenderer.invoke('projects:pick'),
    open: (dir) => ipcRenderer.invoke('projects:open', dir),
    remove: (dir) => ipcRenderer.invoke('projects:remove', dir),
    reveal: (dir) => ipcRenderer.invoke('projects:reveal', dir)
  },
  app: { info: () => ipcRenderer.invoke('app:info') },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: on('update:state')
  }
})
