const { contextBridge, ipcRenderer, webUtils } = require('electron')

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
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    focus: () => ipcRenderer.invoke('app:focus'),
    attention: () => ipcRenderer.invoke('app:attention')
  },
  usage: { get: () => ipcRenderer.invoke('usage:get') },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    add: (agent, def) => ipcRenderer.invoke('mcp:add', agent, def),
    remove: (agent, name) => ipcRenderer.invoke('mcp:remove', agent, name)
  },
  context: {
    read: (project) => ipcRenderer.invoke('context:read', project),
    write: (project, text, agents) => ipcRenderer.invoke('context:write', project, text, agents)
  },
  chat: {
    start: (opts) => ipcRenderer.invoke('chat:start', opts),
    stop: (runId) => ipcRenderer.invoke('chat:stop', runId),
    onEvent: on('chat:event')
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    get: (id) => ipcRenderer.invoke('sessions:get', id),
    save: (s) => ipcRenderer.invoke('sessions:save', s),
    remove: (id) => ipcRenderer.invoke('sessions:remove', id),
    search: (q) => ipcRenderer.invoke('sessions:search', q),
    export: (id) => ipcRenderer.invoke('sessions:export', id)
  },
  git: {
    info: (dir) => ipcRenderer.invoke('git:info', dir),
    createWorktree: (project, agent) => ipcRenderer.invoke('git:createWorktree', project, agent),
    diff: (dir, base) => ipcRenderer.invoke('git:diff', dir, base),
    apply: (wt) => ipcRenderer.invoke('git:apply', wt),
    removeWorktree: (wt) => ipcRenderer.invoke('git:removeWorktree', wt)
  },
  files: {
    saveText: (name, text) => ipcRenderer.invoke('file:saveText', name, text),
    // Electron 32+ removed File.path; this is the supported replacement.
    pathFor: (file) => webUtils.getPathForFile(file)
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: on('update:state')
  }
})
