import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { register } from '../termBus'
import { useT } from '../i18n'

const theme = {
  background: '#0f1114',
  foreground: '#e6e6e6',
  cursor: '#e6e6e6',
  selectionBackground: '#3a4150'
}

export default function TerminalView({ tab, active, onStatus, onRestart }) {
  const t = useT()
  const host = useRef(null)
  const fitRef = useRef(null)
  const termRef = useRef(null)
  const idRef = useRef(null)
  const [exitCode, setExitCode] = useState(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      customGlyphs: true,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    // WebGL draws cell backgrounds without the hairline gaps of the DOM renderer
    // (visible as stripes in TUIs like Gemini CLI). Fall back to DOM if unavailable.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {}
    fitRef.current = fit
    termRef.current = term
    try {
      fit.fit()
    } catch {}

    // Ctrl+C copies when text is selected; Ctrl+V pastes.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then((s) => idRef.current && window.api.term.write(idRef.current, s))
        return false
      }
      return true
    })

    let unregister = () => {}
    let disposed = false
    window.api.term
      .create({ kind: tab.kind, cwd: tab.cwd, cols: term.cols, rows: term.rows })
      .then(({ id }) => {
        if (disposed) return window.api.term.kill(id)
        idRef.current = id
        unregister = register(
          id,
          (d) => term.write(d),
          (code) => {
            setExitCode(code)
            onStatus('exited')
          }
        )
        onStatus('running')
      })
      .catch((err) => {
        term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`)
        setExitCode(-1)
        onStatus('exited')
      })

    const input = term.onData((d) => idRef.current && window.api.term.write(idRef.current, d))
    const resize = term.onResize(({ cols, rows }) => idRef.current && window.api.term.resize(idRef.current, cols, rows))
    const ro = new ResizeObserver(() => {
      if (host.current?.offsetParent !== null) {
        try {
          fit.fit()
        } catch {}
      }
    })
    ro.observe(host.current)

    return () => {
      disposed = true
      ro.disconnect()
      input.dispose()
      resize.dispose()
      unregister()
      if (idRef.current) window.api.term.kill(idRef.current)
      term.dispose()
    }
  }, [])

  useEffect(() => {
    if (active)
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
        } catch {}
        termRef.current?.focus()
      })
  }, [active])

  return (
    <div className="term-wrap" style={{ display: active ? 'flex' : 'none' }}>
      <div className="term" ref={host} />
      {exitCode !== null && (
        <div className="term-exit">
          <span>
            {t('exited')} {exitCode}
          </span>
          <button className="btn" onClick={onRestart}>
            {t('restart')}
          </button>
        </div>
      )}
    </div>
  )
}
