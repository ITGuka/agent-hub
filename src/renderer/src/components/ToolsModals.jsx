import { useEffect, useState } from 'react'
import { useT } from '../i18n'

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x big" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0))

// ---------------- Usage / cost ----------------
export function UsageModal({ agents, onClose }) {
  const t = useT()
  const [data, setData] = useState(null)
  useEffect(() => {
    window.api.usage.get().then(setData)
  }, [])
  const ranges = [
    ['today', t('today')],
    ['week', t('last7')],
    ['month', t('last30')],
    ['all', t('allTime')]
  ]
  const total = (r) =>
    Object.values(data || {}).reduce(
      (acc, a) => ({ cost: acc.cost + (a[r]?.cost || 0), tokens: acc.tokens + (a[r]?.tokens || 0) }),
      { cost: 0, tokens: 0 }
    )
  return (
    <Modal title={'📊 ' + t('usage')} onClose={onClose} wide>
      <p className="muted small">{t('usageHint')}</p>
      {!data ? (
        <p className="muted">{t('checking')}</p>
      ) : (
        <table className="usage-table">
          <thead>
            <tr>
              <th />
              {ranges.map(([, label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.values(agents).map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="tab-color" style={{ background: a.color }} /> {a.name}
                </td>
                {ranges.map(([r]) => {
                  const x = data[a.id]?.[r]
                  return (
                    <td key={r}>
                      {x ? (
                        <>
                          {x.cost > 0 && <div className="cost">${x.cost.toFixed(2)}</div>}
                          <div className="muted small">
                            {fmtTokens(x.tokens)} tok · {x.turns} {t('turns')}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="total">
              <td>{t('total')}</td>
              {ranges.map(([r]) => {
                const x = total(r)
                return (
                  <td key={r}>
                    {x.cost > 0 && <div className="cost">${x.cost.toFixed(2)}</div>}
                    <div className="muted small">{fmtTokens(x.tokens)} tok</div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      )}
    </Modal>
  )
}

// ---------------- MCP servers ----------------
const emptyDef = { name: '', type: 'stdio', commandLine: '', url: '', envText: '' }

function splitCommand(line) {
  const parts = line.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? []
  return { command: parts[0] || '', args: parts.slice(1) }
}
const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )

export function McpModal({ agents, detect, onClose }) {
  const t = useT()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [targets, setTargets] = useState(() => Object.keys(agents))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => window.api.mcp.list().then(setData)
  useEffect(() => {
    load()
  }, [])

  const run = async (fn) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    await load()
    setBusy(false)
  }

  const toDef = (s) => ({ name: s.name, type: s.type, command: s.command, args: s.args, env: s.env, url: s.url })

  const toggle = (server, agentId) =>
    run(() => (server.agents[agentId] ? window.api.mcp.remove(agentId, server.name) : window.api.mcp.add(agentId, toDef(server))))

  const removeAll = (server) => {
    if (!confirm(t('confirmDelete'))) return
    run(async () => {
      for (const a of Object.keys(server.agents)) await window.api.mcp.remove(a, server.name)
    })
  }

  const submit = () =>
    run(async () => {
      const def =
        form.type === 'http'
          ? { name: form.name.trim(), type: 'http', url: form.url.trim() }
          : { name: form.name.trim(), type: 'stdio', ...splitCommand(form.commandLine), env: parseEnv(form.envText) }
      for (const a of targets) await window.api.mcp.add(a, def)
      setForm(null)
    })

  const usable = Object.values(agents).filter((a) => detect?.agents[a.id]?.installed !== false)

  return (
    <Modal title={'🔌 ' + t('mcpServers')} onClose={onClose} wide>
      <p className="muted small">{t('mcpHint')}</p>
      {data?.errors && Object.keys(data.errors).length > 0 && (
        <p className="warn small">
          {Object.entries(data.errors)
            .map(([a, e]) => `${agents[a]?.name}: ${e}`)
            .join(' · ')}
        </p>
      )}
      {!data ? (
        <p className="muted">{t('checking')}</p>
      ) : (
        <table className="mcp-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('commandOrUrl')}</th>
              {Object.values(agents).map((a) => (
                <th key={a.id} style={{ color: a.color }}>
                  {a.name.split(' ')[0]}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {data.servers.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t('noMcp')}
                </td>
              </tr>
            )}
            {data.servers.map((s) => (
              <tr key={s.name}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td className="mono ellipsis" title={s.type === 'http' ? s.url : [s.command, ...(s.args || [])].join(' ')}>
                  {s.type === 'http' ? s.url : [s.command, ...(s.args || [])].join(' ')}
                </td>
                {Object.values(agents).map((a) => (
                  <td key={a.id}>
                    <button
                      className={'mcp-cell' + (s.agents[a.id] ? ' on' : '')}
                      disabled={busy || detect?.agents[a.id]?.installed === false}
                      title={s.agents[a.id] ? t('removeFrom') + ' ' + a.name : t('addTo') + ' ' + a.name}
                      onClick={() => toggle(s, a.id)}
                    >
                      {s.agents[a.id] ? '✓' : '+'}
                    </button>
                  </td>
                ))}
                <td>
                  <button className="x" disabled={busy} onClick={() => removeAll(s)} title={t('removeEverywhere')}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {msg && <p className="msg-error">{msg}</p>}

      {form ? (
        <div className="mcp-form">
          <div className="row">
            <input className="grow" placeholder={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="seg">
              {['stdio', 'http'].map((ty) => (
                <button key={ty} className={form.type === ty ? 'on' : ''} onClick={() => setForm({ ...form, type: ty })}>
                  {ty === 'stdio' ? t('localCommand') : 'HTTP URL'}
                </button>
              ))}
            </div>
          </div>
          {form.type === 'stdio' ? (
            <>
              <input
                className="mono"
                placeholder="npx -y @modelcontextprotocol/server-filesystem D:\projects"
                value={form.commandLine}
                onChange={(e) => setForm({ ...form, commandLine: e.target.value })}
              />
              <textarea
                className="mono"
                rows={2}
                placeholder={'API_KEY=...\nOTHER=value'}
                value={form.envText}
                onChange={(e) => setForm({ ...form, envText: e.target.value })}
              />
            </>
          ) : (
            <input className="mono" placeholder="https://example.com/mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          )}
          <div className="row">
            <span className="muted small">{t('addTo')}:</span>
            {usable.map((a) => (
              <label key={a.id} className="check">
                <input
                  type="checkbox"
                  checked={targets.includes(a.id)}
                  onChange={(e) => setTargets((x) => (e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id)))}
                />
                {a.name}
              </label>
            ))}
            <span className="grow" />
            <button className="btn small" onClick={() => setForm(null)}>
              {t('cancel')}
            </button>
            <button
              className="btn primary small"
              disabled={busy || !form.name.trim() || !targets.length || (form.type === 'http' ? !form.url.trim() : !form.commandLine.trim())}
              onClick={submit}
            >
              {t('add')}
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-foot">
          <button className="btn primary" onClick={() => setForm({ ...emptyDef })}>
            + {t('addMcp')}
          </button>
        </div>
      )}
    </Modal>
  )
}

// ---------------- Project instructions (CLAUDE.md / AGENTS.md / GEMINI.md) ----------------
export function ContextModal({ agents, project, onClose }) {
  const t = useT()
  const [files, setFiles] = useState(null)
  const [text, setText] = useState('')
  const [source, setSource] = useState(null)
  const [targets, setTargets] = useState(() => Object.keys(agents))
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!project) return
    window.api.context.read(project).then((f) => {
      setFiles(f)
      // Start from the longest existing file.
      const best = Object.entries(f)
        .filter(([, x]) => x.exists)
        .sort((a, b) => b[1].text.length - a[1].text.length)[0]
      if (best) {
        setSource(best[0])
        setText(best[1].text)
      }
    })
  }, [project])

  const differs = files && Object.values(files).filter((f) => f.exists).some((f) => f.text.trim() !== text.trim())

  const save = async () => {
    const overwrite = targets.filter((a) => files[a].exists && files[a].text.trim() !== text.trim())
    if (overwrite.length && !confirm(t('confirmOverwrite') + '\n' + overwrite.map((a) => files[a].name).join(', '))) return
    const written = await window.api.context.write(project, text, targets)
    setMsg(t('savedFiles') + ' ' + written.join(', '))
    setFiles(await window.api.context.read(project))
  }

  if (!project)
    return (
      <Modal title={'📝 ' + t('instructions')} onClose={onClose}>
        <p className="muted">{t('pickFolderFirst')}</p>
      </Modal>
    )

  return (
    <Modal title={'📝 ' + t('instructions')} onClose={onClose} wide>
      <p className="muted small">{t('instructionsHint')}</p>
      {files && (
        <div className="ctx-files">
          {Object.entries(files).map(([a, f]) => (
            <button
              key={a}
              className={'ctx-file' + (source === a ? ' on' : '')}
              style={{ '--agent': agents[a]?.color }}
              disabled={!f.exists}
              onClick={() => {
                setSource(a)
                setText(f.text)
              }}
              title={f.path}
            >
              <span className="mono">{f.name}</span>
              <span className="muted small">
                {f.exists ? (f.text.trim() === text.trim() ? '✓ ' + t('inSync') : '≠ ' + t('differs')) : t('missing')}
              </span>
            </button>
          ))}
        </div>
      )}
      <textarea className="mono ctx-editor" rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('instructionsPlaceholder')} />
      {msg && <p className="ok-text small">{msg}</p>}
      <div className="row">
        <span className="muted small">{t('writeTo')}:</span>
        {Object.entries(files || {}).map(([a, f]) => (
          <label key={a} className="check">
            <input
              type="checkbox"
              checked={targets.includes(a)}
              onChange={(e) => setTargets((x) => (e.target.checked ? [...x, a] : x.filter((y) => y !== a)))}
            />
            <span className="mono">{f.name}</span>
          </label>
        ))}
        <span className="grow" />
        {differs && <span className="warn small">{t('notInSync')}</span>}
        <button className="btn primary" disabled={!text.trim() || !targets.length} onClick={save}>
          ⇄ {t('syncSave')}
        </button>
      </div>
    </Modal>
  )
}
