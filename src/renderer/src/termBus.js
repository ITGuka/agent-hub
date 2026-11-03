// Routes pty output to the terminal that owns it. Output that arrives before the
// terminal registers its id (a race right after spawn) is buffered and replayed.
const handlers = new Map()
const pending = new Map()

window.api.term.onData((id, data) => {
  const h = handlers.get(id)
  if (h) h.data(data)
  else pending.set(id, (pending.get(id) || '') + data)
})
window.api.term.onExit((id, code) => {
  const h = handlers.get(id)
  if (h) h.exit(code)
  else pending.set(id + ':exit', code)
})

export function register(id, onData, onExit) {
  handlers.set(id, { data: onData, exit: onExit })
  if (pending.has(id)) {
    onData(pending.get(id))
    pending.delete(id)
  }
  if (pending.has(id + ':exit')) {
    onExit(pending.get(id + ':exit'))
    pending.delete(id + ':exit')
  }
  return () => handlers.delete(id)
}
