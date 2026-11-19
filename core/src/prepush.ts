/**
 * The hard gate in git (docs/design/v1-core.md 6.2): `project-pm check pre-push` blocks a push whose commits no QA
 * record covers, `project-pm skip "<reason>"` (typed as `git pm skip`) lets one through on the record, and the board
 * names commits that reached the remote without the check (`git push --no-verify`).
 *
 * A QA record covers its commit and every commit before it: `git rev-list <pushed> --not <remote> <QA commits>`
 * lists exactly the commits nobody checked.
 */
import { itemCode } from '../../hooks/sessions'
import type { Run } from './host'
import { GIT_TIMEOUT_MS } from './host'
import { ct } from './messages'
import type { ProjectRef } from './project'
import { changeProject, loadProject, paths, readJsonFile } from './store'
import type { CoreItem, CoreProject } from './types'
import { uuidv7 } from './identity'

const ZERO = /^0+$/

/** The commits of verdicts that let work out: a pass, or a skip with its reason; only those this repository holds. */
export async function qaCommits(project: CoreProject, cwd: string, run: Run): Promise<string[]> {
  const named = [...new Set(project.ledger.filter(i => i.qa && i.qa.commit && (i.qa.result === 'pass' || (i.qa.result === 'skipped' && i.qa.note.trim()))).map(i => i.qa!.commit!))]
  const held: string[] = []
  for (const sha of named) {
    const full = await run(['git', 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`], cwd, GIT_TIMEOUT_MS)
    if (full) held.push(full)
  }

  return held
}

/** The commits in `range` (rev-list arguments) that no QA record covers, newest first. */
export async function uncovered(project: CoreProject, cwd: string, run: Run, range: string[]): Promise<string[] | null> {
  const covers = await qaCommits(project, cwd, run)
  // `^sha` first: a --not in `range` flips every argument after it, the ^ of these too.
  const out = await run(['git', 'rev-list', ...covers.map(sha => `^${sha}`), ...range], cwd, GIT_TIMEOUT_MS * 3)
  if (out === null) return null

  return out.split('\n').filter(Boolean)
}

/** The work item a commit belongs to, from the commits recorded on items. */
export function itemOfCommit(items: CoreItem[], sha: string): CoreItem | undefined {
  return items.find(item => (item.commits ?? []).some(c => c.startsWith(sha) || sha.startsWith(c)))
}

export type PushCheck = { ok: true } | { ok: false; message: string; commits: string[] }

/** Checks git's pre-push input (`<local ref> <local sha> <remote ref> <remote sha>` per line) against the ledger. */
export async function checkPrePush(ref: ProjectRef, stdin: string, run: Run, env: NodeJS.ProcessEnv = process.env): Promise<PushCheck> {
  const project = await loadProject(ref, env)
  // A project that does not use the PM is not stopped.
  if (project.ledger.length === 0) return { ok: true }
  const left: string[] = []
  for (const line of stdin.split('\n')) {
    const [, local, , remote] = line.trim().split(/\s+/)
    if (!local || ZERO.test(local)) continue
    // The remote's tip, when this repository holds it (someone else may have pushed since the last fetch).
    const isKnown = !!remote && !ZERO.test(remote) && (await run(['git', 'cat-file', '-e', `${remote}^{commit}`], ref.cwd, GIT_TIMEOUT_MS)) !== null
    const range = isKnown ? [local, `^${remote}`] : [local, '--not', '--remotes']
    const commits = await uncovered(project, ref.cwd, run, range)
    // git cannot answer (a shallow clone, a missing object): the check stands aside rather than block on a guess.
    if (commits === null) continue
    for (const sha of commits) if (!left.includes(sha)) left.push(sha)
  }
  if (!left.length) return { ok: true }

  return { ok: false, message: blockMessage(project.ledger, left), commits: left }
}

function blockMessage(items: CoreItem[], commits: string[]): string {
  const groups = new Map<string, { item?: CoreItem; shas: string[] }>()
  for (const sha of commits) {
    const item = itemOfCommit(items, sha)
    const key = item ? String(item.id) : ''
    const group = groups.get(key) ?? { item, shas: [] }
    group.shas.push(sha)
    groups.set(key, group)
  }
  const lines = [...groups.values()].map(g =>
    g.item
      ? ct('push.lineItem', { code: itemCode(g.item.id), text: g.item.text, n: g.shas.length, sha: g.shas[0]!.slice(0, 7) })
      : ct('push.lineNone', { n: g.shas.length, sha: g.shas[0]!.slice(0, 7) }),
  )
  const first = [...groups.values()].find(g => g.item)?.item

  return ct('push.blocked', { lines: lines.join('\n'), ask: first ? ct('push.askItem', { code: itemCode(first.id) }) : ct('push.askNone') })
}

/** `skip "<reason>"`: records a skipped QA at HEAD on the item the unpushed commits belong to, or on a new item. */
export async function skipPush(ref: ProjectRef, reason: string, run: Run, env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<{ code: string; sha: string; isNew: boolean }> {
  const head = await run(['git', 'rev-parse', 'HEAD'], ref.cwd, GIT_TIMEOUT_MS)
  if (!head) throw new Error('git rev-parse HEAD failed')
  const branch = (await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], ref.cwd, GIT_TIMEOUT_MS)) || 'HEAD'
  const pending = ((await run(['git', 'rev-list', 'HEAD', '--not', '--remotes'], ref.cwd, GIT_TIMEOUT_MS * 3)) ?? '').split('\n').filter(Boolean)
  const done = await changeProject(
    ref,
    project => {
      const qa = { result: 'skipped' as const, by: 'user', at: now, note: reason, commit: head }
      const target = [head, ...pending].map(sha => itemOfCommit(project.ledger, sha)).find(Boolean)
      if (target) {
        const changed: CoreItem = { ...target, qa, updatedAt: now, updatedBy: { actor: 'user' }, rev: (target.rev ?? 0) + 1 }

        return { project: { ...project, ledger: project.ledger.map(i => (i.id === target.id ? changed : i)) }, result: { id: target.id, isNew: false } }
      }
      const item: CoreItem = {
        id: project.nextId,
        text: ct('push.unregistered', { branch, sha: head.slice(0, 7) }),
        owner: null,
        status: 'open',
        note: '',
        createdAt: now,
        updatedAt: now,
        qa,
        commits: [head],
        uid: uuidv7(now),
        createdBy: { actor: 'user' },
        updatedBy: { actor: 'user' },
        rev: 1,
      }

      return { project: { ...project, ledger: [...project.ledger, item], nextId: project.nextId + 1 }, result: { id: item.id, isNew: true } }
    },
    env,
  )

  return { code: itemCode(done!.result.id), sha: head, isNew: done!.result.isNew }
}

/**
 * Commits on the current branch's remote that no QA record covers: pushed past the check (`git push --no-verify`).
 * Only commits the remote got after init put the hook in (`baseline`, the remote branches then) and after the
 * ledger's first item (before it the project did not use the PM, and the check let everything through).
 * Null when there is no remote branch to ask about.
 */
export async function pushedUnchecked(project: CoreProject, cwd: string, run: Run, baseline: string[]): Promise<{ branch: string; commits: string[] } | null> {
  if (!project.ledger.length) return null
  let remote = await run(['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd, GIT_TIMEOUT_MS)
  if (!remote) {
    const branch = await run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], cwd, GIT_TIMEOUT_MS)
    const guess = branch ? `origin/${branch}` : null
    if (guess && (await run(['git', 'rev-parse', '--verify', '--quiet', `refs/remotes/${guess}`], cwd, GIT_TIMEOUT_MS))) remote = guess
  }
  if (!remote) return null
  const known: string[] = []
  for (const sha of baseline) if ((await run(['git', 'cat-file', '-e', `${sha}^{commit}`], cwd, GIT_TIMEOUT_MS)) !== null) known.push(`^${sha}`)
  const from = Math.min(...project.ledger.map(i => i.createdAt))
  const commits = await uncovered(project, cwd, run, [`--since=${Math.floor(from / 1000) - 1}`, ...known, remote])
  if (commits === null) return null

  return { branch: remote, commits }
}

/** The remote branches' tips now: the pre-push hook's baseline (what was pushed before it is not its business). */
export async function remoteTips(cwd: string, run: Run): Promise<string[]> {
  return ((await run(['git', 'for-each-ref', '--format=%(objectname)', 'refs/remotes'], cwd, GIT_TIMEOUT_MS)) ?? '').split('\n').filter(Boolean)
}

/** When init put this project's pre-push hook in, and the remote branches then (install-log.json); null without one. */
export async function prePushInstalled(ref: ProjectRef, env: NodeJS.ProcessEnv = process.env): Promise<{ at: number; baseline: string[] } | null> {
  const log = await readJsonFile<{ entries?: { kind?: string; project?: string; at?: number; baseline?: string[] }[] }>(paths(env).installLog).catch(() => null)
  const entry = log?.entries?.find(e => e.kind === 'prepush' && e.project === ref.key)

  return typeof entry?.at === 'number' ? { at: entry.at, baseline: Array.isArray(entry.baseline) ? entry.baseline : [] } : null
}

/** The board's text with one more line in its attention section (in place of its "none"). */
export function withAttention(text: string, line: string, heading: string, none: string): string {
  const lines = text.split('\n')
  const at = lines.indexOf(heading)
  if (at < 0) return `${text}\n\n${heading}\n${line}`
  if (lines[at + 1] === none) lines[at + 1] = line
  else lines.splice(at + 1, 0, line)

  return lines.join('\n')
}
