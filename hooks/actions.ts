// What the PM does: who this session is, reading the other sessions, the
// files each session and project keep, claiming a project, and the PM's tools.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult } from 'claude-code'

import type { CiCheck, LastWord, LedgerItem, Me, Notice, ProjectFile, PushCheck, Scope, Session, Sessions, Track } from '../types'
import {
  boardText,
  betterCi,
  ciTargets,
  ciVerdict,
  ciWords,
  clip,
  deliveryText,
  emptyProject,
  groupProjects,
  hasReport,
  isBehind,
  isCiPending,
  isPushedContent,
  isScratch,
  itemCode,
  keyFile,
  latestWords,
  leftOf,
  liveTracks,
  openSteps,
  ownCommitOf,
  parseLastWord,
  parseSessions,
  projectKey,
  projectName,
  projectPath,
  statusOf,
  undeliveredOf,
} from './sessions'
import type { CiRun, Project, Status } from './sessions'
import { t } from './messages'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)
const sessions = atom({ plugin: 'project-pm', key: 'sessions' } as const, { list: [], fetchedAt: 0, error: null } as Sessions)
const tracks = atom({ plugin: 'project-pm', key: 'tracks' } as const, {} as Record<string, Track>)
const lastWords = atom({ plugin: 'project-pm', key: 'lastWords' } as const, {} as Record<string, LastWord>)
const ciChecks = atom({ plugin: 'project-pm', key: 'ciChecks' } as const, {} as Record<string, CiCheck>)
const pushChecks = atom({ plugin: 'project-pm', key: 'pushChecks' } as const, {} as Record<string, PushCheck>)
const projects = atom({ plugin: 'project-pm', key: 'projects' } as const, {} as Record<string, ProjectFile>)
const confirm = atom({ plugin: 'project-pm', key: 'confirm' } as const, null as string | null)
const busy = atom({ plugin: 'project-pm', key: 'busy' } as const, null as string | null)
const notice = atom({ plugin: 'project-pm', key: 'notice' } as const, null as Notice | null)
const isBandHidden = atom({ plugin: 'project-pm', key: 'isBandHidden' } as const, false)
const scope = atom({ plugin: 'project-pm', key: 'scope' } as const, 'project' as Scope)

export const MGMT = 'ccd_session_mgmt'
export const STARTER = 'ccd_session'
export const PANE = 'project-pm'
export const POLL_MS = 30_000
export const STUCK_MS = 20_000
export const WORDS_PER_ROUND = 8
/** GitHub lookups per refresh, and how long each command may take: the board waits on them. */
export const CI_CHECKS_PER_ROUND = 3
export const GIT_TIMEOUT_MS = 4_000
export const GH_TIMEOUT_MS = 8_000
/**
 * How soon an answer is asked again: a pass stands, a failure may be re-run, a running CI moves on. Unknown (no run
 * GitHub knows of, no gh, no network) seldom changes by the minute: asked every minute, it cost a `gh` or three each
 * time for as long as the words stood.
 */
const CI_RECHECK_MS: Record<CiCheck['state'], number> = { success: Infinity, failure: 5 * 60_000, pending: 60_000, unknown: 10 * 60_000 }
/** Put in a new PM session's brief: the session that reads it claims its project. */
export const CLAIM = '[project-pm:claim]'
export const BOARD_TOOL = 'mcp__project-pm__board'
export const LEDGER_TOOL = 'mcp__project-pm__ledger'

export function textOf(result: McpToolResult): string {
  return result.content
    .map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim()
}

export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── Files: one per session (written by that session alone) and one per project ──

export async function dataDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'

  return `${home.replace(/\\/g, '/')}/.claude/project-pm`
}

export async function readJson<T>($: EngineInterface, path: string): Promise<T | null> {
  try {
    if (!(await $.fs.exists(path))) return null

    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return null
  }
}

export async function loadProject($: EngineInterface, key: string, name: string, path: string): Promise<ProjectFile> {
  const file = await readJson<ProjectFile>($, `${await dataDir($)}/projects/${keyFile(key)}.json`)

  return file ? { ...emptyProject(key, name, path), ...file } : emptyProject(key, name, path)
}

export async function saveProject($: EngineInterface, project: ProjectFile) {
  await $.fs.write(`${await dataDir($)}/projects/${keyFile(project.key)}.json`, JSON.stringify(project, null, 2))
  await update($, projects, all => ({ ...all, [project.key]: project }))
}

/** This session's own track, kept in the module and mirrored to its file. */
let mine: Track | null = null

export function getMine(): Track | null {
  return mine
}

export async function saveMine($: EngineInterface) {
  if (!mine) return
  const track = mine
  try {
    await $.fs.write(`${await dataDir($)}/sessions/${track.id}.json`, JSON.stringify(track))
  } catch (err) {
    $.ui.log(t('log.cannotWrite', { reason: reason(err) }))
  }
}

/** When this session last asked the app who it is, so an unknown session asks again at most every 30 s. */
let identifiedAt = 0

export async function changeMine($: EngineInterface, change: (track: Track) => Track) {
  if (!mine) {
    // A session the app did not know yet at its start (or a module that just reloaded) asks again.
    const now = await $.clock.now()
    if (now - identifiedAt >= 30_000) {
      identifiedAt = now
      try {
        await identify($)
      } catch (err) {
        $.ui.log(`project-pm: ${reason(err)}`)
      }
    }
  }
  if (!mine) return
  mine = change(mine)
  await saveMine($)
}

