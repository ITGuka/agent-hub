import { useState } from 'react'
import { useT } from '../i18n'

export default function Settings({ settings, setSettings, agents, detect, runDetect, install, onClose }) {
  const t = useT()
  const [keys, setKeys] = useState({})
  const [args, setArgs] = useState(settings.agentArgs)

  const setLang = async (language) => setSettings(await window.api.settings.update({ language }))
  const saveKey = async (id, value) => {
    setSettings(await window.api.settings.setKey(id, value))
    setKeys((k) => ({ ...k, [id]: '' }))
  }
  const saveArgs = async () => setSettings(await window.api.settings.update({ agentArgs: args }))

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t('settings')}</h2>
          <button className="x big" onClick={onClose}>
            ×
          </button>
        </div>

        <section>
          <h3>{t('language')}</h3>
          <div className="seg">
            {[
              ['ka', 'ქართული'],
              ['en', 'English']
            ].map(([code, label]) => (
              <button key={code} className={settings.language === code ? 'on' : ''} onClick={() => setLang(code)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="row between">
            <h3>{t('installation')}</h3>
            <button className="btn small" onClick={runDetect}>
              {t('recheck')}
            </button>
          </div>
          <table className="install-table">
            <tbody>
              <tr>
                <td>Node.js</td>
                <td className="muted" title={detect?.nodePath || ''}>
                  {!detect ? t('checking') : detect.node || t('notInstalled')}
                </td>
                <td />
              </tr>
              {Object.values(agents).map((a) => {
                const info = detect?.agents[a.id]
                return (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td className="muted" title={info?.path || ''}>
                      {!info ? t('checking') : info.installed ? `${info.version || t('installed')}` : t('notInstalled')}
                    </td>
                    <td className="right">
                      {info && (
                        <button className="btn small" disabled={!detect.npm} onClick={() => install(a.id)}>
                          {info.installed ? t('update') : t('install')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section>
          <h3>{t('apiKeys')}</h3>
          <p className="muted small">{t('apiKeysHint')}</p>
          {Object.values(agents).map((a) => (
            <div key={a.id} className="field">
              <label>
                {a.name} <code>{a.keyEnv}</code>
                {settings.keysSet[a.id] && <span className="badge">{t('keySet')}</span>}
              </label>
              <div className="row">
                <input
                  type="password"
                  className="grow"
                  placeholder={settings.keysSet[a.id] ? '••••••••' : ''}
                  value={keys[a.id] || ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [a.id]: e.target.value }))}
                />
                <button className="btn small" disabled={!keys[a.id]} onClick={() => saveKey(a.id, keys[a.id])}>
                  {t('save')}
                </button>
                {settings.keysSet[a.id] && (
                  <button className="btn small" onClick={() => saveKey(a.id, '')}>
                    {t('clear')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3>{t('extraArgs')}</h3>
          <p className="muted small">{t('extraArgsHint')}</p>
          {Object.values(agents).map((a) => (
            <div key={a.id} className="field">
              <label>
                <code>{a.command}</code>
              </label>
              <input
                value={args[a.id] || ''}
                onChange={(e) => setArgs((s) => ({ ...s, [a.id]: e.target.value }))}
                onBlur={saveArgs}
              />
            </div>
          ))}
        </section>

        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            {t('done')}
          </button>
        </div>
      </div>
    </div>
  )
}
