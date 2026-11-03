import fs from 'node:fs'
import path from 'node:path'

// Project instruction files read by each agent.
export const CONTEXT_FILES = { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md' }

export function read(project) {
  const files = {}
  for (const [agent, name] of Object.entries(CONTEXT_FILES)) {
    const p = path.join(project, name)
    files[agent] = { name, path: p, exists: fs.existsSync(p), text: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' }
  }
  return files
}

// Write the same instructions to the chosen agents' files.
export function write(project, text, agents) {
  const written = []
  for (const agent of agents) {
    const name = CONTEXT_FILES[agent]
    if (!name) continue
    fs.writeFileSync(path.join(project, name), text.endsWith('\n') ? text : text + '\n', 'utf8')
    written.push(name)
  }
  return written
}
