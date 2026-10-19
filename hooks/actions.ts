// What the PM does: who this session is, reading the other sessions, the
// files each session and project keep, claiming a project, and the PM's tools.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult } from 'claude-code'

import type { CiCheck, LastWord, LedgerItem, Me, Notice, ProjectFile, PushCheck, Session, Sessions, Track } from '../types'
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
  liveTracks,
  openSteps,
  parseLastWord,
  parseSessions,
  projectKey,
  projectName,
  projectPath,
  statusOf,
  undeliveredOf,
} from './sessions'
import type { CiRun, Project, Status } from './sessions'

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
/** How soon an answer is asked again: a pass stands, a failure may be re-run, a running or unknown CI moves on. */
const CI_RECHECK_MS: Record<CiCheck['state'], number> = { success: Infinity, failure: 5 * 60_000, pending: 60_000, unknown: 60_000 }
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
    $.ui.log(`project-pm: 寫不進 Session 紀錄：${reason(err)}`)
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
  const key = projectKey(cwd)
  const project = await loadProject($, key, projectName(cwd), projectPath(cwd))
  await update($, projects, all => ({ ...all, [key]: project }))
  const found: Me = {
    id,
    title,
    projectKey: key,
    projectName: projectName(cwd),
    projectPath: projectPath(cwd),
    isScratch: isScratch(cwd),
    isPm: !!id && project.pmId === id,
  }
  await update($, me, () => found)
  if (id) await loadMine($, id, title, cwd)

  return found
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
    if (result.isError) return { said: '', isAsking: false, isWaiting: false, activity: one.lastActivityAt, error: text || '讀不到紀錄' }

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
export async function catchUp($: EngineInterface, list: Session[]) {
  const known = await read($, lastWords)
  const tracked = await read($, tracks)
  const isUnread = (one: Session) => !tracked[one.id] || isBehind(one, tracked[one.id]!)
  const stale = list.filter(one => isUnread(one) && known[one.id]?.activity !== one.lastActivityAt).slice(0, WORDS_PER_ROUND)
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
export async function verifyCi($: EngineInterface, list: Session[]) {
  if (isCheckingCi) return
  isCheckingCi = true
  try {
    const all = liveTracks(list, await read($, tracks), await read($, lastWords))
    const words = await read($, lastWords)
    const held = await read($, ciChecks)
    const now = await $.clock.now()
    let asked = 0
    for (const one of list) {
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

// ── Asking git whether a commit the words left unpushed has been pushed since ──

/**
 * Whether the push the words leave undone (and nothing else) has happened since: the commit they name, or
 * its content (rebased, squashed), is on a remote-tracking branch in `cwd`. A push from this machine moves
 * that branch; no fetch.
 */
export async function checkPush($: EngineInterface, id: string, cwd: string, text: string): Promise<PushCheck | undefined> {
  const left = undeliveredOf(text)
  if (!left?.sha || left.kinds.length !== 1 || left.kinds[0] !== 'push' || !cwd) return undefined
  const now = await $.clock.now()
  const held = (await read($, pushChecks))[id]
  // Pushed stays pushed; not yet is asked again after a minute.
  if (held && held.words === text && (held.isPushed || now - held.checkedAt < 60_000)) return held
  const isPushed = await isPushedContent(args => run($, ['git', ...args], cwd, GIT_TIMEOUT_MS), left.sha)
  const check: PushCheck = { words: text, sha: left.sha, isPushed, checkedAt: now }
  await update($, pushChecks, all => ({ ...all, [id]: check }))

  return check
}

/** Asks git about each idle session whose latest words leave only a push undone. */
export async function verifyPushes($: EngineInterface, list: Session[]) {
  const words = await read($, lastWords)
  const all = liveTracks(list, await read($, tracks), words)
  for (const one of list) {
    if (!one.isRunning) await checkPush($, one.id, one.cwd, ciWords(all[one.id], words[one.id]))
  }
  const held = await read($, pushChecks)
  if (Object.keys(held).some(id => !list.some(one => one.id === id))) {
    await update($, pushChecks, c => Object.fromEntries(Object.entries(c).filter(([id]) => list.some(one => one.id === id))))
  }
}

export async function readProjects($: EngineInterface, list: Session[]) {
  const seen = new Map<string, { name: string; path: string }>()
  for (const one of list) seen.set(projectKey(one.cwd), { name: projectName(one.cwd), path: projectPath(one.cwd) })
  const self = await read($, me)
  if (self) seen.set(self.projectKey, { name: self.projectName, path: self.projectPath })
  const loaded: Record<string, ProjectFile> = {}
  for (const [key, at] of seen) loaded[key] = await loadProject($, key, at.name, at.path)
  await update($, projects, () => loaded)
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
    if (status === 'asking') $.ui.toast(`「${title}」待你回覆`)
    if (status === 'failed') $.ui.toast(`「${title}」的 CI 失敗了`)
    if (status === 'unreleased') $.ui.toast(`「${title}」已停下，但回報尚未交付`)
    if (status === 'open') $.ui.toast(`「${title}」已停止，仍有 ${openSteps(all[id]).length} 項步驟未完成`)
  }
}

export async function refresh($: EngineInterface, isForced = false) {
  const self = await read($, me)
  const isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (!isForced && !self?.isPm && !isPaneOpen) return
  await ensureTools($)
  const started = Date.now()
  if (fetchingSince && started - fetchingSince < STUCK_MS) return
  fetchingSince = started
  try {
    const result = await $.mcp.call(MGMT, 'list_sessions', { limit: 100 })
    const text = textOf(result)
    if (result.isError) throw new Error(text || '讀取 Session 清單失敗')
    const list = parseSessions(text)
    await update($, sessions, () => ({ list, fetchedAt: started, error: null }))
    await readTracks($, list)
    await readProjects($, list)
    await catchUp($, list)
    await verifyCi($, list)
    await verifyPushes($, list)
    await announce($)
  } catch (err) {
    const message = reason(err)
    await update($, sessions, s => (s.error === message ? s : { ...s, error: message }))
  } finally {
    if (fetchingSince === started) fetchingSince = 0
  }
}

export function refreshSoon($: EngineInterface, ms = 0) {
  $.clock.after(ms, () => void refresh($))
}

// ── Being the PM ──

export const ROLE = (self: Me) => `# 你是「${self.projectName}」專案的 PM

這個 Session 是專案「${self.projectName}」（${self.projectPath}）的 PM。使用者只跟你說話，靠你確保這個專案沒有任何工作遺漏。你的工作是掌握狀況、派工、追蹤、驗收，不是自己寫程式。

規則：
1. 使用者問進度、問有沒有漏掉、或你要回報之前，先呼叫 ${BOARD_TOOL} 看最新看板，不要憑記憶回答。
2. 使用者交代新工作：先用 ${LEDGER_TOOL}（action: "add"）登記為工作項目，再決定交給現有 Session（SendMessage，to 填它的 local_… id）或開新 Session（start_session），派出後用 ledger update 填上 owner。
3. 不要自己動手改專案的程式碼；實作交給子 Session。使用者明確要你自己做時才例外。
4. CI 還在跑、還沒部署完成的工作一律不算完成：負責 Session 狀態為「等待 CI」「CI 失敗」「待發布」「執行中」「背景執行」「待回覆」或「未完成」時，ledger 會拒絕結案。
5. 一個工作項目只有在你確認對應 Session 真的做完（看板上沒有未完成步驟、收尾摘要沒提到還沒做的事，必要時用 list_events 看它的紀錄）之後，才用 ledger update 標成 done。
6. 說「都完成了」之前，看板的「需要處理」必須是空的、工作項目沒有 open；不是的話，逐條列出還差什麼。
7. 子 Session 在等使用者回覆時，把它的問題原文轉述給使用者，使用者回答後用 SendMessage 轉達回去。
8. 封存 Session 前先確認它沒有未完成步驟、沒有開著的 PR，並問過使用者。
9. 提到 Session 時用 [標題](#local_…) 連結它。`

/**
 * Puts the PM's tools back when the engine has dropped them: a reload of the module (/reload-plugins,
 * or a change to the mod's folder, reloaded just before one of its commands runs) drops the tools the
 * copy before it registered, sometimes after the new copy registered them again.
 */
export async function ensureTools($: EngineInterface) {
  const self = await read($, me)
  if (!self?.isPm) return
  try {
    const names = new Set((await $.tool.list()).map(t => t.name))
    if (names.has(BOARD_TOOL) && names.has(LEDGER_TOOL)) return
    await registerTools($)
  } catch (err) {
    $.ui.log(`project-pm: 無法重新註冊 PM 工具：${reason(err)}`)
  }
}

export async function registerTools($: EngineInterface) {
  await $.tool.register({
    name: 'board',
    description:
      '專案狀態報告：列出此專案所有子 Session 的狀態（執行中、待回覆、CI 失敗、等待 CI、待發布、中斷・未完成、背景執行、已結束；CI 狀態會用 gh 向 GitHub 確認）、任務清單進度、最新指令與收尾摘要，以及工作項目和需要處理的事項。回報進度或判斷是否有遺漏前必須先呼叫。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'all'], description: 'project（預設）只看這個專案；all 看所有專案。' },
        include_done: { type: 'boolean', description: '一併列出已結束且無待辦的 Session 與已完成的工作項目。預設 false。' },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'ledger',
    description:
      '專案 PM 的工作項目清單：使用者交代的每件工作都要登記在這裡，直到確認完成。顯示編號為 T-01 形式，操作時 id 填數字。add 新增（text 必填，owner 可填負責的 local_… Session id）；update 改 owner、status（open / done / dropped）或 note；list 列出全部。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'list'] },
        id: { type: 'number', description: 'update 時要修改的工作項目 id（T-03 填 3）' },
        text: { type: 'string', description: '工作項目內容（add 必填；update 時可改寫）' },
        owner: { type: 'string', description: '負責的 Session id（local_…）；空字串表示取消指派' },
        status: { type: 'string', enum: ['open', 'done', 'dropped'] },
        note: { type: 'string', description: '備註：進度、驗收結果、為什麼放棄' },
        force: { type: 'boolean', description: '負責 Session 仍在等 CI 或未完成時，強制結案。只有使用者明確確認時才能用，且 note 必填。' },
      },
      required: ['action'],
    },
    isDeferred: false,
  })
}

export async function claim($: EngineInterface): Promise<string> {
  const self = await identify($)
  if (!self?.id) return '無法取得此 Session 的 id（可能不在桌面版中），無法擔任 PM。'
  if (self.isScratch) return '此 Session 位於臨時資料夾，不屬於任何專案，無法擔任 PM。'
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  const before = project.pmId
  await saveProject($, { ...project, pmId: self.id, isDismissed: false })
  await update($, me, m => (m ? { ...m, isPm: true } : m))
  await registerTools($)
  statusesBefore = null
  await $.ui.open({ id: PANE, title: `${self.projectName} · PM` })
  refreshSoon($)

  return before && before !== self.id
    ? `此 Session 已接任「${self.projectName}」的 PM（原 PM：${before}）。`
    : `此 Session 已擔任「${self.projectName}」的 PM。`
}

export async function release($: EngineInterface): Promise<string> {
  const self = await read($, me)
  if (!self?.isPm) return '此 Session 目前不是 PM。'
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  if (project.pmId === self.id) await saveProject($, { ...project, pmId: null })
  await update($, me, m => (m ? { ...m, isPm: false } : m))

  return `此 Session 已卸任「${self.projectName}」的 PM；工作項目保留於專案中，由下一任 PM 接手。`
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
      prompt: `${CLAIM} 你是「${self.projectName}」專案的 PM。先呼叫 ${BOARD_TOOL} 看所有 Session 的狀態，再用幾句話向使用者報告：哪些在等他回覆、哪些停下但任務清單還有步驟、工作項目有沒有沒完成的。`,
      background: `使用者希望每個專案都有一個 PM Session：使用者只跟 PM 說話，PM 追蹤專案「${self.projectName}」（${self.projectPath}）裡所有子 Session 的工作狀態與工作項目，確保沒有工作遺漏。project-pm Mod 會在這個 Session 讀到開頭的標記時把它設成 PM，並提供看板與工作項目工具。`,
      use_worktree: false,
    }
    // From a worktree, the PM still sits at the repository itself.
    if (mine && mine.cwd.replace(/[\\/]+$/, '') !== self.projectPath) args.cwd = self.projectPath
    const result = await $.mcp.call(STARTER, 'start_session', args)
    const text = textOf(result)
    if (result.isError) throw new Error(text || '開不了新 Session')
    await update($, notice, () => ({ tone: 'good', text: `已建立 PM Session「${self.projectName} · PM」，可在側欄開啟。` }))
    await update($, isBandHidden, () => true)
  } catch (err) {
    await update($, notice, () => ({ tone: 'bad', text: `無法自動建立 PM Session（${reason(err)}）。請手動開啟新 Session 並執行 /pm。` }))
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
    const result = await $.mcp.call(MGMT, 'archive_session', { session_id: one.id, reason: `專案 PM：封存「${one.title}」` })
    const text = textOf(result)
    if (result.isError || /not archived|refus|declin|denied|still working|cancel/i.test(text)) {
      await update($, notice, () => ({ tone: 'bad', text: `「${one.title}」未封存：${text || '封存要求遭拒'}` }))
    } else {
      await update($, sessions, s => ({ ...s, list: s.list.filter(e => e.id !== one.id) }))
      await update($, notice, () => ({ tone: 'good', text: `已封存「${one.title}」，可於側欄的封存區復原。` }))
    }
  } catch (err) {
    await update($, notice, () => ({ tone: 'bad', text: `「${one.title}」未封存：${reason(err)}` }))
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
  await refresh($, true)
  const state = await read($, sessions)
  if (state.error && state.list.length === 0) return `讀不到 Session 清單：${state.error}`
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
  await refresh($, true)
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
        const why = check.state === 'failure' ? `GitHub 上的 CI（${check.target}）失敗` : '最後回報 CI 尚未跑完'

        return `負責的 Session「${title}」${why}（${clip(said, 120)}）。`
      }
    }
    const left = undeliveredOf(said)
    if (!left || (await checkPush($, ownerId, track.cwd, said))?.isPushed) return null

    return `負責的 Session「${title}」最後回報尚未交付（${deliveryText(left.kinds)}）（${clip(said, 120)}）。`
  }
  await checkPush($, ownerId, one.cwd, ciWords(track, words[ownerId]))
  const status = statusOf(one, track, words[ownerId], await $.clock.now(), (await read($, ciChecks))[ownerId], (await read($, pushChecks))[ownerId])
  const said = ciWords(track, words[ownerId])
  const why: Partial<Record<Status, string>> = {
    ci: 'CI 尚未跑完',
    failed: 'GitHub 上的 CI 失敗',
    unreleased: '最後回報尚未交付（未 commit、push 或發布）',
    running: '仍在執行中',
    waiting: '仍有背景作業在跑',
    asking: '正在等使用者回覆',
    open: '任務清單仍有未完成步驟',
  }

  return why[status] ? `負責的 Session「${title}」${why[status]}${said ? `（最後回報：${clip(said, 120)}）` : ''}。` : null
}