// ── Who this session is ──

/**
 * Loads this session's track into the module. `me` is the host's and outlives a
 * reload of the module; `mine` does not, so each reload loads it again.
 */
async function loadMine($: EngineInterface, id: string, title: string, cwd: string) {
  if (mine?.id === id) return
  const kept = await readJson<Track>($, `${await dataDir($)}/sessions/${id}.json`)
  const base = kept ?? { id, title, cwd, plan: [], recap: null, ask: null, lastPrompt: '', lastAnswer: '', turnAt: 0, planAt: 0 }
  mine = { ...base, title: title || base.title, cwd: cwd || base.cwd }
  await saveMine($)
}

export async function identify($: EngineInterface): Promise<Me | null> {
  const known = await read($, me)
  if (known?.id) {
    await loadMine($, known.id, known.title, mine?.cwd ?? known.projectPath)

    return known
  }
  let id: string | null = null
  let title = ''
  let cwd = await $.session.cwd()
  try {
    const result = await $.mcp.call(MGMT, 'get_session', { session_id: 'self' })
    if (!result.isError) {
      const o = JSON.parse(textOf(result)) as Record<string, unknown>
      if (typeof o.sessionId === 'string') id = o.sessionId
      if (typeof o.title === 'string') title = o.title
      if (typeof o.cwd === 'string' && o.cwd) cwd = o.cwd
    }
  } catch {
    // Outside the desktop app there is no session id: this session is not tracked.
  }
  if (id) await rememberTranscript($, id)
  // A session the app has just resumed gets its tools only once the person looks at it: its transcript says who it is.
  else id = await transcriptOwner($)
  const key = projectKey(cwd)
  const project = await loadProject($, key, projectName(cwd), projectPath(cwd))
  if (!sameJson((await read($, projects))[key], project)) await update($, projects, all => ({ ...all, [key]: project }))
  const found: Me = {
    id,
    title,
    projectKey: key,
    projectName: projectName(cwd),
    projectPath: projectPath(cwd),
    isScratch: isScratch(cwd),
    isPm: !!id && project.pmId === id,
  }
  if (!sameJson(known, found)) await update($, me, () => found)
  if (id) await loadMine($, id, title, cwd)

  return found
}

/** Whether two values hold the same data: a write of the same value would redraw the board for nothing. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** How many transcripts the file of desktop ids keeps, the latest last. */
const TRANSCRIPTS_KEPT = 300

/** The file that says which desktop session each transcript (`$.session.id()`) belongs to. */
async function transcriptsFile($: EngineInterface): Promise<string> {
  return `${await dataDir($)}/transcripts.json`
}

/** Keeps this process's transcript under its desktop id, so a later process of the same session knows it at once. */
async function rememberTranscript($: EngineInterface, id: string) {
  try {
    const transcript = await $.session.id()
    const path = await transcriptsFile($)
    const all = (await readJson<Record<string, string>>($, path)) ?? {}
    if (all[transcript] === id) return
    delete all[transcript]
    const kept = Object.entries({ ...all, [transcript]: id }).slice(-TRANSCRIPTS_KEPT)
    await $.fs.write(path, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Knowing it sooner is a nicety: the app's tools still say who this is.
  }
}

/** The desktop id this process's transcript was last seen under, or null. */
async function transcriptOwner($: EngineInterface): Promise<string | null> {
  try {
    return (await readJson<Record<string, string>>($, await transcriptsFile($)))?.[await $.session.id()] ?? null
  } catch {
    return null
  }
}

// ── Reading the other sessions ──

let fetchingSince = 0
const trackSeen = new Map<string, number>()
/** Each session's status at the last refresh, so the PM hears about a change once. */
let statusesBefore: Map<string, Status> | null = null

export async function readLastWord($: EngineInterface, one: Session): Promise<LastWord> {
  try {
    const result = await $.mcp.call(MGMT, 'list_events', { session_id: one.id, limit: 12 })
    const text = textOf(result)
    if (result.isError) return { said: '', isAsking: false, isWaiting: false, activity: one.lastActivityAt, error: text || t('error.noTranscript') }

    return parseLastWord(text, one.lastActivityAt)
  } catch (err) {
    return { said: '', isAsking: false, isWaiting: false, activity: one.lastActivityAt, error: reason(err) }
  }
}

export async function readTracks($: EngineInterface, list: Session[]) {
  const dir = `${await dataDir($)}/sessions`
  let entries: { name: string; mtimeMs: number }[] = []
  try {
    entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  } catch {
    entries = []
  }
  const wanted = new Set(list.map(s => s.id))
  const fresh: Record<string, Track> = {}
  for (const entry of entries) {
    const id = entry.name.replace(/\.json$/, '')
    if (!wanted.has(id) || trackSeen.get(id) === entry.mtimeMs) continue
    const track = await readJson<Track>($, `${dir}/${entry.name}`)
    // An empty track would hide the transcript's last word: leave it out until it holds a report.
    if (hasReport(track)) {
      fresh[id] = track
      trackSeen.set(id, entry.mtimeMs)
    }
  }
  const held = await read($, tracks)
  const isStale = Object.entries(held).some(([id, track]) => !wanted.has(id) || !hasReport(track))
  if (Object.keys(fresh).length === 0 && !isStale) return
  await update($, tracks, all => {
    // Held values outlive a reload of the module: an empty track kept from before goes too.
    const kept = Object.fromEntries(Object.entries(all).filter(([id, track]) => wanted.has(id) && hasReport(track)))

    return { ...kept, ...fresh }
  })
}

/** Reads the last word of sessions untracked, or tracked but behind, that did something since they were last read. */
export async function catchUp($: EngineInterface, list: Session[], asked = list) {
  const known = await read($, lastWords)
  const tracked = await read($, tracks)
  const isUnread = (one: Session) => !tracked[one.id] || isBehind(one, tracked[one.id]!)
  const stale = asked.filter(one => isUnread(one) && known[one.id]?.activity !== one.lastActivityAt).slice(0, WORDS_PER_ROUND)
  if (stale.length === 0) return
  const fresh: Record<string, LastWord> = {}
  for (const one of stale) fresh[one.id] = await readLastWord($, one)
  await update($, lastWords, all => {
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => list.some(s => s.id === id)))

    return { ...kept, ...fresh }
  })
}

