import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getEnv } from './env'

function git(cwd, args, input) {
  return new Promise(async (resolve) => {
    const env = await getEnv()
    const child = execFile(
      'git',
      args,
      { cwd, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: String(stderr || err?.message || '').trim() })
    )
    if (input != null) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}

// Info about a folder: is git available, is it inside a repo, current branch.
export async function info(dir) {
  if (!dir || !fs.existsSync(dir)) return { git: false, repo: false }
  const v = await git(dir, ['--version'])
  if (!v.ok) return { git: false, repo: false }
  const top = await git(dir, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { git: true, repo: false }
  const head = await git(dir, ['rev-parse', '--verify', 'HEAD'])
  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return { git: true, repo: true, root: path.normalize(top.out.trim()), hasCommit: head.ok, branch: branch.out.trim() }
}

// Create an isolated worktree on a new branch from the project's HEAD.
// Worktrees live in ~/.agenthub/worktrees so they never clutter the project.
export async function createWorktree(project, agent) {
  const i = await info(project)
  if (!i.repo) throw new Error('Not a git repository')
  if (!i.hasCommit) throw new Error('The repository has no commits yet')
  const id = Math.random().toString(36).slice(2, 7)
  const name = `${path.basename(i.root)}-${agent}-${id}`.replace(/[^\w.-]/g, '_')
  const dir = path.join(os.homedir(), '.agenthub', 'worktrees', name)
  const branch = `agenthub/${agent}-${id}`
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  const base = (await git(i.root, ['rev-parse', 'HEAD'])).out.trim()
  const r = await git(i.root, ['worktree', 'add', '-b', branch, dir, 'HEAD'])
  if (!r.ok) throw new Error(r.err)
  return { path: dir, branch, base, root: i.root }
}

// Unified diff of everything changed in `dir` (tracked + untracked) against `base`.
export async function diff(dir, base = 'HEAD') {
  const i = await info(dir)
  if (!i.repo) return { ok: false, error: 'Not a git repository' }
  if (!i.hasCommit) return { ok: false, error: 'The repository has no commits yet' }
  // Mark untracked files intent-to-add so they appear in the diff (index only, no content staged).
  await git(dir, ['add', '-A', '-N'])
  const patch = await git(dir, ['diff', base, '--no-color', '--no-ext-diff'])
  const stat = await git(dir, ['diff', base, '--numstat'])
  const files = stat.out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [add, del, ...p] = l.split('\t')
      return { path: p.join('\t'), add: add === '-' ? 0 : +add, del: del === '-' ? 0 : +del }
    })
  return { ok: patch.ok, error: patch.ok ? null : patch.err, patch: patch.out, files }
}

// Copy a worktree's changes into the main project working tree (no commit).
export async function applyToProject(wt) {
  const d = await diff(wt.path, wt.base)
  if (!d.ok) return d
  if (!d.patch.trim()) return { ok: false, error: 'No changes' }
  const bin = await git(wt.path, ['diff', wt.base, '--binary', '--no-color', '--no-ext-diff'])
  // Plain apply leaves the changes unstaged; fall back to a 3-way merge if the
  // project changed meanwhile (that one stages the result).
  let r = await git(wt.root, ['apply', '--whitespace=nowarn', '-'], bin.out)
  if (!r.ok) r = await git(wt.root, ['apply', '--3way', '--whitespace=nowarn', '-'], bin.out)
  return r.ok ? { ok: true, files: d.files.length } : { ok: false, error: r.err }
}

export async function removeWorktree(wt) {
  const r = await git(wt.root, ['worktree', 'remove', '--force', wt.path])
  await git(wt.root, ['branch', '-D', wt.branch])
  if (!r.ok && fs.existsSync(wt.path)) return { ok: false, error: r.err }
  await git(wt.root, ['worktree', 'prune'])
  return { ok: true }
}