export function ledgerText(items: LedgerItem[]): string {
  if (items.length === 0) return '目前沒有工作項目。'

  return items.map(i => `${itemCode(i.id)} (id ${i.id}) [${i.status}] ${i.text}｜負責：${i.owner ?? '未指派'}${i.note ? `｜備註：${i.note}` : ''}`).join('\n')
}

export async function ledger($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const self = await identify($)
  if (!self || self.isScratch) return '此 Session 不屬於任何專案，沒有工作項目。'
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  const now = await $.clock.now()
  const action = str(input.action)
  if (action === 'list') return ledgerText(project.ledger)
  if (action === 'add') {
    const text = str(input.text)?.trim()
    if (!text) return 'add 需要 text。'
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

    return `已新增工作項目 ${itemCode(item.id)}（id ${item.id}）。\n\n${ledgerText([...project.ledger, item])}`
  }
  if (action === 'update') {
    const id = typeof input.id === 'number' ? input.id : Number(input.id)
    const item = project.ledger.find(i => i.id === id)
    if (!item) return `找不到工作項目 id ${String(input.id)}。\n\n${ledgerText(project.ledger)}`
    const status = str(input.status)
    if (status === 'done' && item.status !== 'done') {
      const owner = input.owner === undefined ? item.owner : str(input.owner) || null
      const blocker = owner ? await ownerBlocker($, owner) : null
      if (blocker && !(input.force === true && str(input.note)?.trim())) {
        return `無法將 ${itemCode(id)} 標記為完成：${blocker}\n確認 CI 通過、部署完成後再結案；若使用者已明確確認可結案，帶 force: true 並在 note 寫明確認內容。\n\n${ledgerText(project.ledger)}`
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

    return `已更新工作項目 ${itemCode(id)}。\n\n${ledgerText(list)}`
  }

  return 'action 要是 add、update 或 list。'
}

