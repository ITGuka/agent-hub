// Desktop notification when the app is in the background (Windows toast).
// Clicking it brings the window back and calls onClick (e.g. to focus a tab).
export function notify(settings, { title, body, onClick }) {
  if (!settings?.notifications || document.hasFocus()) return
  window.api.app.attention()
  try {
    const n = new Notification(title, { body: (body || '').slice(0, 200), silent: false })
    n.onclick = () => {
      window.api.app.focus()
      onClick?.()
    }
  } catch {}
}

// Plain text of an assistant message (for notifications and pipeline hand-off).
export function messageText(m) {
  return (m?.parts || [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim()
}