// ── Asking GitHub about CI a session left running ──

async function run($: EngineInterface, argv: string[], cwd: string, timeoutMs: number): Promise<string | null> {
  try {
    const out = await $.process.run(argv, { cwd, timeoutMs })

    return out.exitCode === 0 ? out.stdout.trim() : null
  } catch {
    // No such folder, no git or gh, or too slow: GitHub stays unasked.
    return null
  }
}

/**
 * What GitHub says about the CI `text` left running in `cwd`: the run it names, else the commit it
 * names, else the folder's HEAD when that commit is no newer than the words (`saidAt`).
 */
/** How many named runs and commits one check tries before it falls back to the folder's HEAD. */
const CI_CANDIDATES = 3

/** A named run's answer and the commit it ran on (a failed or called-off run hands its commit over). */
async function askRun($: EngineInterface, cwd: string, id: string): Promise<{ state: CiCheck['state']; sha: string | null }> {
  const out = await run($, ['gh', 'run', 'view', id, '--json', 'status,conclusion,workflowName,headSha'], cwd, GH_TIMEOUT_MS)
  try {
    const one = out === null ? null : (JSON.parse(out) as CiRun & { headSha?: string })

    return one ? { state: ciVerdict([one]), sha: typeof one.headSha === 'string' ? one.headSha : null } : { state: 'unknown', sha: null }
  } catch {
    return { state: 'unknown', sha: null }
  }
}

