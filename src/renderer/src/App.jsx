import { useEffect, useState, useCallback } from 'react'
import { LangContext, useT } from './i18n'
import TerminalView from './components/TerminalView'
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
  const update = useUpdate()

  const runDetect = useCallback(() => {
    setDetect(null)
    window.api.agents.detect().then(setDetect)
  }, [])

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      if (s.recentProjects[0]) setProject(s.recentProjects[0])
    })
    window.api.agents.list().then(setAgents)
    window.api.app.info().then(setAppInfo)
    runDetect()
  }, [runDetect])

  if (!settings) return null

  const openTab = (kind, cwd = project) => {
    const key = tabSeq++
    const a = agents[kind]
    const title = kind.startsWith('install:')
      ? `npm · ${agents[kind.slice(8)].name}`
      : `${a ? a.name : 'Terminal'}${cwd ? ' · ' + baseName(cwd) : ''}`
    setTabs((ts) => [...ts, { key, kind, cwd, title, status: 'starting', gen: 0 }])
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

  const install = (agentId) => {
    openTab('install:' + agentId, null)
  }

  const onTabStatus = (tab, status) => {
    patchTab(tab.key, { status })
    // Re-check installs once the npm tab finishes.
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
          install={install}
          openSettings={() => setShowSettings(true)}
          update={update}
        />
        <main className="main">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              agents={agents}
              activeKey={activeKey}
              setActiveKey={setActiveKey}
              closeTab={closeTab}
            />
          )}
          <div className="terms">
            {tabs.map((tab) => (
              <TerminalView
                key={tab.key + ':' + tab.gen}
                tab={tab}
                active={tab.key === activeKey}
                onStatus={(s) => onTabStatus(tab, s)}
                onRestart={() => patchTab(tab.key, { gen: tab.gen + 1, status: 'starting' })}
              />
            ))}
            {tabs.length === 0 && (
              <Welcome agents={agents} detect={detect} project={project} openTab={openTab} install={install} />
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

function StatusDot({ info }) {
  const cls = !info ? 'dot checking' : info.installed ? 'dot ok' : 'dot missing'
  return <span className={cls} />
}

function Sidebar({ settings, setSettings, agents, detect, project, setProject, openTab, install, openSettings, update }) {
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

      <section>
        <h3>{t('project')}</h3>
        <div className="project-current" title={project || ''}>
          {project ? (
            <>
              <strong>{baseName(project)}</strong>
              <small><bdi>{project}</bdi></small>
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
      </section>

      <section>
        <h3>{t('agents')}</h3>
        {Object.values(agents).map((a) => {
          const info = detect?.agents[a.id]
          return (
            <div key={a.id} className="agent-row">
              <button
                className="agent-btn"
                style={{ '--agent': a.color }}
                disabled={info && !info.installed}
                onClick={() => openTab(a.id)}
                title={info?.version ? `${a.name} ${info.version}` : a.name}
              >
                <StatusDot info={info} />
                <span className="grow">{a.name}</span>
                <span className="plus">+</span>
              </button>
              {info && !info.installed && (
                <button className="btn small" disabled={!detect.npm} onClick={() => install(a.id)}>
                  {t('install')}
                </button>
              )}
            </div>
          )
        })}
        {detect && !detect.npm && (
          <p className="warn small">
            {t('nodeMissing')}{' '}
            <a href="https://nodejs.org" target="_blank" rel="noreferrer">
              nodejs.org
            </a>
          </p>
        )}
        <button className="agent-btn" style={{ '--agent': '#8a8f98' }} onClick={() => openTab('shell')}>
          <span className="dot ok" />
          <span className="grow">{t('shell')}</span>
          <span className="plus">+</span>
        </button>
      </section>

      {settings.recentProjects.length > 0 && (
        <section className="recent">
          <h3>{t('recent')}</h3>
          {settings.recentProjects.map((dir) => (
            <div
              key={dir}
              className={'recent-item' + (dir === project ? ' active' : '')}
              onClick={() => openRecent(dir)}
              title={dir}
            >
              <span className="grow ellipsis">{baseName(dir)}</span>
              <button className="x" title={t('remove')} onClick={(e) => remove(e, dir)}>
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      <UpdateCard state={update} />
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
        const color = agents[tab.kind]?.color || '#8a8f98'
        return (
          <div
            key={tab.key}
            className={'tab' + (tab.key === activeKey ? ' active' : '') + (tab.status === 'exited' ? ' exited' : '')}
            style={{ '--agent': color }}
            onClick={() => setActiveKey(tab.key)}
            onMouseDown={(e) => e.button === 1 && closeTab(tab.key)}
            title={tab.cwd || ''}
          >
            <span className="tab-color" />
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

function Welcome({ agents, detect, project, openTab, install }) {
  const t = useT()
  return (
    <div className="welcome">
      <h1>{t('welcomeTitle')}</h1>
      <p className="muted">{project ? project : t('welcomeSub')}</p>
      {detect && !detect.node && (
        <p className="warn">
          {t('nodeMissing')}{' '}
          <a href="https://nodejs.org" target="_blank" rel="noreferrer">
            nodejs.org
          </a>
        </p>
      )}
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
                <button className="btn primary agent-bg" onClick={() => openTab(a.id)} disabled={!info}>
                  {t('start')}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {!project && <p className="muted small">{t('pickFolderFirst')}</p>}
    </div>
  )
}
