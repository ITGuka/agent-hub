import { getSecret } from './store'

// Validate an API key against the provider's cheapest authenticated endpoint
// (list models). Returns { ok, status, message }.
const CHECKS = {
  gemini: (k) => [`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, {}],
  claude: (k) => ['https://api.anthropic.com/v1/models', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }],
  codex: (k) => ['https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` } }]
}

export async function checkKey(agentId, typed) {
  const key = (typed || getSecret(agentId) || '').trim()
  if (!key) return { ok: false, status: 0, message: 'no key' }
  const [url, opts] = CHECKS[agentId](key)
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) })
    if (res.ok) return { ok: true, status: res.status }
    let message = res.statusText
    try {
      const j = await res.json()
      message = j?.error?.message || j?.message || message
    } catch {}
    return { ok: false, status: res.status, message: String(message).slice(0, 160) }
  } catch (e) {
    return { ok: false, status: 0, message: String(e?.cause?.code || e?.message || e) }
  }
}
