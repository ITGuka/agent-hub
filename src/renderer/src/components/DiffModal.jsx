import { useEffect, useMemo, useState } from 'react'
import { useT } from '../i18n'

// Split a unified diff into per-file chunks.
function splitPatch(patch) {
  const files = []
  let cur = null
  for (const line of (patch || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/ b\/(.*)$/)
      cur = { path: m ? m[1] : line, lines: [] }
      files.push(cur)
    } else if (cur && !/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(line)) {
      cur.lines.push(line)
    }
  }
  return files
}

const lineClass = (l) =>
  l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('Binary') ? 'hunk' : ''

// Shows what changed in `dir` since `base`. For a worktree session it also offers
// copying the changes into the main project and removing the worktree.
export default function DiffModal({ title, dir, base, worktree, onClose, onWorktreeRemoved }) {
  const t = useT()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => {
    setData(null)
    window.api.git.diff(dir, base).then((d) => {
      setData(d)
      setSelected(null)
    })
  }
  useEffect(load, [dir, base])

  const files = useMemo(() => splitPatch(data?.patch), [data])
  const shown = selected ? files.filter((f) => f.path === selected) : files
  const stat = Object.fromEntries((data?.files || []).map((f) => [f.path, f]))

  const apply = async () => {
    setBusy(true)
    const r = await window.api.git.apply(worktree)
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: t('applied').replace('{n}', r.files) } : { ok: false, text: r.error })
  }

  const remove = async () => {
    if (!confirm(t('confirmRemoveWorktree'))) return
    setBusy(true)
    const r = await window.api.git.removeWorktree(worktree)
    setBusy(false)
    if (r.ok) {
      onWorktreeRemoved?.()
      onClose()
    } else setMsg({ ok: false, text: r.error })
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal diff-modal">
        <div className="modal-head">
          <h2 className="ellipsis">± {title}</h2>
          <div className="row">
            <button className="btn small" onClick={load}>
              ↻ {t('refresh')}
            </button>
            <button className="x big" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="muted small ellipsis">
          {worktree ? `${t('worktree')}: ${worktree.branch} · ${worktree.path}` : dir}
        </div>

        {!data && <p className="muted">{t('checking')}</p>}
        {data && !data.ok && <p className="msg-error">{data.error}</p>}
        {data?.ok && files.length === 0 && <p className="muted">{t('noChanges')}</p>}

        {data?.ok && files.length > 0 && (
          <div className="diff-body">
            <div className="diff-files">
              <div className={'diff-file' + (!selected ? ' on' : '')} onClick={() => setSelected(null)}>
                {t('allFiles')} ({files.length})
              </div>
              {files.map((f) => (
                <div
                  key={f.path}
                  className={'diff-file' + (selected === f.path ? ' on' : '')}
                  onClick={() => setSelected(f.path)}
                  title={f.path}
                >
                  <span className="ellipsis grow">{f.path}</span>
                  <span className="add-n">+{stat[f.path]?.add ?? 0}</span>
                  <span className="del-n">−{stat[f.path]?.del ?? 0}</span>
                </div>
              ))}
            </div>
            <div className="diff-view">
              {shown.map((f) => (
                <div key={f.path} className="diff-chunk">
                  <div className="diff-chunk-head">{f.path}</div>
                  <pre>
                    {f.lines.map((l, i) => (
                      <div key={i} className={'dl ' + lineClass(l)}>
                        {l || ' '}
                      </div>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && <p className={msg.ok ? 'ok-text' : 'msg-error'}>{msg.text}</p>}

        {worktree && (
          <div className="modal-foot row">
            <span className="muted small grow">{t('worktreeHint')}</span>
            <button className="btn small" disabled={busy} onClick={remove}>
              🗑 {t('removeWorktree')}
            </button>
            <button className="btn primary small" disabled={busy || !files.length} onClick={apply}>
              ⇪ {t('applyToProject')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
