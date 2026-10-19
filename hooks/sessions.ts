// Reading sessions into a project's board: who is working, who waits on you,
// who stopped with steps left, and what the PM was asked to keep track of.

import type { BackgroundTask, CiCheck, LastWord, LedgerItem, ProjectFile, Session, Step, Track } from '../types'

export type Status = 'running' | 'asking' | 'failed' | 'open' | 'ci' | 'waiting' | 'done' | 'stale'

/**
 * How each status reads and looks: `color` is a theme key (drawn right in light and dark),
 * `hex` the same hue for SVG marks, `tag` what the PM model reads on its board.
 */
export const STATUS: Record<Status, { label: string; tag: string; color: string; hex: string; rank: number }> = {
  asking: { label: '待回覆', tag: '待回覆', color: 'warning', hex: '#f59e0b', rank: 0 },
  failed: { label: 'CI 失敗', tag: 'CI 失敗・需處理', color: 'error', hex: '#ef4444', rank: 1 },
  open: { label: '未完成', tag: '中斷・未完成', color: 'claude', hex: '#d97757', rank: 2 },
  ci: { label: '等待 CI', tag: '等待 CI・未完成', color: 'permission', hex: '#8b5cf6', rank: 3 },
  running: { label: '執行中', tag: '執行中', color: 'success', hex: '#22c55e', rank: 4 },
  waiting: { label: '背景執行', tag: '背景執行', color: 'suggestion', hex: '#3b82f6', rank: 5 },
  done: { label: '已結束', tag: '已結束', color: 'inactive', hex: '#9ca3af', rank: 6 },
  stale: { label: '長期閒置', tag: '長期閒置', color: 'subtle', hex: '#6b7280', rank: 7 },
}

export function isActive(status: Status): boolean {
  return status !== 'done' && status !== 'stale'
}

/** A ledger id as people read it: T-01. */
export function itemCode(id: number): string {
  return `T-${String(id).padStart(2, '0')}`
}

const WAITING_MINUTES = 45
const STALE_DAYS = 3
/** How far the app's last activity may run ahead of a track's last write before the track has missed a turn. */
const BEHIND_MS = 2 * 60000
/** How long a background command counts as running without its notification: a session whose process ended never gets one. */
const BACKGROUND_HOURS = 6

/**
 * Words a session leaves when its turn ends but work goes on: a background job, a CI run, a deploy.
 * Each says the work is under way or what comes once it ends; a word merely named (背景偵測, the
 * status 「等待 CI」, a command "started in the background" that a report describes) is not enough.
 */
