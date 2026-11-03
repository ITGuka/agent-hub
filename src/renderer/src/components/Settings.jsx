import { useState } from 'react'
import { useT } from '../i18n'
import { UpdateSection } from './Update'

export default function Settings({ settings, setSettings, agents, detect, runDetect, install, onClose, update, version }) {
  const t = useT()
  const [keys, setKeys] = useState({})
  const [args, setArgs] = useState(settings.agentArgs)
  const [checks, setChecks] = useState({})
  const [templates, setTemplatesState] = useState(settings.templates || [])
  // Edit locally; persist when save !== false (on blur, add, delete).
  const setTemplates = async (list, save = true) => {
    setTemplatesState(list)
    if (save) setSettings(await window.api.settings.update({ templates: list }))
  }

  const testKey = async (id) => {
    setChecks((c) => ({ ...c, [id]: { pending: true } }))
    const r = await window.api.settings.checkKey(id, keys[id])
    setChecks((c) => ({ ...c, [id]: r }))
  }

  const setLang = async (language) => setSettings(await window.api.settings.update({ language }))
  const saveKey = async (id, value) => {
    setSettings(await window.api.settings.setKey(id, value))
    setKeys((k) => ({ ...k, [id]: '' }))
    setChecks((c) => ({ ...c, [id]: null }))
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

        <UpdateSection state={update} version={version} />

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
                      {info?.installed && info.latest && (
                        <span className={'small ' + (info.updateAvailable ? 'update-hint' : '')}>
                          {' '}
                          · {info.updateAvailable ? `${t('latestIs')} ${info.latest}` : t('upToDate')}
                        </span>
                      )}
                    </td>
                    <td className="right">
                      {info && (
                        <button
                          className={'btn small' + (info.installed && info.updateAvailable ? ' primary' : '')}
                          disabled={!detect.npm || (info.installed && !info.updateAvailable)}
                          onClick={() => install(a.id)}
                        >
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
                <button
                  className="btn small"
                  disabled={!keys[a.id] && !settings.keysSet[a.id]}
                  onClick={() => testKey(a.id)}
                >
                  {t('testKey')}
                </button>
                {settings.keysSet[a.id] && (
                  <button className="btn small" onClick={() => saveKey(a.id, '')}>
                    {t('clear')}
                  </button>
                )}
              </div>
              {checks[a.id] && (
                <div className={'key-check ' + (checks[a.id].pending ? '' : checks[a.id].ok ? 'ok' : 'bad')}>
                  {checks[a.id].pending
                    ? t('checking')
                    : checks[a.id].ok
                      ? '✓ ' + t('keyValid')
                      : `✗ ${t('keyInvalid')} (${checks[a.id].status || '—'}): ${checks[a.id].message || ''}`}
                </div>
              )}
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

        <section>
          <h3>{t('chatMode')}</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={!!settings.chatAutoApprove}
              onChange={async (e) => setSettings(await window.api.settings.update({ chatAutoApprove: e.target.checked }))}
            />
            {t('autoApprove')}
          </label>
          <p className="muted small">{t('autoApproveHint')}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={!!settings.isolateChats}
              onChange={async (e) => setSettings(await window.api.settings.update({ isolateChats: e.target.checked }))}
            />
            {t('isolateChats')}
          </label>
          <p className="muted small">{t('isolateHint')}</p>
        </section>

        <section>
          <h3>{t('compareStats')}</h3>
          <div className="row stats-row">
            <span className="muted small">
              {t('comparisons')}: {settings.stats?.comparisons || 0}
            </span>
            {Object.values(agents).map((a) => (
              <span key={a.id} className="chip" style={{ color: a.color }}>
                ★ {a.name} {settings.stats?.wins?.[a.id] || 0}
              </span>
            ))}
          </div>
        </section>

        <section>
          <div className="row between">
            <h3>{t('templates')}</h3>
            <button className="btn small" onClick={() => setTemplates([...templates, { name: t('newTemplate'), text: '' }])}>
              + {t('add')}
            </button>
          </div>
          {templates.map((tp, i) => (
            <div key={i} className="template-row">
              <div className="row">
                <input
                  className="grow"
                  value={tp.name}
                  onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)), false)}
                  onBlur={() => setTemplates(templates)}
                />
                <button className="x" title={t('remove')} onClick={() => setTemplates(templates.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
              <textarea
                rows={2}
                value={tp.text}
                placeholder={t('templateText')}
                onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)), false)}
                onBlur={() => setTemplates(templates)}
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
