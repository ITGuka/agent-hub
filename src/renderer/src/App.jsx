import { useEffect, useState, useCallback } from 'react'
import { LangContext, useT } from './i18n'
import TerminalView from './components/TerminalView'
import ChatView from './components/ChatView'
import Settings from './components/Settings'
import { useUpdate, UpdateCard } from './components/Update'

let tabSeq = 1
const baseName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() : '')

export default function App() {
  const [settings, setSettings] = useState(null)
  const [agents, setAgents] = useState({})
  const [detect, setDetect] = useState(null)
  const [project, setProject] = useState(null)
  const [tabs, setTabs] = useState([])
  const [activeKey, setActiveKey] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [appInfo, setAppInfo] = useState({ version: '' })
  const [sessions, setSessions] = useState([])
  const update = useUpdate()

  const runDetect = useCallback(() => {
    setDetect(null)
    window.api.agents.detect().then(setDetect)
  }, [])
  const refreshSessions = useCallback(() => window.api.sessions.list().then(setSessions), [])

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      if (s.recentProjects[0]) setProject(s.recentProjects[0])
    })
    window.api.agents.list().then(setAgents)
    window.api.app.info().then(setAppInfo)
    refreshSessions()
    runDetect()
  }, [runDetect, refreshSessions])

  if (!settings) return null

  const openTab = (kind, cwd = project) => {
    const key = tabSeq++
    const a = agents[kind]
    const title =
      kind === 'install:node'
        ? 'Node.js'
        : kind.startsWith('install:')
          ? `npm · ${agents[kind.slice(8)].name}`
          : `${a ? a.name : 'Terminal'}${cwd ? ' · ' + baseName(cwd) : ''}`
    setTabs((ts) => [...ts, { key, type: 'term', kind, cwd, title, status: 'starting', gen: 0 }])
    setActiveKey(key)
  }

  const openChat = (agent, session = null) => {
    if (session) {
      const existing = tabs.find((t) => t.type === 'chat' && t.sessionId === session.id)
      if (existing) return setActiveKey(existing.key)
    }
    const key = tabSeq++
    const cwd = session ? session.cwd : project
    setTabs((ts) => [
      ...ts,
      {
        key,
        type: 'chat',
        agent,
        cwd,
        sessionId: session?.id || null,
        title: session?.title || `${agents[agent].name}${cwd ? ' · ' + baseName(cwd) : ''}`
      }
    ])
    setActiveKey(key)
  }

  const closeTab = (key) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.key === key)
      const next = ts.filter((t) => t.key !== key)
      if (key === activeKey) setActiveKey(next[Math.min(i, next.length - 1)]?.key ?? null)
      return next
    })
  }

  const patchTab = (key, patch) => setTabs((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)))

  const install = (agentId) => openTab('install:' + agentId, null)

  const onTabStatus = (tab, status) => {
    patchTab(tab.key, { status })
    if (status === 'exited' && tab.kind.startsWith('install:')) runDetect()
  }

  return (
    <LangContext.Provider value={settings.language}>
      <div className="app">
        <Sidebar
          settings={settings}
          setSettings={setSettings}
          agents={agents}
          detect={detect}
          project={project}
          setProject={setProject}
          openTab={openTab}
          openChat={openChat}
          install={install}
          openSettings={() => setShowSettings(true)}
          update={update}
          sessions={sessions}
          refreshSessions={refreshSessions}
        />
        <main className="main">
          {tabs.length > 0 && (
            <TabBar tabs={tabs} agents={agents} activeKey={activeKey} setActiveKey={setActiveKey} closeTab={closeTab} />
          )}
          <div className="terms">
            {tabs.map((tab) =>
              tab.type === 'chat' ? (
                <ChatView
                  key={tab.key}
                  tab={tab}
                  active={tab.key === activeKey}
                  agents={agents}
                  settings={settings}
                  setSettings={setSettings}
                  onSession={(s) => patchTab(tab.key, { sessionId: s.id, ...(s.title ? { title: s.title } : {}) })}
                  onSaved={refreshSessions}
                />
              ) : (
                <TerminalView
                  key={tab.key + ':' + tab.gen}
                  tab={tab}
                  active={tab.key === activeKey}
                  templates={settings.templates}
                  onStatus={(s) => onTabStatus(tab, s)}
                  onRestart={() => patchTab(tab.key, { gen: tab.gen + 1, status: 'starting' })}
                />
              )
            )}
            {tabs.length === 0 && (
              <Welcome agents={agents} detect={detect} project={project} openTab={openTab} openChat={openChat} install={install} />
            )}
          </div>
        </main>
        {showSettings && (
          <Settings
            settings={settings}
            setSettings={setSettings}
            agents={agents}
            detect={detect}
            runDetect={runDetect}
            update={update}
            version={appInfo.version}
            install={(id) => {
              setShowSettings(false)
              install(id)
            }}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    </LangContext.Provider>
  )
}

function NodeMissing({ install, small }) {
  const t = useT()
  return (
    <div className={'node-missing' + (small ? ' small' : '')}>
      <span className="warn">{t('nodeMissing')}</span>
      <button className="btn primary small" onClick={() => install('node')}>
        {t('installNode')}
      </button>
    </div>
  )
}

function StatusDot({ info }) {
  const cls = !info ? 'dot checking' : info.installed ? 'dot ok' : 'dot missing'
  return <span className={cls} />
}

function timeAgo(ts, lang) {
  const d = (Date.now() - ts) / 1000
  const ka = lang === 'ka'
  if (d < 60) return ka ? 'ახლა' : 'now'
  if (d < 3600) return Math.floor(d / 60) + (ka ? ' წთ' : 'm')
  if (d < 86400) return Math.floor(d / 3600) + (ka ? ' სთ' : 'h')
  return new Date(ts).toLocaleDateString()
}

function History({ sessions, agents, project, openChat, refreshSessions, lang }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => {
    if (!query.trim()) return setResults(null)
    const h = setTimeout(() => window.api.sessions.search(query).then(setResults), 200)
    return () => clearTimeout(h)
  }, [query, sessions])

  const items = results ?? sessions.filter((s) => !project || s.cwd === project).slice(0, 40)

  const remove = async (e, id) => {
    e.stopPropagation()
    if (!confirm(t('confirmDelete'))) return
    await window.api.sessions.remove(id)
    refreshSessions()
  }

  return (
    <section className="history">
      <h3>{t('history')}</h3>
      <input
        className="search"
        placeholder={'⌕ ' + t('searchChats')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {items.length === 0 && <div className="muted small pad">{results ? t('noResults') : t('noHistory')}</div>}
      {items.map((s) => (
        <div
          key={s.id}
          className="history-item"
          style={{ '--agent': agents[s.agent]?.color }}
          onClick={() => openChat(s.agent, s)}
          title={`${agents[s.agent]?.name} · ${s.cwd}`}
        >
          <span className="tab-color" />
          <div className="grow">
            <div className="ellipsis">{s.title || '—'}</div>
            {s.snippet && s.snippet !== s.title && <div className="snippet ellipsis">{s.snippet}</div>}
          </div>
          <span className="muted small when">{timeAgo(s.updatedAt, lang)}</span>
          <button className="x" title={t('remove')} onClick={(e) => remove(e, s.id)}>
            ×
          </button>
        </div>
      ))}
    </section>
  )
}

function Sidebar(props) {
  const { settings, setSettings, agents, detect, project, setProject, openTab, openChat, install, openSettings, update } = props
  const t = useT()
  const pick = async () => {
    const r = await window.api.projects.pick()
    if (r) {
      setProject(r.dir)
      setSettings((s) => ({ ...s, recentProjects: r.recent }))
    }
  }
  const openRecent = async (dir) => {
    const r = await window.api.projects.open(dir)
    if (r) {
      setProject(r.dir)
      setSettings((s) => ({ ...s, recentProjects: r.recent }))
    } else {
      const recent = await window.api.projects.remove(dir)
      setSettings((s) => ({ ...s, recentProjects: recent }))
    }
  }
  const remove = async (e, dir) => {
    e.stopPropagation()
    const recent = await window.api.projects.remove(dir)
    setSettings((s) => ({ ...s, recentProjects: recent }))
    if (dir === project) setProject(null)
  }

  return (
    <aside className="sidebar">
      <div className="brand">{t('appName')}</div>
      <UpdateCard state={update} />

      <section>
        <h3>{t('project')}</h3>
        <div className="project-current" title={project || ''}>
          {project ? (
            <>
              <strong>{baseName(project)}</strong>
              <small>
                <bdi>{project}</bdi>
              </small>
            </>
          ) : (
            <small>{t('noProject')}</small>
          )}
        </div>
        <div className="row">
          <button className="btn primary grow" onClick={pick}>
            {t('chooseFolder')}
          </button>
          {project && (
            <button className="btn icon" title={t('openInExplorer')} onClick={() => window.api.projects.reveal(project)}>
              ↗
            </button>
          )}
        </div>
        {settings.recentProjects.length > 1 && (
          <div className="recent">
            {settings.recentProjects
              .filter((d) => d !== project)
              .map((dir) => (
                <div key={dir} className="recent-item" onClick={() => openRecent(dir)} title={dir}>
                  <span className="grow ellipsis">{baseName(dir)}</span>
                  <button className="x" title={t('remove')} onClick={(e) => remove(e, dir)}>
                    ×
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>

      <section>
        <h3>{t('agents')}</h3>
        {Object.values(agents).map((a) => {
          const info = detect?.agents[a.id]
          const ready = !info || info.installed
          return (
            <div key={a.id} className="agent-row" style={{ '--agent': a.color }}>
              <div className={'agent-name' + (ready ? '' : ' off')} title={info?.version ? `${a.name} ${info.version}` : a.name}>
                <StatusDot info={info} />
                <span className="grow ellipsis">{a.name}</span>
              </div>
              {info && !info.installed ? (
                <button className="btn small" disabled={!detect.npm} onClick={() => install(a.id)}>
                  {t('install')}
                </button>
              ) : (
                <>
                  <button className="icon-btn" disabled={!info} title={t('newChat')} onClick={() => openChat(a.id)}>
                    💬
                  </button>
                  <button className="icon-btn" disabled={!info} title={t('newTerminal')} onClick={() => openTab(a.id)}>
                    ›_
                  </button>
                </>
              )}
            </div>
          )
        })}
        {detect && !detect.npm && <NodeMissing install={install} small />}
        <div className="agent-row" style={{ '--agent': '#8a8f98' }}>
          <div className="agent-name">
            <span className="dot ok" />
            <span className="grow">{t('shell')}</span>
          </div>
          <button className="icon-btn" title={t('newTerminal')} onClick={() => openTab('shell')}>
            ›_
          </button>
        </div>
      </section>

      <History {...props} lang={settings.language} />

      <div className="sidebar-foot">
        <button className="btn grow" onClick={openSettings}>
          ⚙ {t('settings')}
        </button>
      </div>
    </aside>
  )
}

function TabBar({ tabs, agents, activeKey, setActiveKey, closeTab }) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const color = agents[tab.type === 'chat' ? tab.agent : tab.kind]?.color || '#8a8f98'
        return (
          <div
            key={tab.key}
            className={'tab' + (tab.key === activeKey ? ' active' : '') + (tab.status === 'exited' ? ' exited' : '')}
            style={{ '--agent': color }}
            onClick={() => setActiveKey(tab.key)}
            onMouseDown={(e) => e.button === 1 && closeTab(tab.key)}
            title={tab.cwd || ''}
          >
            <span className="tab-icon">{tab.type === 'chat' ? '💬' : '›_'}</span>
            <span className="ellipsis">{tab.title}</span>
            <button
              className="x"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.key)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Welcome({ agents, detect, project, openTab, openChat, install }) {
  const t = useT()
  return (
    <div className="welcome">
      <h1>{t('welcomeTitle')}</h1>
      <p className="muted">{project ? project : t('welcomeSub')}</p>
      {detect && !detect.npm && <NodeMissing install={install} />}
      <div className="cards">
        {Object.values(agents).map((a) => {
          const info = detect?.agents[a.id]
          return (
            <div key={a.id} className="card" style={{ '--agent': a.color }}>
              <div className="card-head">
                <StatusDot info={info} />
                <strong>{a.name}</strong>
              </div>
              <small className="muted">
                {!info ? t('checking') : info.installed ? `${t('installed')} · ${info.version || ''}` : t('notInstalled')}
              </small>
              {info && !info.installed ? (
                <button className="btn" onClick={() => install(a.id)} disabled={!detect.npm}>
                  {t('install')}
                </button>
              ) : (
                <div className="row">
                  <button className="btn primary agent-bg grow" onClick={() => openChat(a.id)} disabled={!info}>
                    💬 {t('chat')}
                  </button>
                  <button className="btn grow" onClick={() => openTab(a.id)} disabled={!info}>
                    ›_ {t('terminal')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!project && <p className="muted small">{t('pickFolderFirst')}</p>}
    </div>
  )
}