async function askCommit($: EngineInterface, cwd: string, sha: string): Promise<CiCheck['state']> {
  const out = await run($, ['gh', 'run', 'list', '--commit', sha, '--limit', '20', '--json', 'status,conclusion,workflowName'], cwd, GH_TIMEOUT_MS)
  try {
    const runs: unknown = out === null ? null : JSON.parse(out)

    return Array.isArray(runs) ? ciVerdict(runs as CiRun[]) : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** How many remote branch tips holding a commit are asked about with it. */
const CI_TIPS = 2

/**
 * A commit's answer, with that of each remote branch tip that holds it: newer work on the same branch
 * (a fix pushed after it, someone's later commit) answers for it too, the better answer standing (betterCi).
 */
async function askCommitOrNewer($: EngineInterface, cwd: string, sha: string): Promise<{ target: string; state: CiCheck['state'] }> {
  let best = { target: `commit ${sha.slice(0, 7)}`, state: await askCommit($, cwd, sha) }
  if (best.state === 'success') return best
  const tips = ((await run($, ['git', 'for-each-ref', '--contains', sha, '--format=%(objectname)', 'refs/remotes'], cwd, GIT_TIMEOUT_MS)) ?? '')
    .split('\n')
    .filter((tip, i, all) => tip && tip !== sha && all.indexOf(tip) === i)
  for (const tip of tips.slice(0, CI_TIPS)) {
    const state = await askCommit($, cwd, tip)
    if (betterCi(state, best.state) === state && state !== best.state) best = { target: `commit ${tip.slice(0, 7)}`, state }
  }

  return best
}

/**
 * What GitHub says about the CI `text` left running in `cwd`.
 *
 * A named run that passed or still runs answers. Otherwise the commits the words name (likeliest first,
 * only those in this repository; a failed or called-off run's own commit among them) are asked, each with
 * the remote branch tips that hold it, skipping one that another named commit holds: when the words tell
 * of commit A and then its fix B, B is the newer word. When none answers, the folder's HEAD, when committed
 * no later than the words.
 */
export async function askCi($: EngineInterface, cwd: string, text: string, saidAt: number): Promise<Omit<CiCheck, 'words' | 'checkedAt'>> {
  if (!cwd) return { target: '', state: 'unknown' }
  const named = ciTargets(text)
  let first = ''
  const handed: string[] = []
  for (const id of named.runs.slice(0, CI_CANDIDATES)) {
    const { state, sha } = await askRun($, cwd, id)
    if (state === 'success' || state === 'pending') return { target: `run ${id}`, state }
    if (sha) handed.push(sha)
    else if (state !== 'unknown') return { target: `run ${id}`, state }
    first ||= `run ${id}`
  }
  const commits: string[] = []
  for (const short of [...handed, ...named.shas.slice(0, CI_CANDIDATES)]) {
    const sha = await run($, ['git', 'rev-parse', '--verify', '--quiet', `${short}^{commit}`], cwd, GIT_TIMEOUT_MS)
    if (sha && !commits.includes(sha)) commits.push(sha)
  }
  // `merge-base --is-ancestor` answers by its exit code alone: run's '' is yes, null is no.
  const isHeldBy = async (older: string, newer: string) => (await run($, ['git', 'merge-base', '--is-ancestor', older, newer], cwd, GIT_TIMEOUT_MS)) !== null
  const latest: string[] = []
  for (const sha of commits) {
    let isOlder = false
    for (const other of commits) if (other !== sha && (await isHeldBy(sha, other))) isOlder = true
    if (!isOlder) latest.push(sha)
  }
  let failed: { target: string; state: CiCheck['state'] } | null = null
  for (const sha of latest) {
    const answer = await askCommitOrNewer($, cwd, sha)
    if (answer.state === 'success' || answer.state === 'pending') return answer
    if (answer.state === 'failure') failed ??= answer
    first ||= answer.target
  }
  if (failed) return failed
  const head = await run($, ['git', 'log', '-1', '--format=%H %ct'], cwd, GIT_TIMEOUT_MS)
  const [full, at] = head?.split(' ') ?? []
  // A HEAD committed after the words is not the commit they waited on.
  if (full && Number(at) * 1000 <= saidAt) {
    const state = await askCommit($, cwd, full)
    if (state !== 'unknown') return { target: `commit ${full.slice(0, 7)}`, state }
    first ||= `commit ${full.slice(0, 7)}`
  }

  return { target: first, state: 'unknown' }
}

/** The check standing for these words, asking GitHub again when the last answer is too old to stand. */
export async function checkCi($: EngineInterface, id: string, cwd: string, text: string, saidAt: number): Promise<CiCheck> {
  const now = await $.clock.now()
  const held = (await read($, ciChecks))[id]
  if (held && held.words === text && now - held.checkedAt < CI_RECHECK_MS[held.state]) return held
  const check: CiCheck = { ...(await askCi($, cwd, text, saidAt)), words: text, checkedAt: now }
  await update($, ciChecks, all => ({ ...all, [id]: check }))

  return check
}

let isCheckingCi = false

/** Asks GitHub about the CI each idle session's latest words left running, a few per refresh. */
export async function verifyCi($: EngineInterface, list: Session[], candidates = list) {
  if (isCheckingCi) return
  isCheckingCi = true
  try {
    const all = liveTracks(list, await read($, tracks), await read($, lastWords))
    const words = await read($, lastWords)
    const held = await read($, ciChecks)
    const now = await $.clock.now()
    let asked = 0
    for (const one of candidates) {
      if (one.isRunning) continue
      const text = ciWords(all[one.id], words[one.id])
      if (!isCiPending(text)) continue
      const known = held[one.id]
      if (known && known.words === text && now - known.checkedAt < CI_RECHECK_MS[known.state]) continue
      if (asked >= CI_CHECKS_PER_ROUND) break
      asked += 1
      await checkCi($, one.id, one.cwd, text, all[one.id]?.turnAt || Date.parse(one.lastActivityAt) || now)
    }
    // Checks for sessions gone from the list go too.
    if (Object.keys(held).some(id => !list.some(one => one.id === id))) {
      await update($, ciChecks, c => Object.fromEntries(Object.entries(c).filter(([id]) => list.some(one => one.id === id))))
    }
  } finally {
    isCheckingCi = false
  }
}

// ── Asking git about the commit and push the words leave ──

/**
 * What git says of the commit and push the words leave, read-only in `cwd`, no fetch: whether the folder has
 * uncommitted changes, and whether the commit the words name (or its content, rebased or squashed) or, with none
 * named, a clean folder's HEAD is on a remote-tracking branch. Facts only settle: a dirty folder adds nothing the
 * words did not say (a shared folder holds other sessions' changes).
 */
export async function checkPush($: EngineInterface, id: string, cwd: string, text: string): Promise<PushCheck | undefined> {
  const left = undeliveredOf(text)
  const own = ownCommitOf(text)
  if (!cwd || (!own && !left?.kinds.some(kind => kind === 'commit' || kind === 'push'))) return undefined
  const now = await $.clock.now()
  const held = (await read($, pushChecks))[id]
  // Settled stays settled; not yet is asked again after a minute.
  if (held && held.words === text && ((held.isPushed && held.isClean) || now - held.checkedAt < 60_000)) return held
  const git = (args: string[]) => run($, ['git', ...args], cwd, GIT_TIMEOUT_MS)
  // No index refresh: another session's folder is read, never written.
  const isClean = (await git(['--no-optional-locks', 'status', '--porcelain'])) === ''
  const sha = own ?? left?.sha ?? null
  // A hash of another repository, or none at all, says nothing here.
  const isHere = !!sha && !!(await git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]))
  const isPushed = isHere ? await isPushedContent(git, sha) : !sha && isClean && !!(await git(['branch', '-r', '--contains', 'HEAD']))
  const check: PushCheck = { words: text, sha: sha ?? '', isPushed, isClean, isOwn: isHere && sha === own, checkedAt: now }
  await update($, pushChecks, all => ({ ...all, [id]: check }))

  return check
}

