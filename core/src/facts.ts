/**
 * Layer 1, git and CI facts (docs/design/v1-core.md 7.1), ported from the mod's hooks/actions.ts (askRun to
 * checkPush) with the engine's process runner swapped for the core's. Answers are kept in memory: the MCP server
 * lives as long as its session and asks again only when an answer is too old to stand.
 */
import { betterCi, ciTargets, ciVerdict, isPushedContent, ownCommitOf, undeliveredOf } from '../../hooks/sessions'
import type { CiRun } from '../../hooks/sessions'
import type { CiCheck, PushCheck } from '../../types'
import type { Run } from './host'
import { GH_TIMEOUT_MS, GIT_TIMEOUT_MS } from './host'

/** How soon an answer is asked again: a pass stands, a failure may be re-run, a running CI moves on. */
const CI_RECHECK_MS: Record<CiCheck['state'], number> = { success: Infinity, failure: 5 * 60_000, pending: 60_000, unknown: 10 * 60_000 }
const CI_CANDIDATES = 3
const CI_TIPS = 2

export type Facts = {
  run: Run
  now: () => number
  ci: Map<string, CiCheck>
  push: Map<string, PushCheck>
}

export function newFacts(run: Run, now: () => number = Date.now): Facts {
  return { run, now, ci: new Map(), push: new Map() }
}

async function askRun(f: Facts, cwd: string, id: string): Promise<{ state: CiCheck['state']; sha: string | null }> {
  const out = await f.run(['gh', 'run', 'view', id, '--json', 'status,conclusion,workflowName,headSha'], cwd, GH_TIMEOUT_MS)
  try {
    const one = out === null ? null : (JSON.parse(out) as CiRun & { headSha?: string })

    return one ? { state: ciVerdict([one]), sha: typeof one.headSha === 'string' ? one.headSha : null } : { state: 'unknown', sha: null }
  } catch {
    return { state: 'unknown', sha: null }
  }
}

async function askCommit(f: Facts, cwd: string, sha: string): Promise<CiCheck['state']> {
  const out = await f.run(['gh', 'run', 'list', '--commit', sha, '--limit', '20', '--json', 'status,conclusion,workflowName'], cwd, GH_TIMEOUT_MS)
  try {
    const runs: unknown = out === null ? null : JSON.parse(out)

    return Array.isArray(runs) ? ciVerdict(runs as CiRun[]) : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function askCommitOrNewer(f: Facts, cwd: string, sha: string): Promise<{ target: string; state: CiCheck['state'] }> {
  let best = { target: `commit ${sha.slice(0, 7)}`, state: await askCommit(f, cwd, sha) }
  if (best.state === 'success') return best
  const tips = ((await f.run(['git', 'for-each-ref', '--contains', sha, '--format=%(objectname)', 'refs/remotes'], cwd, GIT_TIMEOUT_MS)) ?? '')
    .split('\n')
    .filter((tip, i, all) => tip && tip !== sha && all.indexOf(tip) === i)
  for (const tip of tips.slice(0, CI_TIPS)) {
    const state = await askCommit(f, cwd, tip)
    if (betterCi(state, best.state) === state && state !== best.state) best = { target: `commit ${tip.slice(0, 7)}`, state }
  }

  return best
}

/** What GitHub says about the CI `text` left running in `cwd` (the mod's askCi, unchanged in what it asks). */
export async function askCi(f: Facts, cwd: string, text: string, saidAt: number): Promise<Omit<CiCheck, 'words' | 'checkedAt'>> {
  if (!cwd) return { target: '', state: 'unknown' }
  const named = ciTargets(text)
  let first = ''
  const handed: string[] = []
  for (const id of named.runs.slice(0, CI_CANDIDATES)) {
    const { state, sha } = await askRun(f, cwd, id)
    if (state === 'success' || state === 'pending') return { target: `run ${id}`, state }
    if (sha) handed.push(sha)
    else if (state !== 'unknown') return { target: `run ${id}`, state }
    first ||= `run ${id}`
  }
  const commits: string[] = []
  for (const short of [...handed, ...named.shas.slice(0, CI_CANDIDATES)]) {
    const sha = await f.run(['git', 'rev-parse', '--verify', '--quiet', `${short}^{commit}`], cwd, GIT_TIMEOUT_MS)
    if (sha && !commits.includes(sha)) commits.push(sha)
  }
  const isHeldBy = async (older: string, newer: string) => (await f.run(['git', 'merge-base', '--is-ancestor', older, newer], cwd, GIT_TIMEOUT_MS)) !== null
  const latest: string[] = []
  for (const sha of commits) {
    let isOlder = false
    for (const other of commits) if (other !== sha && (await isHeldBy(sha, other))) isOlder = true
    if (!isOlder) latest.push(sha)
  }
  let failed: { target: string; state: CiCheck['state'] } | null = null
  for (const sha of latest) {
    const answer = await askCommitOrNewer(f, cwd, sha)
    if (answer.state === 'success' || answer.state === 'pending') return answer
    if (answer.state === 'failure') failed ??= answer
    first ||= answer.target
  }
  if (failed) return failed
  const head = await f.run(['git', 'log', '-1', '--format=%H %ct'], cwd, GIT_TIMEOUT_MS)
  const [full, at] = head?.split(' ') ?? []
  if (full && Number(at) * 1000 <= saidAt) {
    const state = await askCommit(f, cwd, full)
    if (state !== 'unknown') return { target: `commit ${full.slice(0, 7)}`, state }
    first ||= `commit ${full.slice(0, 7)}`
  }

  return { target: first, state: 'unknown' }
}

/** The CI answer standing for these words, held while it is fresh. */
export function heldCi(f: Facts, id: string, text: string): CiCheck | undefined {
  const held = f.ci.get(id)

  return held && held.words === text && f.now() - held.checkedAt < CI_RECHECK_MS[held.state] ? held : undefined
}

export async function checkCi(f: Facts, id: string, cwd: string, text: string, saidAt: number): Promise<CiCheck> {
  const held = heldCi(f, id, text)
  if (held) return held
  const check: CiCheck = { ...(await askCi(f, cwd, text, saidAt)), words: text, checkedAt: f.now() }
  f.ci.set(id, check)

  return check
}

/** What git says of the commit and push the words leave (the mod's checkPush): read only, no fetch. */
export async function checkPush(f: Facts, id: string, cwd: string, text: string): Promise<PushCheck | undefined> {
  const left = undeliveredOf(text)
  const own = ownCommitOf(text)
  if (!cwd || (!own && !left?.kinds.some(kind => kind === 'commit' || kind === 'push'))) return undefined
  const now = f.now()
  const held = f.push.get(id)
  if (held && held.words === text && ((held.isPushed && held.isClean) || now - held.checkedAt < 60_000)) return held
  const git = (args: string[]) => f.run(['git', ...args], cwd, GIT_TIMEOUT_MS)
  const isClean = (await git(['--no-optional-locks', 'status', '--porcelain'])) === ''
  const sha = own ?? left?.sha ?? null
  const isHere = !!sha && !!(await git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]))
  const isPushed = isHere ? await isPushedContent(git, sha) : !sha && isClean && !!(await git(['branch', '-r', '--contains', 'HEAD']))
  const check: PushCheck = { words: text, sha: sha ?? '', isPushed, isClean, isOwn: isHere && sha === own, checkedAt: now }
  f.push.set(id, check)

  return check
}
