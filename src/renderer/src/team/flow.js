// The team flow: specification → production, as in the "AI team pipeline" design.
// Agent steps write their result to files; the next step reads the files.
// Gates wait for a human. Reviews end with a VERDICT line; "changes requested"
// sends the work back to the author (max `maxRetries` times, then a human decides).

export const DEFAULT_TEAM = {
  roles: { spec: 'gemini', plan: 'claude', planReview: 'codex', impl: 'codex', codeReview: 'claude' },
  testCommand: '',
  maxRetries: 3,
  isolate: true
}

export const ROLE_KEYS = ['spec', 'plan', 'planReview', 'impl', 'codeReview']

const LANG = 'Write your reply to the user in the same language as the task (for example Georgian). Keep code, file names and identifiers in English.'

const VERDICT =
  'End your reply with exactly one final line, either `VERDICT: APPROVE` or `VERDICT: CHANGES_REQUESTED`. ' +
  'Request changes only for real problems (bugs, missing acceptance criteria, security issues), not for style preferences.'

export function buildSteps(cfg) {
  return [
    {
      id: 'spec',
      kind: 'agent',
      role: 'spec',
      output: 'docs/specs/{slug}.md',
      inputs: [],
      instruction:
        'You are the analyst. Research the requirements of the task and write a product specification: goal, users, scope (in / out), functional requirements, and for every feature clear acceptance criteria that can become tests. Do not write code.'
    },
    { id: 'g1', kind: 'gate', back: 'spec' },
    {
      id: 'plan',
      kind: 'agent',
      role: 'plan',
      output: 'docs/adr/{slug}-plan.md',
      inputs: ['spec'],
      instruction:
        'You are the architect. Read the specification and the existing code, then write a technical plan in ADR style: decision and alternatives, affected modules, data model / database schema and migrations, risks, and a breakdown into small tickets (each with size S/M/L, dependencies and acceptance criteria). Do not implement yet.'
    },
    {
      id: 'planReview',
      kind: 'review',
      role: 'planReview',
      target: 'plan',
      inputs: ['spec', 'plan'],
      instruction:
        'You are the reviewer of the technical plan (you did not write it). Check it against the specification: missing requirements, wrong data model, risky migrations, security problems, tickets that are too big or unclear.'
    },
    { id: 'g2', kind: 'gate', back: 'plan' },
    {
      id: 'impl',
      kind: 'agent',
      role: 'impl',
      output: null,
      inputs: ['spec', 'plan'],
      instruction:
        'You are the developer. Implement the plan in this project. Definition of done: code, tests for the acceptance criteria, migrations if needed and updated documentation — all in this folder. Run the tests if you can. Finish with a short list of changed files.'
    },
    { id: 'check', kind: 'check', target: 'impl', enabled: !!cfg.testCommand?.trim() },
    {
      id: 'codeReview',
      kind: 'review',
      role: 'codeReview',
      target: 'impl',
      inputs: ['spec', 'plan'],
      includeDiff: true,
      instruction:
        'You are the code reviewer (you did not write this code). Review the changes below against the specification and the plan: correctness, missing tests or acceptance criteria, security (auth, SQL, secrets, input validation), and migrations.'
    },
    { id: 'g3', kind: 'gate', back: 'impl', final: true }
  ]
}

// File-system friendly name for this feature's documents.
export function makeSlug(task) {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return words.length >= 2 ? words.join('-').slice(0, 40) : 'feature-' + stamp
}

export function outputPath(step, slug) {
  return step.output ? step.output.replace('{slug}', slug) : null
}

export function buildPrompt({ step, steps, task, slug, feedback, diff, agentName }) {
  const files = step.inputs
    .map((id) => outputPath(steps.find((s) => s.id === id), slug))
    .filter(Boolean)
  let p = `${step.instruction}\n\nYou are ${agentName}, one member of a team of AI agents working on this project.\n${LANG}\n\n## Task\n${task}`
  if (files.length) p += `\n\n## Input files (read them first)\n${files.map((f) => `- ${f}`).join('\n')}`
  if (feedback) p += `\n\n## Feedback you must address\n${feedback}`
  if (diff != null) p += `\n\n## Changes to review (git diff)\n\`\`\`diff\n${diff || '(no changes found)'}\n\`\`\``
  const out = outputPath(step, slug)
  if (out) p += `\n\n## Output\nWrite your complete result to the file \`${out}\` (create the folders if needed), then reply with a short summary.`
  if (step.kind === 'review') p += `\n\n${VERDICT}`
  return p
}

// APPROVE | CHANGES | null (unclear)
export function parseVerdict(text) {
  const m = [...(text || '').matchAll(/VERDICT:\s*\**\s*(APPROVE|CHANGES_REQUESTED|CHANGES)/gi)]
  if (!m.length) return null
  return m[m.length - 1][1].toUpperCase().startsWith('APPROVE') ? 'APPROVE' : 'CHANGES'
}