/** Asks git about each idle session whose latest words leave a commit or a push. */
export async function verifyPushes($: EngineInterface, list: Session[], asked = list) {
  const words = await read($, lastWords)
  const all = liveTracks(list, await read($, tracks), words)
  for (const one of asked) {
    if (!one.isRunning) await checkPush($, one.id, one.cwd, ciWords(all[one.id], words[one.id]))
  }
  const held = await read($, pushChecks)
  if (Object.keys(held).some(id => !list.some(one => one.id === id))) {
    await update($, pushChecks, c => Object.fromEntries(Object.entries(c).filter(([id]) => list.some(one => one.id === id))))
  }
}

/** Each project file's mtime when it was last read: an unchanged file is not read again. */
const projectSeen = new Map<string, number>()

export async function readProjects($: EngineInterface, list: Session[]) {
  const seen = new Map<string, { name: string; path: string }>()
  for (const one of list) seen.set(projectKey(one.cwd), { name: projectName(one.cwd), path: projectPath(one.cwd) })
  const self = await read($, me)
  if (self) seen.set(self.projectKey, { name: self.projectName, path: self.projectPath })
  const dir = `${await dataDir($)}/projects`
  let mtimes = new Map<string, number>()
  try {
    if (await $.fs.exists(dir)) mtimes = new Map((await $.fs.list(dir)).map(entry => [entry.name, entry.mtimeMs]))
  } catch {
    // Read each one, as before.
  }
  const held = await read($, projects)
  const loaded: Record<string, ProjectFile> = {}
  for (const [key, at] of seen) {
    const name = `${keyFile(key)}.json`
    const mtime = mtimes.get(name)
    const kept = held[key]
    if (kept && mtime !== undefined && projectSeen.get(name) === mtime) loaded[key] = kept
    // No file yet: a project nobody has claimed.
    else if (mtimes.size > 0 && mtime === undefined) loaded[key] = emptyProject(key, at.name, at.path)
    else {
      loaded[key] = await loadProject($, key, at.name, at.path)
      if (mtime !== undefined) projectSeen.set(name, mtime)
    }
  }
  if (!sameJson(held, loaded)) await update($, projects, () => loaded)
  if (self) {
    const isPm = !!self.id && loaded[self.projectKey]?.pmId === self.id
    if (isPm !== self.isPm) await update($, me, m => (m ? { ...m, isPm } : m))
  }
}

/** Tells the PM, once, when one of its project's sessions starts waiting on the person or stops with steps left. */
export async function announce($: EngineInterface) {
  const self = await read($, me)
  if (!self?.isPm) return
  const state = await read($, sessions)
  const words = await read($, lastWords)
  const all = liveTracks(state.list, await read($, tracks), words)
  const ci = await read($, ciChecks)
  const push = await read($, pushChecks)
  const now = await $.clock.now()
  const now_ = new Map<string, Status>()
  for (const one of state.list) {
    if (projectKey(one.cwd) !== self.projectKey) continue
    now_.set(one.id, statusOf(one, all[one.id], words[one.id], now, ci[one.id], push[one.id]))
  }
  const before = statusesBefore
  statusesBefore = now_
  if (!before) return
  for (const [id, status] of now_) {
    if (before.get(id) === status) continue
    const title = state.list.find(s => s.id === id)?.title ?? id
    if (status === 'asking') $.ui.toast(t('toast.asking', { title }))
    if (status === 'failed') $.ui.toast(t('toast.failed', { title }))
    if (status === 'unreleased') $.ui.toast(t('toast.unreleased', { title }))
    if (status === 'open') $.ui.toast(t('toast.open', { title, n: openSteps(all[id]).length }))
  }
}

/** How soon a refresh the app's tools could not answer tries again, and how many times: a resumed session gets them once the person looks at it. */
const RETRY_MS = 3_000
const RETRIES = 20
let retriesLeft = RETRIES

/**
 * One round: the sessions the app lists, their files and last words, and what git and GitHub say about the
 * work their words left. Only this session's project is asked about, unless `isWide` (the board tool's every
 * project, a ledger owner's work) or the board shows every project: each PM asks about its own.
 */
export async function refresh($: EngineInterface, isForced = false, isWide = false) {
  const self = await read($, me)
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  const isPaneOpen = pane !== undefined
  if (!isForced && !self?.isPm && !isPaneOpen) return
  await ensureTools($)
  const started = Date.now()
  if (fetchingSince && started - fetchingSince < STUCK_MS) return
  fetchingSince = started
  try {
    const result = await $.mcp.call(MGMT, 'list_sessions', { limit: 100 })
    const text = textOf(result)
    if (result.isError) throw new Error(text || t('error.listFailed'))
    const list = parseSessions(text)
    retriesLeft = RETRIES
    const held = await read($, sessions)
    // The same list as before is no news: the board is drawn again for it only while it is on screen, where
    // its times (synced, last active) move on.
    const isNews = !sameJson(held.list, list) || held.error !== null || held.fetchedAt === 0
    if (isNews || (pane?.isShown && pane.isPlaced)) await update($, sessions, () => ({ list, fetchedAt: started, error: null }))
    const isEvery = isWide || !self || (isPaneOpen && (await read($, scope)) === 'all')
    const asked = isEvery ? list : list.filter(one => projectKey(one.cwd) === self.projectKey)
    await readTracks($, list)
    await readProjects($, list)
    await catchUp($, list, asked)
    await verifyCi($, list, asked)
    await verifyPushes($, list, asked)
    await announce($)
    await saveRound($)
  } catch (err) {
    const message = reason(err)
    await update($, sessions, s => (s.error === message ? s : { ...s, error: message }))
    if (retriesLeft > 0) {
      retriesLeft -= 1
      refreshSoon($, RETRY_MS)
    }
  } finally {
    if (fetchingSince === started) fetchingSince = 0
  }
}

