import { useEffect, useState } from 'react'
import { useT } from '../i18n'

export function useUpdate() {
  const [state, setState] = useState({ status: 'idle' })
  useEffect(() => {
    window.api.update.state().then(setState)
    return window.api.update.onState(setState)
  }, [])
  return state
}

// Sidebar card; only visible when there is something to act on.
export function UpdateCard({ state }) {
  const t = useT()
  if (!['available', 'downloading', 'ready'].includes(state.status)) return null
  return (
    <div className="update-card">
      <div>
        <strong>{t('updateAvailable')}</strong> <span className="muted">v{state.version}</span>
      </div>
      {state.status === 'available' && (
        <button className="btn primary small" onClick={() => window.api.update.download()}>
          {t('download')}
        </button>
      )}
      {state.status === 'downloading' && (
        <div className="progress">
          <div style={{ width: (state.percent || 0) + '%' }} />
        </div>
      )}
      {state.status === 'ready' && (
        <button className="btn primary small" onClick={() => window.api.update.install()}>
          {t('restartToUpdate')}
        </button>
      )}
    </div>
  )
}

// Settings section: current version + manual check.
export function UpdateSection({ state, version }) {
  const t = useT()
  const label = {
    dev: t('updateDev'),
    checking: t('checking'),
    latest: t('upToDate'),
    available: `${t('updateAvailable')}: v${state.version}`,
    downloading: `${t('downloading')} ${state.percent || 0}%`,
    ready: `${t('updateReady')}: v${state.version}`,
    error: `${t('updateError')}: ${state.error || ''}`
  }[state.status]
  return (
    <section>
      <h3>{t('version')}</h3>
      <div className="row between">
        <span>
          Agent Hub <strong>v{version}</strong>
          {label && <span className="muted small"> · {label}</span>}
        </span>
        {state.status === 'available' ? (
          <button className="btn primary small" onClick={() => window.api.update.download()}>
            {t('download')}
          </button>
        ) : state.status === 'ready' ? (
          <button className="btn primary small" onClick={() => window.api.update.install()}>
            {t('restartToUpdate')}
          </button>
        ) : (
          <button
            className="btn small"
            disabled={['dev', 'checking', 'downloading'].includes(state.status)}
            onClick={() => window.api.update.check()}
          >
            {t('checkUpdates')}
          </button>
        )}
      </div>
    </section>
  )
}