const WAITING = new RegExp(
  [
    // 正在乾淨 worktree 裡背景執行 / 還在背景跑
    /(正在|還在|仍在|持續)[^。\n「」]{0,20}?背景(裡|中)?(執行|跑|進行|處理|運行|監看|盯)(?!的)/,
    // 我在背景等結果 / 已丟到背景跑 / 先放到背景執行: the speaker's own, not 「它把測試丟到背景跑」 or 丟到背景跑的指令
    /(我|已|已經|先|會)[^。\n「」]{0,10}?(在|丟到|丟進|放到|放進|移到|轉到)背景(裡|中)?(執行|跑|進行|處理|等|監看|盯|運行)(?!的)/,
    // 背景執行中 / 背景跑著
    /背景(執行|跑|處理|運行)(中|著)/,
    // 背景…完成後 / 背景跑完之後
    /背景[^。\n「」]{0,20}?(完成|跑完|結束)(後|之後)/,
    // 等 CI 通過 / 等測試跑完: not the status named in quotes or brackets (「等待 CI」, (等待 CI)), not 不用等, not 等級 or 相等
    /(?<![「『"'(（\[【相平同對均高]|不用|不必|不需要|無需|別|不要)等(?![級等於同])[^。\n「」]{0,16}?(CI|部署|測試|建置|build|跑完|完成|結果)/,
    // 跑完會通知 / 完成後再推送
    /(跑完|完成後)[^。\n「」]{0,8}?(會|再|就)/,
    /自動接著/,
    // "Waiting for CI to finish", "I'm still waiting on the checks": not a table's "Waiting on CI (等待 CI)"
    /(^|[.!?]\s+|\n\s*)(waiting|wait) (for|on)\b|\b(I'm|I am|I'll|I will|still|now|currently|am|are|is)\s+(waiting|wait)\s+(for|on)\b/,
    // "tests are running in the background", "still in the background": not "a command started in the background"
    /\b(running|runs|still|now|keeps?|continues?|moved)\b[^.\n]{0,40}\bin(to)? the background|\bin the background\b[^.\n]{0,20}\b(now|still|running)\b/,
    // "I'll tag it once the checks pass" / "once it finishes, I'll deploy"
    /\b(I'll|I will|will)\b[^.\n]{0,60}\bonce (it|the|they)\b[^.\n]{0,30}(finish|pass|complete)|\bonce (it|the|they)\b[^.\n]{0,30}(finish|pass|complete)\w*,? I('ll| will)\b/,
  ]
    .map(r => r.source)
    .join('|'),
  'i',
)

/** Words that say CI (or the checks a release waits on) has not finished yet. */
const CI_PENDING =
  /(CI|GitHub Actions|workflow|pipeline|檢查|checks?)[^。\n]{0,16}(還在|仍在|正在|尚未|還沒|未|進行中|執行中|跑(?!完)|running|pending|in progress|queued|not (yet )?(finished|done|passed))|(還在|仍在|正在)(跑|等)[^。\n]{0,8}(CI|測試|workflow|pipeline|檢查|checks?)|等[^。\n]{0,8}(CI|checks?)|(waiting|wait) (for|on) (the )?(CI|checks?|workflow|pipeline)|(CI|checks?)[^。\n]{0,10}(通過|跑完|完成)(後|之後|再|才)|once (the )?(CI|checks?)[^.\n]{0,20}(pass|finish|complete)/gi

/** Words that say CI has finished and passed. */
const CI_PASSED = /(CI|GitHub Actions|workflow|pipeline|檢查|checks?)[^。\n]{0,12}(已|都)?(通過|跑完|全綠|綠燈|成功|passed|succeeded|green)(?!後|之後|再|才|就)/gi

function lastIndex(re: RegExp, text: string): number {
  let at = -1
  for (const m of text.matchAll(re)) at = m.index ?? at

  return at
}

/** The latest turn says CI has not finished (and says nothing later about it passing). */
export function isCiPending(text: string): boolean {
  const pending = lastIndex(CI_PENDING, text)

  return pending >= 0 && pending > lastIndex(CI_PASSED, text)
}

/** What the session said in its latest turn: its recap and final answer, the later one last. */
export function latestWords(track: Track): string {
  const words = [track.recap ?? '', track.lastAnswer]
  // A recap written after the last turn ended belongs to the turn still going: it is the newer word.
  if ((track.recapAt ?? 0) > track.turnAt) words.reverse()

  return words.filter(Boolean).join('\n')
}

/** The words statusOf reads for CI: the track's latest turn, else the transcript's last word. */
export function ciWords(track: Track | undefined, word: LastWord | undefined): string {
  return track ? latestWords(track) : (word?.said ?? '')
}

/** The CI a session's words name, the latest mention: a run id, else a commit. */
export function ciTarget(text: string): { run: string } | { sha: string } | null {
  const runs = [...text.matchAll(/(?:actions\/runs\/|\brun\s*(?:id\s*)?[#:：]?\s*)(\d{8,12})\b/gi)]
  if (runs.length) return { run: runs.at(-1)![1]! }
  // Seven to forty hex digits, with a digit and a letter: 4dca77c, not 1918 or "deadbeef".
  const shas = [...text.matchAll(/(?<![0-9a-z])[0-9a-f]{7,40}(?![0-9a-z])/gi)].map(m => m[0]).filter(w => /\d/.test(w) && /[a-f]/i.test(w))

  return shas.length ? { sha: shas.at(-1)!.toLowerCase() } : null
}

/** What GitHub's runs for a commit (or one run) come to: any still going is pending, any failed is failure. */
export function ciVerdict(runs: { status?: string; conclusion?: string | null }[]): CiCheck['state'] {
  if (runs.length === 0) return 'unknown'
  if (runs.some(r => r.status !== 'completed')) return 'pending'
  if (runs.some(r => !['success', 'skipped', 'neutral'].includes(String(r.conclusion)))) return 'failure'

  return 'success'
}

/**
 * Whether a track has missed the session's latest turns: the app saw activity well after the
 * track's last write while the session sits idle (a module that lost its track for a while).
 */
export function isBehind(one: Session, track: Track): boolean {
  return !one.isRunning && (Date.parse(one.lastActivityAt) || 0) - Math.max(track.turnAt, track.planAt) > BEHIND_MS
}

/**
 * The tracks as they stand against the transcripts: a track behind its session takes the
 * transcript's last word for its words (its recap and question were an older turn's) and keeps its task list.
 */
export function liveTracks(list: Session[], tracks: Record<string, Track>, words: Record<string, LastWord>): Record<string, Track> {
  const live: Record<string, Track> = { ...tracks }
  for (const one of list) {
    const track = tracks[one.id]
    const word = words[one.id]
    if (!track || !isBehind(one, track) || !word || word.error || !word.said || word.activity !== one.lastActivityAt) continue
    // Its background list missed the notifications those turns got too.
    live[one.id] = { ...track, recap: null, recapAt: undefined, ask: word.isAsking ? word.said : null, lastAnswer: word.said, background: [] }
  }

  return live
}

/** Words a recap uses for what is left: not committed, not verified, not deployed. */
const CAVEAT =
  /(還沒|尚未|沒有|未)(完成|驗證|確認|測試|提交|commit|推|push|部署|合併|merge|處理|做)|not (yet )?(done|verified|tested|committed|pushed|deployed|merged)|still (needs|to do)|TODO/i

/** A double negative that says nothing is left: 沒有任何未提交的修改, 沒有未推送的 commit. */
const NOTHING_LEFT = /(沒有|没有|並無|并无|無|不再有)(任何|其他|別的|剩下|剩餘|留下)?[^。，,；;！!\n]{0,4}?(還沒|尚未|未)/g

export type Project = { key: string; name: string; path: string; sessions: Session[] }

/** The project a session works on: a worktree counts as its repository. */
export function projectPath(cwd: string): string {
  const cut = cwd.search(/[\\/]\.(claude[\\/]worktrees|worktrees)[\\/]/i)

  return (cut >= 0 ? cwd.slice(0, cut) : cwd).replace(/[\\/]+$/, '')
}

export function isScratch(cwd: string): boolean {
  return /scratch-workspaces/i.test(cwd)
}

export function projectName(cwd: string): string {
  if (isScratch(cwd)) return '臨時資料夾'

  return projectPath(cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? '未分類'
}

export function projectKey(cwd: string): string {
  return isScratch(cwd) ? 'scratch' : projectPath(cwd).replace(/\//g, '\\').toLowerCase()
}

/** A short stable file name for a project key. */
export function keyFile(key: string): string {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  const name = key.split(/[\\/]/).filter(Boolean).at(-1) ?? 'project'

  return `${name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40)}-${h.toString(16)}`
}

/** Projects, most recently active first; within one, the latest session first. */
export function groupProjects(list: Session[]): Project[] {
  const byKey = new Map<string, Project>()
  for (const one of list) {
    const key = projectKey(one.cwd)
    let project = byKey.get(key)
    if (!project) {
      project = { key, name: projectName(one.cwd), path: projectPath(one.cwd), sessions: [] }
      byKey.set(key, project)
    }
    project.sessions.push(one)
  }
  const at = (s: Session) => Date.parse(s.lastActivityAt) || 0
  for (const project of byKey.values()) project.sessions.sort((a, b) => at(b) - at(a))

  return [...byKey.values()].sort((a, b) => at(b.sessions[0]!) - at(a.sessions[0]!))
}

/**
 * Whether a track holds anything the session reported. A track a session writes when it
 * (re)loads, before its next turn ends, holds nothing: its transcript's last word says more.
 */
export function hasReport(track: Track | null | undefined): track is Track {
  return !!track && (track.plan.length > 0 || !!track.lastAnswer || !!track.recap || !!track.ask)
}

/** The background tasks a notification in `text` reports as over: completed, failed, killed or stopped. */
export function finishedTasks(text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const body = m[1] ?? ''
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(body)?.[1]
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(body)?.[1] ?? ''
    if (id && !/^(running|pending|started|in_progress)$/i.test(status)) ids.push(id)
  }

  return ids
}

/** The background commands a session started and has not heard back from (within BACKGROUND_HOURS of their start). */
export function backgroundOf(track: Track | undefined, now: number): BackgroundTask[] {
  return (track?.background ?? []).filter(t => now - t.at < BACKGROUND_HOURS * 3600000)
}

export function openSteps(track: Track | undefined): Step[] {
  return track ? track.plan.filter(s => s.status !== 'completed') : []
}

export function caveatOf(track: Track | undefined): string | null {
  return track?.recap && CAVEAT.test(track.recap.replace(NOTHING_LEFT, '')) ? track.recap : null
}

/**
 * What the CI the words left running comes to, as GitHub last answered for those same words:
 * `ci` while it runs or cannot be checked, `failed` once it failed, null when it passed or none is running.
 */
function ciStatus(text: string, ci: CiCheck | undefined): Status | null {
  if (!isCiPending(text)) return null
  const known = ci?.words === text ? ci.state : 'unknown'
  if (known === 'success') return null

  return known === 'failure' ? 'failed' : 'ci'
}

export function statusOf(one: Session, track: Track | undefined, word: LastWord | undefined, now: number, ci?: CiCheck): Status {
  if (one.isRunning) return 'running'
  const minutes = (now - (Date.parse(one.lastActivityAt) || 0)) / 60000
  if (track) {
    if (track.ask || /[?？]\s*$/.test(track.lastAnswer)) return 'asking'
    // CI that has not finished is never done, however long ago the session stopped.
    const pending = ciStatus(latestWords(track), ci)
    if (pending) return pending
    // A session that ended its turn to wait on its own background work has not stopped midway,
    // whatever its task list still holds: while the work runs (its notification not yet in), however long that takes.
    if (backgroundOf(track, now).length > 0) return 'waiting'
    // Words alone say the same for a while: a session that never came back has stopped after all.
    if (WAITING.test(track.lastAnswer) && minutes < WAITING_MINUTES) return 'waiting'
    if (openSteps(track).length > 0) return 'open'
  } else {
    if (word?.isAsking) return 'asking'
    const pending = word ? ciStatus(word.said, ci) : null
    if (pending) return pending
    if (word?.isWaiting && minutes < WAITING_MINUTES) return 'waiting'
  }

  return minutes > STALE_DAYS * 24 * 60 ? 'stale' : 'done'
}

export function ago(iso: string | number, now: number): string {
  const at = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(at) || at === 0) return '不明'
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 1) return '剛剛'
  if (min < 60) return `${min} 分鐘前`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} 小時前`

  return `${Math.round(hours / 24)} 天前`
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Parses list_sessions' JSON text; archived sessions are left out. */
export function parseSessions(text: string): Session[] {
  const rows: unknown = JSON.parse(text)
  if (!Array.isArray(rows)) throw new Error('list_sessions 回傳的不是陣列')

  return rows.flatMap(row => {
    if (typeof row !== 'object' || row === null) return []
    const o = row as Record<string, unknown>
    if (typeof o.sessionId !== 'string' || o.isArchived === true) return []

    return [
      {
        id: o.sessionId,
        title: typeof o.title === 'string' && o.title ? o.title : '（未命名）',
        cwd: typeof o.cwd === 'string' ? o.cwd : '',
        isRunning: o.isRunning === true,
        lastActivityAt: typeof o.lastActivityAt === 'string' ? o.lastActivityAt : '',
        isPinned: o.pinned === true,
        hasOpenPr: o.prState === 'OPEN',
      },
    ]
  })
}

/** Reads list_events' plaintext into the session's last word. */
export function parseLastWord(text: string, activity: string): LastWord {
  const marks: { role: string; end: number; at: number }[] = []
  const re = /^\[(user|assistant|result)\] /gm
  for (let m = re.exec(text); m; m = re.exec(text)) marks.push({ role: m[1] as string, at: m.index, end: m.index + m[0].length })
  const entries = marks.map((mark, i) => ({ role: mark.role, body: text.slice(mark.end, marks[i + 1]?.at ?? text.length).trim() }))

  const said = entries.filter(e => e.role === 'assistant' && !/^\(called /.test(e.body)).at(-1)
  const last = entries.filter(e => e.role !== 'result').at(-1)
  const isLast = !!said && last === said
  const isAsking = isLast && /[?？]\s*$/.test(said.body)

  return {
    said: said ? clip(said.body, 140) : '',
    isAsking,
    isWaiting: isLast && !isAsking && WAITING.test(said.body),
    activity,
    error: null,
  }
}

function isStatus(v: unknown): v is Step['status'] {
  return v === 'pending' || v === 'in_progress' || v === 'completed'
}

/** The task list after one update_plan call: a whole list, `advance`, `done` or `start`. */
export function applyPlan(plan: Step[], input: Record<string, unknown>): Step[] {
  if (Array.isArray(input.items)) {
    return input.items.flatMap(item => {
      const o = item as Record<string, unknown>
      if (typeof o?.content !== 'string') return []

      return [{ content: o.content, status: isStatus(o.status) ? o.status : 'pending' }]
    })
  }
  const next = plan.map(s => ({ ...s }))
  if (input.advance === true) {
    const at = next.findIndex(s => s.status === 'in_progress')
    if (at >= 0) next[at]!.status = 'completed'
    const following = next.findIndex((s, i) => i > at && s.status === 'pending')
    if (following >= 0) next[following]!.status = 'in_progress'
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) if (typeof n === 'number' && next[n - 1]) next[n - 1]!.status = 'completed'
  }
  if (typeof input.start === 'number' && next[input.start - 1]) {
    for (const s of next) if (s.status === 'in_progress') s.status = 'pending'
    next[input.start - 1]!.status = 'in_progress'
  }

  return next
}

/** TodoWrite's list, for a session that keeps its tasks there (a terminal session). */
export function planFromTodos(todos: unknown): Step[] {
  if (!Array.isArray(todos)) return []

  return todos.flatMap(t => {
    const o = t as Record<string, unknown>
    if (typeof o?.content !== 'string') return []

    return [{ content: o.content, status: isStatus(o.status) ? o.status : 'pending' }]
  })
}

const STEP_MARK: Record<Step['status'], string> = { completed: '[x]', in_progress: '[>]', pending: '[ ]' }

export type BoardInput = {
  project: { name: string; path: string }
  sessions: Session[]
  /** Every listed (unarchived) session, of any project: an owner elsewhere is still there. */
  everyone?: Session[]
  tracks: Record<string, Track>
  words: Record<string, LastWord>
  ci?: Record<string, CiCheck>
  ledger: LedgerItem[]
  now: number
  isIncludingDone: boolean
}

/** The board as the PM model reads it: what needs attention first, then every session. */
export function boardText(input: BoardInput): string {
  const { project, sessions, words, ledger, now } = input
  const everyone = input.everyone ?? sessions
  const tracks = liveTracks(everyone, input.tracks, words)
  const ci = input.ci ?? {}
  const rows = sessions
    .map(one => ({ one, track: tracks[one.id], word: words[one.id], status: statusOf(one, tracks[one.id], words[one.id], now, ci[one.id]) }))
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank)
  const lines: string[] = []
  lines.push(`# 專案狀態報告：${project.name}`, `路徑：${project.path}`)
  const count = (s: Status) => rows.filter(r => r.status === s).length
  lines.push(
    `Sessions ${rows.length}（不含 PM）｜待回覆 ${count('asking')}｜CI 失敗 ${count('failed')}｜等待 CI ${count('ci')}｜中斷・未完成 ${count('open')}｜執行中 ${count('running')}｜背景執行 ${count('waiting')}｜已結束 ${count('done')}｜長期閒置 ${count('stale')}`,
  )

  const counted = ledger.filter(item => item.status !== 'dropped')
  if (counted.length) lines.push(`工作項目完成 ${counted.filter(i => i.status === 'done').length}/${counted.length}（專案進度以工作項目為準；Session 收尾時會把自己的任務清單全部勾選，不代表工作已完成）`)

  const attention: string[] = []
  for (const r of rows) {
    const name = `「${r.one.title}」(${r.one.id})`
    if (r.status === 'asking') attention.push(`- [待回覆] ${name} 等待使用者決策：${clip(r.track?.ask ?? r.track?.lastAnswer ?? r.word?.said ?? '', 200)}`)
    if (r.status === 'open') {
      const left = openSteps(r.track)
      attention.push(`- [中斷・未完成] ${name} 已停止，任務清單仍有 ${left.length} 項未完成：${left.map(s => s.content).join('；')}`)
    }
    if (r.status === 'ci') attention.push(`- [等待 CI・未完成] ${name} 最後回報 CI 尚未跑完，不能視為完成：${clip(ciWords(r.track, r.word), 200)}`)
    if (r.status === 'failed') {
      attention.push(`- [CI 失敗・需處理] ${name} GitHub 上的 CI（${ci[r.one.id]?.target || '最近一次'}）失敗，要修正後重跑：${clip(ciWords(r.track, r.word), 200)}`)
    }
    const caveat = caveatOf(r.track)
    if (caveat && r.status !== 'running' && r.status !== 'ci' && r.status !== 'failed') attention.push(`- [需追蹤] ${name} 收尾摘要載明尚有未完成事項：${clip(caveat, 200)}`)
    if (r.one.hasOpenPr && r.status !== 'running') attention.push(`- [PR 開啟中] ${name}`)
  }
  const openLedger = ledger.filter(item => item.status === 'open')
  const known = new Set(everyone.map(s => s.id))
  for (const item of openLedger) {
    if (!item.owner) attention.push(`- [未指派] 工作項目 ${itemCode(item.id)}「${item.text}」尚未指派負責 Session`)
    else if (!known.has(item.owner)) attention.push(`- [負責人失聯] 工作項目 ${itemCode(item.id)}「${item.text}」的負責 Session ${item.owner} 已不在清單中（可能已封存），需確認是否完成`)
  }
  const inProject = new Set(sessions.map(s => s.id))
  /** An owner as the ledger shows it: its title and status, and whether it works from another project's folder. */
  const ownerText = (id: string | null) => {
    if (!id) return '未指派'
    const one = everyone.find(s => s.id === id)
    if (!one) return `${id}（已不在清單中）`
    const status = statusOf(one, tracks[id], words[id], now, ci[id])

    return `${one.title}（${STATUS[status].tag}${inProject.has(id) ? '' : '・其他專案的 Session'}）`
  }
  lines.push('', '## 需要處理', attention.length ? attention.join('\n') : '（無）')

  lines.push('', '## 工作項目')
  const shown = input.isIncludingDone ? ledger : openLedger
  if (shown.length === 0) lines.push(openLedger.length === 0 && ledger.length > 0 ? '（全部完成）' : '（無）')
  for (const item of shown) {
    lines.push(`- ${itemCode(item.id)} (id ${item.id}) [${item.status}] ${item.text}｜負責：${ownerText(item.owner)}${item.note ? `｜備註：${item.note}` : ''}`)
  }

  lines.push('', '## Sessions')
  let listed = 0
  for (const r of rows) {
    const isOwner = openLedger.some(item => item.owner === r.one.id)
    if (!input.isIncludingDone && !isActive(r.status) && !caveatOf(r.track) && !r.one.hasOpenPr && !isOwner) continue
    listed += 1
    const flags = [r.one.hasOpenPr ? 'PR 開啟中' : '', r.one.isPinned ? '已釘選' : ''].filter(Boolean).join('、')
    lines.push(`### [${STATUS[r.status].tag}] ${r.one.title} (${r.one.id})`)
    lines.push(`最後活動 ${ago(r.one.lastActivityAt, now)}${flags ? `｜${flags}` : ''}`)
    if (r.track) {
      if (r.track.plan.length) lines.push(`任務 ${r.track.plan.filter(s => s.status === 'completed').length}/${r.track.plan.length}：${r.track.plan.map(s => `${STEP_MARK[s.status]} ${s.content}`).join(' / ')}`)
      if (r.track.lastPrompt) lines.push(`最新指令：${clip(r.track.lastPrompt, 160)}`)
      if (r.track.recap) lines.push(`收尾摘要：${clip(r.track.recap, 300)}`)
      else if (r.track.lastAnswer) lines.push(`最後回報：${clip(r.track.lastAnswer, 300)}`)
      if (r.track.ask) lines.push(`待決策問題：${r.track.ask}`)
      const background = backgroundOf(r.track, now)
      if (background.length) lines.push(`背景工作 ${background.length} 項執行中：${background.map(t => `${clip(t.label, 80)}（${ago(t.at, now)}開始）`).join('；')}`)
    } else {
      lines.push(`（無追蹤紀錄：此 Session 在 Mod 安裝前開啟）最後訊息：${r.word?.error ? `讀取失敗：${r.word.error}` : (r.word?.said ?? '讀取中')}`)
    }
  }
  const hidden = rows.length - listed
  if (hidden > 0) lines.push('', `另有 ${hidden} 個已結束且無待辦的 Session 未列出；以 include_done: true 檢視全部。`)

  return lines.join('\n')
}

export function emptyProject(key: string, name: string, path: string): ProjectFile {
  return { key, name, path, pmId: null, isDismissed: false, ledger: [], nextId: 1 }
}