// ── The last round, kept for the next process ──

/** What a round found, so a new process of this session draws the board at once, not "syncing" until a round ends. */
type Round = { sessions: Sessions; lastWords: Record<string, LastWord>; ciChecks: Record<string, CiCheck>; pushChecks: Record<string, PushCheck> }

/** The round last written, so an unchanged one is not written again. */
let roundWritten = ''

async function roundFile($: EngineInterface): Promise<string | null> {
  const id = (await read($, me))?.id

  return id ? `${await dataDir($)}/rounds/${id}.json` : null
}

async function saveRound($: EngineInterface) {
  const path = await roundFile($)
  if (!path) return
  const round: Round = { sessions: await read($, sessions), lastWords: await read($, lastWords), ciChecks: await read($, ciChecks), pushChecks: await read($, pushChecks) }
  const text = JSON.stringify({ ...round, sessions: { ...round.sessions, fetchedAt: 0 } })
  if (text === roundWritten) return
  roundWritten = text
  try {
    await $.fs.write(path, JSON.stringify(round))
  } catch {
    // The next process waits for its first round instead.
  }
}

/** Draws from the last round this session kept while a new process has none of its own yet. */
export async function loadRound($: EngineInterface) {
  if ((await read($, sessions)).fetchedAt !== 0) return
  const path = await roundFile($)
  const round = path ? await readJson<Round>($, path) : null
  if (!round?.sessions?.list) return
  await update($, sessions, s => (s.fetchedAt !== 0 ? s : { ...round.sessions, error: null }))
  await update($, lastWords, all => ({ ...round.lastWords, ...all }))
  await update($, ciChecks, all => ({ ...round.ciChecks, ...all }))
  await update($, pushChecks, all => ({ ...round.pushChecks, ...all }))
}

export function refreshSoon($: EngineInterface, ms = 0) {
  // Nowhere to report once this copy of the module is gone (a reload).
  $.clock.after(ms, () => void refresh($).catch(() => undefined))
}

// ── Being the PM ──

/** The PM's instructions, in the language the mod speaks now. */
export const ROLE = (self: Me) => t('role.text', { project: self.projectName, path: self.projectPath, board: BOARD_TOOL, ledger: LEDGER_TOOL })

/**
 * What a session of a project with a PM is asked to say at its end, so the board need not guess a release from its
 * words (declaredOf): null for the PM itself, a scratch folder, and a project nobody has claimed, whose sessions
 * are told nothing.
 */
export async function deliveryAsk($: EngineInterface): Promise<string | null> {
  const self = await read($, me)
  if (!self || self.isPm || self.isScratch) return null
  const project = (await read($, projects))[self.projectKey]
  if (!project?.pmId || project.isDismissed) return null

  return t('role.delivery', { project: self.projectName })
}

/**
 * Puts the PM's tools back when the engine has dropped them: a reload of the module (/reload-plugins,
 * or a change to the mod's folder, reloaded just before one of its commands runs) drops the tools the
 * copy before it registered, sometimes after the new copy registered them again.
 */
export async function ensureTools($: EngineInterface) {
  const self = await read($, me)
  if (!self?.isPm) return
  try {
    const names = new Set((await $.tool.list()).map(tool => tool.name))
    if (names.has(BOARD_TOOL) && names.has(LEDGER_TOOL)) return
    await registerTools($)
  } catch (err) {
    $.ui.log(t('log.cannotRegister', { reason: reason(err) }))
  }
}

// ── The board pane ──

/** A pane the poll brought back and that closed again at once waits this long, or for the person's next prompt. */
const REOPEN_MS = 5 * 60_000
/** When the poll last brought the board back. */
let reopenedAt = 0

/**
 * Whether this session's board should be up: what the person last did with it (/board, the pane's close), kept in
 * the session's file so it outlives a reload of the module and a restart of the session's process; with nothing said
 * yet, up for the PM.
 */
export function isBoardWanted(self: Me | null): boolean {
  return getMine()?.isBoardOpen ?? !!self?.isPm
}

/**
 * Whether a close of a pane keeps the board closed: the person's (the pane's close mark or key, the app closing it)
 * and /board's own. Not the engine's unload, which drops a pane nothing draws any more.
 */
export function closesBoard(e: { id: string; origin: { kind: string } }): boolean {
  return e.id === PANE && e.origin.kind !== 'unload'
}

/** Keeps what the person did with the board. */
export async function rememberBoard($: EngineInterface, isOpen: boolean) {
  await changeMine($, t => (t.isBoardOpen === isOpen ? t : { ...t, isBoardOpen: isOpen }))
}

export async function openBoard($: EngineInterface, self: Me | null) {
  const title = self?.isPm ? t('pane.titlePm', { project: self.projectName }) : self ? t('pane.titleBoard', { project: self.projectName }) : t('pane.titleBoardNone')

  return $.ui.open({ id: PANE, title })
}

/**
 * Brings the board back when it should be up and is not. The panes are the session's process's: when the desktop app
 * stops an idle session (under memory pressure) and resumes it later, the new process starts with none; and a pane
 * the engine drops (an unload) goes without a word to the hooks. The person's own close is kept and stays closed.
 *
 * `start` is a new process or copy of the module; `prompt` the person's input, which also places a pane left
 * undrawn (an open nobody asked for waits on a narrow window); `poll` the timer, which tries once in REOPEN_MS so a
 * pane that cannot be drawn is not opened over and over.
 */
export async function ensureBoard($: EngineInterface, why: 'start' | 'prompt' | 'poll') {
  const self = await identify($)
  if (!isBoardWanted(self)) return
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane && (pane.isPlaced || why !== 'prompt')) return
  if (why === 'poll') {
    const now = await $.clock.now()
    if (now - reopenedAt < REOPEN_MS) return
    reopenedAt = now
  }
  await openBoard($, self)
}

export async function registerTools($: EngineInterface) {
  await $.tool.register({
    name: 'board',
    description: t('tool.board.description'),
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'all'], description: t('tool.board.scope') },
        include_done: { type: 'boolean', description: t('tool.board.includeDone') },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'ledger',
    description: t('tool.ledger.description'),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'list'] },
        id: { type: 'number', description: t('tool.ledger.id') },
        text: { type: 'string', description: t('tool.ledger.text') },
        owner: { type: 'string', description: t('tool.ledger.owner') },
        status: { type: 'string', enum: ['open', 'done', 'dropped'] },
        note: { type: 'string', description: t('tool.ledger.note') },
        force: { type: 'boolean', description: t('tool.ledger.force') },
      },
      required: ['action'],
    },
    isDeferred: false,
  })
}

export async function claim($: EngineInterface): Promise<string> {
  const self = await identify($)
  if (!self?.id) return t('claim.noId')
  if (self.isScratch) return t('claim.scratch')
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  const before = project.pmId
  await saveProject($, { ...project, pmId: self.id, isDismissed: false })
  await update($, me, m => (m ? { ...m, isPm: true } : m))
  await registerTools($)
  statusesBefore = null
  await rememberBoard($, true)
  await openBoard($, { ...self, isPm: true })
  refreshSoon($)

  return before && before !== self.id ? t('claim.tookOver', { project: self.projectName, before }) : t('claim.done', { project: self.projectName })
}

export async function release($: EngineInterface): Promise<string> {
  const self = await read($, me)
  if (!self?.isPm) return t('release.notPm')
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  if (project.pmId === self.id) await saveProject($, { ...project, pmId: null })
  await update($, me, m => (m ? { ...m, isPm: false } : m))

  return t('release.done', { project: self.projectName })
}

export async function startPmSession($: EngineInterface) {
  const self = await read($, me)
  if (!self) return
  await update($, busy, () => 'start-pm')
  try {
    const args: Record<string, unknown> = {
      initiation: 'user_asked',
      context: 'fresh',
      title: `${self.projectName} · PM`,
      name: 'pm',
      prompt: t('start.prompt', { claim: CLAIM, project: self.projectName, board: BOARD_TOOL }),
      background: t('start.background', { project: self.projectName, path: self.projectPath }),
      use_worktree: false,
    }
    // From a worktree, the PM still sits at the repository itself.
    if (mine && mine.cwd.replace(/[\\/]+$/, '') !== self.projectPath) args.cwd = self.projectPath
    const result = await $.mcp.call(STARTER, 'start_session', args)
    const text = textOf(result)
    if (result.isError) throw new Error(text || t('error.cannotStart'))
    await update($, notice, () => ({ tone: 'good', text: t('notice.pmCreated', { project: self.projectName }) }))
    await update($, isBandHidden, () => true)
  } catch (err) {
    await update($, notice, () => ({ tone: 'bad', text: t('notice.pmFailed', { reason: reason(err) }) }))
  } finally {
    await update($, busy, () => null)
  }
}

export async function dismissBand($: EngineInterface) {
  const self = await read($, me)
  await update($, isBandHidden, () => true)
  if (!self) return
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  await saveProject($, { ...project, isDismissed: true })
}

export async function archive($: EngineInterface, one: Session) {
  await update($, busy, () => one.id)
  await update($, confirm, () => null)
  try {
    const result = await $.mcp.call(MGMT, 'archive_session', { session_id: one.id, reason: t('archive.reason', { title: one.title }) })
    const text = textOf(result)
    if (result.isError || /not archived|refus|declin|denied|still working|cancel/i.test(text)) {
      await update($, notice, () => ({ tone: 'bad', text: t('notice.notArchived', { title: one.title, why: text || t('archive.refused') }) }))
    } else {
      await update($, sessions, s => ({ ...s, list: s.list.filter(e => e.id !== one.id) }))
      await update($, notice, () => ({ tone: 'good', text: t('notice.archived', { title: one.title }) }))
    }
  } catch (err) {
    await update($, notice, () => ({ tone: 'bad', text: t('notice.notArchived', { title: one.title, why: reason(err) }) }))
  } finally {
    await update($, busy, () => null)
  }
  await refresh($, true)
}

// ── The PM's tools ──

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export async function board($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const self = await identify($)
  await refresh($, true, input.scope === 'all')
  const state = await read($, sessions)
  if (state.error && state.list.length === 0) return t('board.cannotRead', { error: state.error })
  const all = await read($, tracks)
  const words = await read($, lastWords)
  const ci = await read($, ciChecks)
  const push = await read($, pushChecks)
  const files = await read($, projects)
  const now = await $.clock.now()
  const isIncludingDone = input.include_done === true
  const groups = groupProjects(state.list)
  const chosen: Project[] =
    input.scope === 'all' || !self
      ? groups
      : [groups.find(p => p.key === self.projectKey) ?? { key: self.projectKey, name: self.projectName, path: self.projectPath, sessions: [] }]

  return chosen
    .map(p =>
      boardText({
        project: { name: p.name, path: p.path },
        sessions: p.sessions,
        everyone: state.list,
        tracks: all,
        words,
        ci,
        push,
        ledger: files[p.key]?.ledger ?? [],
        now,
        isIncludingDone,
      }),
    )
    .join('\n\n---\n\n')
}

/** Why the owner's work cannot be counted done yet, or null when nothing stands in the way. */
async function ownerBlocker($: EngineInterface, ownerId: string): Promise<string | null> {
  await refresh($, true, true)
  const list = (await read($, sessions)).list
  const one = list.find(s => s.id === ownerId)
  const words = await read($, lastWords)
  const kept = (await read($, tracks))[ownerId] ?? (await readJson<Track>($, `${await dataDir($)}/sessions/${ownerId}.json`))
  const track = hasReport(kept) ? (one ? liveTracks([one], { [ownerId]: kept }, words)[ownerId] : kept) : undefined
  const title = one?.title ?? track?.title ?? ownerId
  if (!one) {
    // Gone from the list (archived): its last words still count, and GitHub and git still answer for them.
    if (!track) return null
    const said = latestWords(track)
    if (isCiPending(said)) {
      const check = await checkCi($, ownerId, track.cwd, said, track.turnAt)
      if (check.state !== 'success') {
        const why = check.state === 'failure' ? t('blocker.ciFailedOn', { target: check.target }) : t('blocker.ciRunning')

        return t('blocker.quoted', { title, why, said: clip(said, 120) })
      }
    }
    const left = leftOf(said, await checkPush($, ownerId, track.cwd, said))
    if (left.length === 0) return null

    return t('blocker.quoted', { title, why: t('blocker.undelivered', { kinds: deliveryText(left) }), said: clip(said, 120) })
  }
  await checkPush($, ownerId, one.cwd, ciWords(track, words[ownerId]))
  const status = statusOf(one, track, words[ownerId], await $.clock.now(), (await read($, ciChecks))[ownerId], (await read($, pushChecks))[ownerId])
  const said = ciWords(track, words[ownerId])
  const blocking: Partial<Record<Status, true>> = { ci: true, failed: true, unreleased: true, running: true, waiting: true, asking: true, open: true }
  if (!blocking[status]) return null
  const why = t(`blocker.why.${status as 'ci' | 'failed' | 'unreleased' | 'running' | 'waiting' | 'asking' | 'open'}`)

  return said ? t('blocker.lastReport', { title, why, said: clip(said, 120) }) : t('blocker.plain', { title, why })
}

export function ledgerText(items: LedgerItem[]): string {
  if (items.length === 0) return t('ledger.empty')

  return items
    .map(i =>
      t('ledger.row', {
        code: itemCode(i.id),
        id: i.id,
        status: i.status,
        text: i.text,
        owner: i.owner ?? t('ledger.unassigned'),
        note: i.note ? t('board.itemNote', { note: i.note }) : '',
      }),
    )
    .join('\n')
}

export async function ledger($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const self = await identify($)
  if (!self || self.isScratch) return t('ledger.noProject')
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  const now = await $.clock.now()
  const action = str(input.action)
  if (action === 'list') return ledgerText(project.ledger)
  if (action === 'add') {
    const text = str(input.text)?.trim()
    if (!text) return t('ledger.needText')
    const item: LedgerItem = {
      id: project.nextId,
      text,
      owner: str(input.owner) || null,
      status: 'open',
      note: str(input.note) ?? '',
      createdAt: now,
      updatedAt: now,
    }
    await saveProject($, { ...project, ledger: [...project.ledger, item], nextId: project.nextId + 1 })

    return `${t('ledger.added', { code: itemCode(item.id), id: item.id })}\n\n${ledgerText([...project.ledger, item])}`
  }
  if (action === 'update') {
    const id = typeof input.id === 'number' ? input.id : Number(input.id)
    const item = project.ledger.find(i => i.id === id)
    if (!item) return `${t('ledger.notFound', { id: String(input.id) })}\n\n${ledgerText(project.ledger)}`
    const status = str(input.status)
    if (status === 'done' && item.status !== 'done') {
      const owner = input.owner === undefined ? item.owner : str(input.owner) || null
      const blocker = owner ? await ownerBlocker($, owner) : null
      if (blocker && !(input.force === true && str(input.note)?.trim())) {
        return `${t('ledger.refused', { code: itemCode(id), blocker })}\n\n${ledgerText(project.ledger)}`
      }
    }
    const changed: LedgerItem = {
      ...item,
      text: str(input.text)?.trim() || item.text,
      owner: input.owner === undefined ? item.owner : str(input.owner) || null,
      status: status === 'open' || status === 'done' || status === 'dropped' ? status : item.status,
      note: str(input.note) ?? item.note,
      updatedAt: now,
    }
    const list = project.ledger.map(i => (i.id === id ? changed : i))
    await saveProject($, { ...project, ledger: list })

    return `${t('ledger.updated', { code: itemCode(id) })}\n\n${ledgerText(list)}`
  }

  return t('ledger.badAction')
}

