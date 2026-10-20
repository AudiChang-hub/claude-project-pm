// Reading sessions into a project's board: who is working, who waits on you,
// who stopped with steps left, and what the PM was asked to keep track of.

import type { BackgroundTask, CiCheck, LastWord, LedgerItem, ProjectFile, PushCheck, Session, Step, Track } from '../types'
import { t } from './messages'

export type Status = 'running' | 'asking' | 'failed' | 'open' | 'unreleased' | 'ci' | 'waiting' | 'done' | 'stale'

/** How each status looks: `color` is a theme key (drawn right in light and dark), `hex` the same hue for SVG marks. */
const LOOK: Record<Status, { color: string; hex: string; rank: number }> = {
  asking: { color: 'warning', hex: '#f59e0b', rank: 0 },
  failed: { color: 'error', hex: '#ef4444', rank: 1 },
  open: { color: 'claude', hex: '#d97757', rank: 2 },
  unreleased: { color: 'planMode', hex: '#0d9488', rank: 3 },
  ci: { color: 'permission', hex: '#8b5cf6', rank: 4 },
  running: { color: 'success', hex: '#22c55e', rank: 5 },
  waiting: { color: 'suggestion', hex: '#3b82f6', rank: 6 },
  done: { color: 'inactive', hex: '#9ca3af', rank: 7 },
  stale: { color: 'subtle', hex: '#6b7280', rank: 8 },
}

/**
 * How each status reads and looks: `label` on the pane, `tag` what the PM model reads on its board,
 * both in the language the mod speaks now (messages.ts).
 */
export const STATUS = Object.fromEntries(
  (Object.keys(LOOK) as Status[]).map(status => [
    status,
    {
      ...LOOK[status],
      get label() {
        return t(`status.${status}.label`)
      },
      get tag() {
        return t(`status.${status}.tag`)
      },
    },
  ]),
) as Record<Status, { label: string; tag: string; color: string; hex: string; rank: number }>

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
    /(我|已|已經|先|會)[^。，,\n「」]{0,10}?(在|丟到|丟進|放到|放進|移到|轉到)背景(裡|中)?(執行|跑|進行|處理|等|監看|盯|運行)(?!的)/,
    // 背景執行中 / 背景跑著
    /背景(執行|跑|處理|運行)(中|著)/,
    // 背景…完成後 / 背景跑完之後
    /背景[^。\n「」]{0,20}?(完成|跑完|結束)(後|之後)/,
    // 等 CI 通過 / 等測試跑完: not the status named in quotes or brackets (「等待 CI」, (等待 CI)) or as a noun
    // (標成等待 CI, 維持等待 CI), not 不用等, not 等級 or 相等
    /(?<![「『"'(（\[【相平同對均高]|不用|不必|不需要|無需|別|不要)(?<!標|維持|卡在|成|為|是|算|顯示)(?<!(?:[、／/→從和與及]|->)\s*(?=等待))等(?![級等於同]|待\s*CI\s*(?:[、／/→,，)）]|->))[^。\n「」]{0,16}?(CI|部署|測試|建置|build|跑完|完成|結果)/,
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
const CI_PENDING = new RegExp(
  [
    // CI 還在跑 / checks still running / CI 尚未完成: the run's own state, not "檢查兩個工具還在", a name like CI_PENDING
    // or the next status in a list (CI 失敗／等待 CI → 背景執行 → 未完成); a re-run told of (重跑, 又跑) is not one running
    /(CI|GitHub Actions|workflow|pipeline|checks?)[^。\n→／、]{0,16}(還在|仍在|正在|尚未|還沒|未(?!來|知)|進行中|執行中|(?<![重又])跑(?!完)|[重又]跑[中著]|\b(running|pending|in progress|queued|not (yet )?(finished|done|passed)))/,
    /檢查[^。\n]{0,10}(還在(跑|執行|進行)|仍在(跑|執行|進行)|正在(跑|執行|進行)|尚未(跑完|完成|通過)|還沒(跑完|完成|通過|過)|進行中|執行中)/,
    // 正在等 9f8e7d6 的 CI: room for a hash between
    /(還在|仍在|正在)(跑|等)[^。\n]{0,16}(CI|測試|workflow|pipeline|檢查|checks?)/,
    // 等 CI 通過: not the status named in quotes or brackets (「等待 CI」, (等待 CI)) or as a noun (不再標等待 CI, 從等待 CI 轉成,
    // 未完成、等待 CI、CI 失敗, CI 失敗／等待 CI → 背景執行), not 不用等
    /(?<![「『"'(（\[【相平同對均高]|不用|不必|不需要|無需|別|不要)(?<!標|維持|卡在|成|為|是|算|顯示)(?<!(?:[、／/→從和與及]|->)\s*(?=等待))等(?![級等於同]|待\s*CI\s*(?:[、／/→,，)）]|->))[^。\n]{0,16}(CI|checks?)/,
    /(waiting|wait) (for|on) (the )?(CI|checks?|workflow|pipeline)/,
    /(CI|checks?)[^。\n]{0,10}(通過|跑完|完成)(後|之後|再|才)/,
    /once (the )?(CI|checks?)[^.\n]{0,20}(pass|finish|complete)/,
  ]
    .map(r => r.source)
    .join('|'),
  'gi',
)

/** Words that say CI has finished and passed. */
const CI_PASSED = /(CI|GitHub Actions|workflow|pipeline|檢查|checks?)[^。\n]{0,12}(已|都)?(通過|跑完|全綠|綠燈|成功|passed|succeeded|green)(?!後|之後|再|才|就)/gi

function lastIndex(re: RegExp, text: string): number {
  let at = -1
  for (const m of text.matchAll(re)) at = m.index ?? at

  return at
}

/**
 * The words as a report of the work: quoted words (a status 「等待 CI」, a step, a phrase) gone, and the
 * clauses about a rule, an example, a condition or someone else's work blanked; separators and offsets kept.
 */
export function reportedText(text: string): string {
  const parts = text.replace(QUOTED, quoted => ' '.repeat(quoted.length)).split(/([。！？!?；;，,\n]+|\.\s+)/)
  // Blanking keeps lengths, so a sentence's offsets in `parts` are its offsets in `text`, quotes and all.
  const lengths = parts.map(part => part.length)
  const offsetOf = (i: number) => lengths.slice(0, i).reduce((sum, n) => sum + n, 0)
  // Blanked to as many spaces, so an offset in it is one in `text`.
  const blank = (i: number) => {
    parts[i] = ' '.repeat(parts[i]!.length)
  }
  // Another session spoken of as 它 or by its link, or a rule laid out (流程是, 規範是): the sentence's next clauses
  // without an I of their own go on with it (接下來它會推送，CI 通過後部署; 規範是先打標籤，通過後才推標籤).
  let isCarried = false
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i]!
    if (i >= 2 && !/^[，,]+$/.test(parts[i - 1]!)) isCarried = false
    if (THEIRS.test(part) || RULE_LEAD.test(part)) isCarried = true
    if (ABOUT_A_RULE.test(part) || (isCarried && !FIRST_PERSON.test(part))) blank(i)
    else if (DISCLAIMER.test(part)) {
      blank(i)
      // 那些未提交的修改，我都沒有動: what is disclaimed often stands just before, in the same sentence,
      // with no I of its own (我還沒 push，別人的修改我沒碰 keeps its first half).
      if (i >= 2 && /^[，,]+$/.test(parts[i - 1]!) && !FIRST_PERSON.test(parts[i - 2]!)) blank(i - 2)
    }
  }
  // A sentence that tells how something is judged (判成, 誤判, 列為, flags as) describes the judging: all of it,
  // before and after that clause, but a clause with an I of its own (看板會判成待發布，因為我還沒 push).
  for (let start = 0; start < parts.length; ) {
    let end = start
    while (end + 2 < parts.length && /^[，,]+$/.test(parts[end + 1]!)) end += 2
    if (isJudging(text.slice(offsetOf(start), offsetOf(end) + parts[end]!.length))) {
      for (let i = start; i <= end; i += 2) if (!FIRST_PERSON.test(parts[i]!)) blank(i)
    }
    start = end + 2
  }

  return parts.join('')
}

/** The latest turn says CI has not finished (and says nothing later about it passing). */
export function isCiPending(text: string): boolean {
  const plain = reportedText(text)
  const pending = lastIndex(CI_PENDING, plain)

  return pending >= 0 && pending > lastIndex(CI_PASSED, plain)
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

/**
 * The runs and commits a session's words name, the likeliest first: nearest to where the report itself
 * talks of CI (not in a quote or a rule), then the later one. A commit is seven to forty hex digits
 * with a digit and a letter (3fa1c2e, not 1204 or "deadbeef") that is not part of an id (local_…-9e0f1a2b3c4d);
 * the caller tries them in turn against the session's repository.
 */
export function ciTargets(text: string): { runs: string[]; shas: string[] } {
  const plain = reportedText(text)
  const ci = [...plain.matchAll(/CI|GitHub Actions|workflow|pipeline|checks?|檢查/gi)].map(m => m.index ?? 0)
  const rank = (found: { word: string; at: number }[]) =>
    found
      .map(f => ({ ...f, distance: ci.length ? Math.min(...ci.map(c => Math.abs(c - f.at))) : 0 }))
      .sort((a, b) => a.distance - b.distance || b.at - a.at)
      .map(f => f.word)
      .filter((w, i, all) => all.indexOf(w) === i)
  const runs = [...text.matchAll(/(?:actions\/runs\/|\brun\s*(?:id\s*)?[#:：]?\s*)(\d{8,12})\b/gi)].map(m => ({ word: m[1]!, at: (m.index ?? 0) + m[0].length - m[1]!.length }))
  const shas = [...text.matchAll(/(?<![0-9a-z_-])[0-9a-f]{7,40}(?![0-9a-z_-])/gi)]
    .filter(m => /\d/.test(m[0]) && /[a-f]/i.test(m[0]))
    .map(m => ({ word: m[0].toLowerCase(), at: m.index ?? 0 }))

  return { runs: rank(runs), shas: rank(shas) }
}

/** The likeliest CI the words name: a run id, else a commit. */
export function ciTarget(text: string): { run: string } | { sha: string } | null {
  const { runs, shas } = ciTargets(text)
  if (runs[0]) return { run: runs[0] }

  return shas[0] ? { sha: shas[0] } : null
}

/** What GitHub's runs for a commit (or one run) come to: any still going is pending, any failed is failure. */
export type CiRun = { status?: string; conclusion?: string | null; workflowName?: string }

/**
 * What GitHub's runs for a commit (or one run) come to: any still going is pending, any failed is failure.
 *
 * A cancelled run is not a failure. One whose workflow has another run on the same commit (re-run, or run
 * again after it was called off) is left out; a workflow whose runs were all cancelled never finished, so
 * the commit has not passed either: unknown, and a newer commit or the words decide.
 */
export function ciVerdict(runs: CiRun[]): CiCheck['state'] {
  const isCancelled = (r: CiRun) => r.status === 'completed' && r.conclusion === 'cancelled'
  const workflow = (r: CiRun) => r.workflowName ?? ''
  const counted = runs.filter(r => !isCancelled(r))
  const unfinished = runs.some(r => isCancelled(r) && !counted.some(c => workflow(c) === workflow(r)))
  if (counted.some(r => r.status !== 'completed')) return 'pending'
  if (counted.some(r => !['success', 'skipped', 'neutral'].includes(String(r.conclusion)))) return 'failure'

  return counted.length === 0 || unfinished ? 'unknown' : 'success'
}

/**
 * Of two answers for the same work, the one that says more for it: a commit is as good as anything that
 * holds it, so a newer build that passed clears an older one that failed or was called off, and one still
 * running keeps it pending. success, then pending, then failure, then unknown.
 */
export function betterCi(a: CiCheck['state'], b: CiCheck['state']): CiCheck['state'] {
  const order: CiCheck['state'][] = ['success', 'pending', 'failure', 'unknown']

  return order.indexOf(a) <= order.indexOf(b) ? a : b
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

/** Words a recap uses for work left other than delivering it: not done, not verified, not tested (delivery: undeliveredOf). */
const CAVEAT = /(還沒|尚未|沒有|未)(完成|驗證|確認|測試|處理|做)|not (yet )?(done|verified|tested)|still (needs|to do)|TODO/i

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
  if (isScratch(cwd)) return t('project.scratch')

  return projectPath(cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? t('project.unsorted')
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

// ── Work not delivered yet: not committed, not pushed, not released, waiting on a go-ahead ──

/** What delivering takes, as the words name it. */
export type DeliveryKind = 'commit' | 'push' | 'release'

const VERB = String.raw`commit(?:ted)?|push(?:ed)?|deploy(?:ed)?|release[sd]?|merge[sd]?|ship(?:ped)?|提交|推送|推上|發布|發佈|部署|上線|合併|交付|升版`
/** A delivery verb, and those joined to it: 沒有 commit 或 push, not committed or pushed. */
const VERBS = String.raw`(?:${VERB})(?![^\s，。,；;]{0,2}(?:設定|腳本|流程|文件|檔案|權限|環境|相關|說明|紀錄|動詞))(?:\s*(?:或|和|、|及|跟|與|並|再|也沒有?|/|／|,|and|or|nor)\s*(?:${VERB}))*`
/** 尚未 commit, 還沒上線, 仍未 commit 或 push, 也沒有 push: the negation a few characters before the verb (a verb after 的 is a noun: 還沒公開的 commit). */
const NOT_DONE = new RegExp(String.raw`(尚未|還沒有?|仍未|仍然沒有|並未|并未|沒有?|未)[^。，,；;：:\n]{0,4}?(?<!的\s*)(${VERBS})|\b(not(?: yet)?|haven't(?: yet)?|hasn't(?: yet)?|have not(?: yet)?|has not(?: yet)?|didn't|did not)\s+(?:been\s+)?(${VERBS})`, 'gi')
/**
 * A negation that says the work is still to come (還沒, 尚未, 未, not yet): it always counts. A bare one (沒有 push,
 * didn't push) only says it was not done, which a report with no code to deliver may say of what was never needed.
 */
const YET = /還|尚|仍|^未$|yet/i
/**
 * Not needed: 不需要 push, 無需發布, 不用升版號, no need to push, nothing to commit. The kinds it names are settled,
 * like done ones (版號, 標籤 and tag are a release's).
 */
const NO_NEED = new RegExp(
  String.raw`(?:不需要|不需|不用|無需|無須|毋需|毋須|不必|沒必要)\s*(?:再|做|進行)?\s*((?:${VERBS})|版號|升版|打標籤|標籤|tag)|\b(?:no need to|nothing to|don't need to|do not need to|doesn't need to|does not need to)\s+(?:be\s+)?((?:${VERBS}))`,
  'gi',
)
/**
 * The work has no code to deliver: 沒有改程式, 沒有程式變更, 無程式變更, 純資料修正, no code changes. Anywhere in the
 * report, it lets a bare negation of commit, push or release with nothing else as its subject (也沒有 push) go.
 */
const NO_CODE =
  /沒有?(?:修?改|動|變更|修改)(?:任何)?(?:程式|code)|(?:沒有|無|未有)(?:任何)?程式(?:碼)?(?:變更|修改|異動|改動)|純資料(?:修正|修改|變更|操作|更新)|只(?:改|動|修正)了?(?:正式)?資料(?![夾表庫檔結])|\bno code (?:changes?|change was made)|\b(?:didn't|did not) (?:change|touch) (?:any )?code|\bdata[- ]only (?:fix|change|update)/gi
/** What follows a no-code phrase when it names a kind of work rather than this one: 只改資料的工作, 沒有程式變更的任務. */
const OF_A_KIND = /^[^，,。；;\n]*的(?:工作|任務|情況|案例|Session|事)/

/** The report says this work changed no code: a no-code phrase that is a statement, not a kind of work named. */
function hasNoCode(text: string): boolean {
  return [...text.matchAll(NO_CODE)].some(m => !OF_A_KIND.test(text.slice((m.index ?? 0) + m[0].length)))
}
/** The work waits on something before it is done: 等 PM 確認, 確認後再推, pending, until. A bare negation then counts. */
const WAITING_TONE = /等(?!於)|待(?!發布|處理事項)|之後(?:再|才)|稍後|晚點|once\b|\buntil\b|\bpending\b|\bwaiting\b|\bafter (?:the )?(?:PM|review|approval|go-ahead)/i
/**
 * Its own delivery still to come, said as what happens next with no negation: 之後再 push, 接下來部署到正式站,
 * 明天發布 2.4.2, PM 確認後我再推, 稍後 commit, I'll push after review, Next: deploy to production. A time or a step
 * ahead, then (a few characters on) the verb; 推 alone is a push here (再推, 才推). Not a verb used as a noun:
 * 多了兩個 commit, 合併後的提交, 之後部署會改成, commit 再 push 就會更新.
 */
const FUTURE = new RegExp(
  String.raw`(?:之後|稍後|待會兒?|晚點|接下來|下一步|再來|明天|今晚|下午|下週|隨後|然後|預計|打算|準備|將|(?:確認|通過|審核|審查|放行|review|合併|完成|跑完|結束)後)[^。，,；;：:\n]{0,6}?(?<![個筆次條份的]\s*)((?:${VERBS})|推(?![薦測論動進出廣]))(?!\s*(?:[就便]?會|時|的))|\b(?:I'll|I will|I'm going to|I am going to|we'll|we will|will|going to|next[:,]|then|later|tomorrow)\s+(?:then\s+)?((?:${VERBS}))`,
  'gi',
)
/**
 * After a future verb, what makes it a consequence, a noun or a fact: (more verbs, then) 就會, 便會, 會, 時, 的;
 * a commit hash (之後另外提交 7fcc930: a commit to come has none yet); a 就/便…會 soon after (之後推送、SSH 就不會再詢問).
 */
const NOUN_AFTER = new RegExp(
  String.raw`^\s*(?:(?:或|和|、|及|跟|與|並|再|and|or)\s*(?:${VERB})\s*)*(?:[就便]?會|時|的|` + '`?' + String.raw`[0-9a-f]{7,40}\b)|^[^。，,；;\n]{0,8}?[就便]不?會`,
  'i',
)
/**
 * A future that will not come (不會再部署, won't deploy), a past told in order (之後它完成部署, 之後補了一個提交),
 * a guess (今晚可能還會推送, might deploy), or a noun that follows the marker (接下來的推版).
 */
const NOT_FUTURE = /不|沒|別|無需|毋需|了|已|完成|過|可能|也許|或許|大概|^的|won't|will not|never|no longer|\bmaybe\b|\bprobably\b|\bmight\b/i
/**
 * Words that leave the next step to the person: 你可以之後再 push, 下一步可以部署, 建議, 要不要, you can, you could.
 * An offer is theirs to take (a question already shows the session as waiting on them), not this session's to-do.
 */
const OFFER = /你可以|您可以|你也可以|您也可以|你要|可以|建議|要不要|是否要|\byou (?:can|could|may|might)\b|\bwould you\b|\bfeel free\b|\boptional(?:ly)?\b|\bif you (?:want|like)\b/i

/**
 * The person's own plan, not this session's: 你原本打算上線後自己改, you'll deploy it. Not 幫你, 給你 or 通知你,
 * where the session still does the work.
 */
const YOURS = /(?<![幫給替向跟和對讓與知訴])(?:你|您)(?!的)|\byou(?:'ll| will| plan| were going| are going)\b/i

/**
 * Between a negation and its verb, how the work was done rather than that it was not: 沒有另開 commit, 沒有另外 commit,
 * 沒有新增 commit, 沒有拆成兩個 commit, 沒有用 force push.
 */
const MANNER = /另(?:開|外|行|起)?|新增|再開|多開|額外|單獨|拆成|拆開|分成|分開|force|強制|separate|another|extra|additional|split/i
/**
 * A commit made, named by its hash: commit 是 3fa1c2e, 新的 commit 為 3fa1c2e, amend 成 3fa1c2e, 併進 3fa1c2e,
 * committed (as) 3fa1c2e, amended into 3fa1c2e.
 */
const COMMITTED =
  /\bcommit\s*(?:是|為|:|：)\s*`?[0-9a-f]{7,40}\b|\bamend(?:ed)?\s*(?:成|為|到|into|to|as)?\s*`?[0-9a-f]{7,40}\b|(?:併進|併入|合進|合入)\s*`?[0-9a-f]{7,40}\b|\bcommitted\s+(?:it\s+)?(?:as\s+|to\s+|in\s+)?`?[0-9a-f]{7,40}\b/gi

/** What may stand before a bare negation for it to be the report's own, with no other subject: 也沒有 push, 我也沒有 push. */
const BARE_PREFIX = /^[\s,，、]*(?:(?:我們|我|也|都|並|而且|且|另外|同時|所以|因此|則|就|then|and|also|so|I|we)[\s,，、]*)*$/i
/** 已推上 main, 已部署, 部署完成, 上線了, pushed to main: the same kinds done, which a later word may say. */
const DONE = new RegExp(String.raw`(?:已經?|都已|也已|皆已|完成(?!後))[^。，,；;：:\n]{0,4}?(${VERBS})|(${VERB})(?:完成|好了|成功|了)|\b(?:I|we|it|was|were|is|has been|have been)\s+(committed|pushed|deployed|released|merged|shipped)\b`, 'gi')
/**
 * Delivery waits on someone's word: 等 PM 放行, 等 PM 通知 2.4.1 上線後才發布, 等確認才 push, waiting for
 * your go-ahead. Not 等 PM 下一輪確認 (a check to come, with nothing to deliver after it).
 */
const AWAITING_GO = new RegExp(
  String.raw`等[^。，,；;\n]{0,10}?(?:放行|批准|核准|同意)|等[^。，,；;\n]{0,12}?(?:通知|確認)[^。；;\n]{0,16}?(?:後|再|才)[^。；;\n]{0,16}?(?:${VERB})|\bwaiting (?:for|on) (?:the PM's |the PM |your |a |an |the )?(?:go-ahead|approval|sign-off|OK)\b`,
  'gi',
)
/**
 * A clause about a rule, a status or an example, not about the work: 看板會把它判成待發布, 這類字眼, 就不能顯示已結束;
 * a condition (回報說還沒交付時, 如果還沒部署), words reported (摘要提到尚未部署), or someone else's work
 * (其他 Session 還沒提交的修改都原樣留著: a folder shared with other sessions).
 */
const ABOUT_A_RULE =
  /另一個 ?Session|另個 ?Session|另外一個 ?Session|(?:另一個|另個|另外一個|另一|其他|別的|別個)\s*(?:Session|session|工作階段|人|同事|版本|分支|專案|工作|任務|項目)|(?:由|交給|交由)\s*[^\s，,。]{1,12}?\s*(?:負責|管|處理|接手|主導)|子 ?Session|子工作階段|的\s*(?:[A-Za-z0-9_.-]+\s*)?(?:Session|工作階段)|它(?:們)?(?=會|將|就|再|要|先|已|還|也|正|在|自己|負責)|\(#local_|其他人|別人|他人|其餘|another session|other sessions?|someone else|someone's|判|列為|列進|標成|標為|視為|字眼|說法|正則|regex|正例|反例|這類|例如|像是|顯示|不能是|不算|才算|當成|當作|被當|(?<![小同即當準及按暫])時\s*$|(?<![小同即當準及按暫])時(?:就|會|才|便|也|一樣|照樣|仍|都)|的時候|的話|如果|假如|只要|一旦|回報(?:裡|中|上)?[^，,。]{0,4}?(?:說|寫|宣告|聲明|提到)|(?:流程|步驟|順序|做法|規則|規範|規定|慣例)(?:是|為|：|:)|\bthe (?:process|flow|order|rule) is\b|摘要[^，,。]{0,4}?(?:說|寫|宣告|聲明|提到)|提到|e\.g\.|for example|such as|\bif\b|\bwhen\b/i
/**
 * A clause that disowns what it speaks of: 我都沒有動, 沒碰, 不是我的, 不屬於這次, not mine, I didn't touch.
 * Its words, and the subject-less clause it disowns just before it, say nothing about this session's work.
 */
const DISCLAIMER =
  /(?<![還尚仍])(?:都|也|並|完全)?沒(?:有)?(?:動|碰|改動)(?![手工])(?:過|到)?|沒碰|不是我的|不是這次的|不屬於(?:這次|本次|我)|與我無關|not mine|isn't mine|aren't mine|weren't mine|\bI (?:didn't|did not|haven't|have not) touch|left (?:them|it|those|that) (?:alone|untouched)|untouched/i
/** Another session spoken of as 它 (it) or by its link, whose words may run on into the next clauses. */
const THEIRS = /它(?:們)?(?=會|將|就|再|要|先|已|還|也|正|在|自己|負責)|\(#local_/
/** A rule or a process laid out, whose words may run on into the next clauses: 流程是, 規範是, the process is. */
const RULE_LEAD = /(?:流程|步驟|順序|做法|規則|規範|規定|慣例)(?:是|為|：|:)|\bthe (?:process|flow|order|rule) is\b/i
/** A clause with its own I: what it says is this session's own. */
const FIRST_PERSON = /我|自己|這次|本次|\bI\b|\bwe\b|\bmy\b|\bour\b/i
/** The board, or what judges for it. */
const BOARD = /看板|\bboard\b|偵測器?|\bdetector\b/i
/** Judging, but not a misjudgment fixed (修了一個誤判, 誤判已修好: the work done, not the board's judging). */
const JUDGE =
  /判成|判定|判為|(?<!修[好掉正了復]?\s*(?:了|完)?\s*(?:一個|這個|那個|兩個|幾個)?\s*小?)(?:誤判|漏判|誤擋|漏擋)(?!\s*(?:已經?|都)?(?:修好|修正|修掉|解決))|列為|列進|標成|標為|顯示成|顯示為|\bflag(?:s|ged)? (?:it |them |this |that )?as\b|\bmark(?:s|ed)? (?:it |them |this |that )?as\b|\breads? (?:it |them |this |that )?as\b|\bmisread/i
/** A judging verb with a status after it: 列為待發布, 判成「已結束」, 標成需追蹤. */
const JUDGED_AS = /(?:判成|判為|列為|列進|標成|標為|顯示成|顯示為)\s*[「『"]?\s*(?:待發布|需追蹤|已結束|等待 ?CI|背景執行|待回覆|未完成|CI ?失敗|長期閒置|中斷)/

/**
 * A sentence that describes a judgment (the board's, a rule's) rather than this session's work: the board and a
 * judging word in it, or a judging verb with a status after it. Not 看板 or a status name alone (a product may
 * have a dashboard; 「2.4.3 待發布，還沒 push」 is a session's own state), not 列為 alone (列為待確認事項).
 */
function isJudging(sentence: string): boolean {
  return (BOARD.test(sentence) && JUDGE.test(sentence)) || JUDGED_AS.test(sentence)
}
/** What a possessive (X 的未提交修改) may name and still be this session's own: 我, this turn, now, here. */
const OWN = /我|自己|本次|這次|這個 ?Session|這邊|目前|現在|本機|本地|手上|剩下|剩餘|\bmy\b|\bour\b|this session/i

/** The commit the words name: the hash after "commit", else the first one that is not part of an id (local_…-9e0f1a2b3c4d). */
function commitOf(text: string): string | null {
  const named = /\bcommit\s*(?:是|為|:|：|hash)?\s*`?([0-9a-f]{7,40})\b/i.exec(text)?.[1]
  if (named) return named.toLowerCase()
  const any = [...text.matchAll(/(?<![0-9a-z_-])[0-9a-f]{7,40}(?![0-9a-z_-])/gi)].map(m => m[0]).find(w => /\d/.test(w) && /[a-f]/i.test(w))

  return any?.toLowerCase() ?? null
}
/** Quoted words name something (a status, a step, a phrase); backticks hold code and hashes. */
const QUOTED = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"|`[^`\n]*`/g

function deliveryKind(verb: string): DeliveryKind {
  if (/^(commit|committed|提交)$/i.test(verb)) return 'commit'
  if (/^(push|pushed|推送|推上)$/i.test(verb)) return 'push'

  return 'release'
}

function verbsIn(segment: string): DeliveryKind[] {
  return [...segment.matchAll(new RegExp(VERB, 'gi'))].map(m => deliveryKind(m[0]))
}

/**
 * What the words say is not delivered yet, read sentence by sentence: what a kind was last said to be
 * (not done, or done later on) decides it. A sentence about a rule or an example, quoted words and a
 * double negative (沒有任何未提交的修改) say nothing about the work.
 */
export function undeliveredOf(text: string): { kinds: DeliveryKind[]; sha: string | null } | null {
  const last = new Map<DeliveryKind, boolean>()
  // Rules, examples, quotes, someone else's work and what a clause disowns are gone (reportedText) before
  // anything is read: of what is left, a kind's last word stands.
  const plain = reportedText(text.replace(NOTHING_LEFT, ''))
  const isNoCode = hasNoCode(plain)
  // Sentences with what ends them: a question mark makes the sentence a question to the person.
  const pieces = plain.split(/([。！？!?；;\n]+|\.\s+)/)
  for (let p = 0; p < pieces.length; p += 2) {
    const whole = pieces[p]!
    const isQuestion = /[?？]/.test(pieces[p + 1] ?? '')
    // A wait anywhere in the sentence (沒有 push，等 PM 確認) keeps its bare negations: the work is still to come.
    const isWaiting = WAITING_TONE.test(whole)
    for (const sentence of whole.split(/[，,]+/)) {
      if (!sentence.trim()) continue
      const said: { at: number; kind: DeliveryKind; isLeft: boolean }[] = []
      for (const m of sentence.matchAll(NOT_DONE)) {
        // 版本 2.4.2 的未提交修改: undone, but someone else's, unless the owner named is this session.
        const before = sentence.slice(0, m.index ?? 0)
        const owner = /([^\s，,。]+(?:\s+[^\s，,。]+)?)\s*的\s*$/.exec(before)?.[1]
        if (owner && !OWN.test(owner)) continue
        // 沒有改程式，也沒有 push: nothing was there to push. Not 還沒 push (or "not pushed yet"), not 設定檔沒有 commit,
        // not while it waits.
        // 沒有另開 commit, 沒有新增 commit, 沒有用 force push: how it was done, not that it was not.
        const negation = m[1] ?? m[3] ?? ''
        const verbs = m[2] ?? m[4] ?? ''
        if (MANNER.test(m[0].slice(negation.length, m[0].length - verbs.length))) continue
        const isYet = YET.test(negation) || /^\s*yet\b/i.test(sentence.slice((m.index ?? 0) + m[0].length))
        // The no-code statement itself may stand just before it (沒有改程式、沒有 push): it is no other subject.
        if (isNoCode && !isYet && !isWaiting && BARE_PREFIX.test(before.replace(new RegExp(NO_CODE.source, 'gi'), ''))) continue
        for (const kind of verbsIn(m[2] ?? m[4] ?? '')) said.push({ at: m.index ?? 0, kind, isLeft: true })
      }
      for (const m of sentence.matchAll(DONE)) for (const kind of verbsIn(m[1] ?? m[2] ?? m[3] ?? '')) said.push({ at: m.index ?? 0, kind, isLeft: false })
      for (const m of sentence.matchAll(COMMITTED)) said.push({ at: m.index ?? 0, kind: 'commit', isLeft: false })
      for (const m of sentence.matchAll(NO_NEED)) {
        const named = m[1] ?? m[2] ?? ''
        const kinds = /版號|升版|標籤|tag/i.test(named) ? (['release'] as const) : verbsIn(named)
        for (const kind of kinds) said.push({ at: m.index ?? 0, kind, isLeft: false })
      }
      for (const m of sentence.matchAll(AWAITING_GO)) said.push({ at: m.index ?? 0, kind: 'release', isLeft: true })
      // Its own delivery said as what comes next: not an offer to the person, not a question to them, not a "won't".
      if (!OFFER.test(sentence) && !YOURS.test(sentence) && !isQuestion) {
        for (const m of sentence.matchAll(FUTURE)) {
          // The marker's own words (通過後) aside: a negation or a past in what follows it.
          if (NOT_FUTURE.test(m[0].replace(/^(?:之後|稍後|待會兒?|晚點|接下來|下一步|再來|明天|今晚|下午|下週|隨後|然後|預計|打算|準備|將|(?:確認|通過|審核|審查|放行|review|合併|完成|跑完|結束)後)/i, ''))) continue
          // A verb that goes on into a consequence or a noun (commit 再 push 就會更新, 部署時, 部署的): not a step to take.
          if (NOUN_AFTER.test(sentence.slice((m.index ?? 0) + m[0].length))) continue
          const named = m[1] ?? m[2] ?? ''
          const kinds = /^推$/.test(named) ? (['push'] as const) : verbsIn(named)
          for (const kind of kinds) said.push({ at: m.index ?? 0, kind, isLeft: true })
        }
      }
      for (const one of said.sort((a, b) => a.at - b.at)) last.set(one.kind, one.isLeft)
    }
  }
  const kinds = (['commit', 'push', 'release'] as const).filter(kind => last.get(kind))

  return kinds.length ? { kinds, sha: commitOf(text) } : null
}

/** The words leave work undelivered, and git has not shown the one push they left to be done since. */
function isUndelivered(text: string, push: PushCheck | undefined): boolean {
  const left = undeliveredOf(text)
  if (!left) return false
  const isOnlyPush = left.kinds.length === 1 && left.kinds[0] === 'push'

  return !(isOnlyPush && push?.words === text && push.isPushed)
}

/** Runs git with these arguments in the session's folder: its standard output, or null when it failed. */
export type Git = (args: string[]) => Promise<string | null>

/** More files than this, and a commit's content is not compared (an argument list has its limits): it reads as not pushed. */
const CONTENT_FILES = 200
/** How many of a remote branch's commits that touched those files are compared, newest first. */
const CONTENT_COMMITS = 20
/** How many local branches holding a commit, and of its descendants on each, are tried, newest first. */
const DESCENDANT_TIPS = 3
const DESCENDANTS = 5

/** Each file's blob in `commit`, from `git ls-tree -r -z`; a file absent there is absent here. */
async function blobsOf(git: Git, commit: string, files: string[]): Promise<Map<string, string> | null> {
  const out = await git(['ls-tree', '-r', '-z', commit, '--', ...files])
  if (out === null) return null
  const blobs = new Map<string, string>()
  for (const entry of out.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t')
    const [, , blob] = entry.slice(0, tab).split(' ')
    if (tab > 0 && blob) blobs.set(entry.slice(tab + 1), blob)
  }

  return blobs
}

function isSameContent(a: Map<string, string>, b: Map<string, string>, files: string[]): boolean {
  return files.every(f => a.get(f) === b.get(f))
}

/**
 * Whether the files `sha` changed (since its merge-base with a remote branch) hold, at that branch's tip or at
 * one of its commits since the base that touched them, exactly what they hold in `sha`: its content reached
 * the remote, as itself, rebased, cherry-picked or as the last of several commits squashed into one.
 */
async function isContentOnRemote(git: Git, sha: string, remotes: string[]): Promise<boolean> {
  for (const remote of remotes) {
    const base = await git(['merge-base', sha, remote])
    if (!base) continue
    const files = ((await git(['-c', 'core.quotepath=off', 'diff', '--name-only', '-z', base, sha])) ?? '').split('\0').filter(Boolean)
    // Nothing of its own beyond the base the remote already holds.
    if (files.length === 0) return true
    if (files.length > CONTENT_FILES) continue
    const mine = await blobsOf(git, sha, files)
    if (!mine) continue
    const touched = ((await git(['log', '--format=%H', `-${CONTENT_COMMITS}`, `${base}..${remote}`, '--', ...files])) ?? '').split('\n').filter(Boolean)
    for (const commit of [remote, ...touched]) {
      const theirs = await blobsOf(git, commit, files)
      if (theirs && isSameContent(mine, theirs, files)) return true
    }
  }

  return false
}

/**
 * Whether what `sha` changed has reached a remote branch: the commit itself is on one; or its content is
 * (isContentOnRemote); or the content of one of its descendants on a local branch is, newest first. The last
 * covers an earlier commit of several squashed into one: its lines may have been edited again by the later
 * ones, so only the squash's last commit matches the pushed content, and that commit holds this one's work.
 *
 * Anything else reads as not pushed, even when the remote holds the work in another form (only part of it,
 * or edited on top before any match): the safe way, since a work item wrongly kept undelivered shows and can
 * be closed by hand, while one wrongly delivered disappears from the board.
 */
export async function isPushedContent(git: Git, sha: string): Promise<boolean> {
  if (await git(['branch', '-r', '--contains', sha])) return true
  const refs = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])) ?? ''
  const remotes = refs.split('\n').map(r => r.trim()).filter(r => r && !r.endsWith('/HEAD') && r.includes('/'))
  if (remotes.length === 0) return false
  if (await isContentOnRemote(git, sha, remotes)) return true
  const tips = ((await git(['for-each-ref', '--contains', sha, '--format=%(objectname)', 'refs/heads'])) ?? '').split('\n').filter(Boolean)
  const tried = new Set<string>()
  for (const tip of tips.slice(0, DESCENDANT_TIPS)) {
    const after = ((await git(['rev-list', '--ancestry-path', `-${DESCENDANTS}`, `${sha}..${tip}`])) ?? '').split('\n').filter(Boolean)
    for (const later of after) {
      if (tried.has(later)) continue
      tried.add(later)
      if (await isContentOnRemote(git, later, remotes)) return true
    }
  }

  return false
}

/** What a session still has to deliver, as people read it. */
export function deliveryText(kinds: DeliveryKind[]): string {
  return kinds.map(k => t(`delivery.${k}`)).join(t('list.joiner'))
}

/**
 * The recap, when it says something is left: work not done, verified or tested (read like every report, quotes,
 * rules and someone else's work aside), or delivery left that the latest words still leave undone, as the
 * board reads it: gone once git shows the one push left done (the same check as *Not released*).
 */
export function caveatOf(track: Track | undefined, push?: PushCheck): string | null {
  const recap = track?.recap
  if (!recap) return null
  if (CAVEAT.test(reportedText(recap.replace(NOTHING_LEFT, '')))) return recap

  return undeliveredOf(recap) && isUndelivered(latestWords(track), push) ? recap : null
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

export function statusOf(one: Session, track: Track | undefined, word: LastWord | undefined, now: number, ci?: CiCheck, push?: PushCheck): Status {
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
    if (WAITING.test(reportedText(track.lastAnswer)) && minutes < WAITING_MINUTES) return 'waiting'
    if (openSteps(track).length > 0) return 'open'
    // Not committed, pushed or released, however ticked its task list (wrap_up ticks every step).
    if (isUndelivered(latestWords(track), push)) return 'unreleased'
  } else {
    if (word?.isAsking) return 'asking'
    const pending = word ? ciStatus(word.said, ci) : null
    if (pending) return pending
    if (word?.isWaiting && minutes < WAITING_MINUTES) return 'waiting'
    if (word && isUndelivered(word.said, push)) return 'unreleased'
  }

  return minutes > STALE_DAYS * 24 * 60 ? 'stale' : 'done'
}

export function ago(iso: string | number, now: number): string {
  const at = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(at) || at === 0) return t('time.unknown')
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 1) return t('time.now')
  if (min < 60) return t('time.minutes', { n: min })
  const hours = Math.round(min / 60)
  if (hours < 24) return t('time.hours', { n: hours })

  return t('time.days', { n: Math.round(hours / 24) })
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Parses list_sessions' JSON text; archived sessions are left out. */
export function parseSessions(text: string): Session[] {
  const rows: unknown = JSON.parse(text)
  if (!Array.isArray(rows)) throw new Error(t('error.notArray'))

  return rows.flatMap(row => {
    if (typeof row !== 'object' || row === null) return []
    const o = row as Record<string, unknown>
    if (typeof o.sessionId !== 'string' || o.isArchived === true) return []

    return [
      {
        id: o.sessionId,
        title: typeof o.title === 'string' && o.title ? o.title : t('session.untitled'),
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
    isWaiting: isLast && !isAsking && WAITING.test(reportedText(said.body)),
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
  push?: Record<string, PushCheck>
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
  const push = input.push ?? {}
  const rows = sessions
    .map(one => ({ one, track: tracks[one.id], word: words[one.id], status: statusOf(one, tracks[one.id], words[one.id], now, ci[one.id], push[one.id]) }))
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank)
  const lines: string[] = []
  lines.push(t('board.title', { project: project.name }), t('board.path', { path: project.path }))
  const count = (s: Status) => rows.filter(r => r.status === s).length
  lines.push(
    t('board.counts', {
      total: rows.length,
      asking: count('asking'),
      failed: count('failed'),
      ci: count('ci'),
      unreleased: count('unreleased'),
      open: count('open'),
      running: count('running'),
      waiting: count('waiting'),
      done: count('done'),
      stale: count('stale'),
    }),
  )

  const counted = ledger.filter(item => item.status !== 'dropped')
  if (counted.length) lines.push(t('board.progress', { done: counted.filter(i => i.status === 'done').length, total: counted.length }))

  const attention: string[] = []
  for (const r of rows) {
    const name = t('board.name', { title: r.one.title, id: r.one.id })
    if (r.status === 'asking') attention.push(t('board.attention.asking', { name, said: clip(r.track?.ask ?? r.track?.lastAnswer ?? r.word?.said ?? '', 200) }))
    if (r.status === 'open') {
      const left = openSteps(r.track)
      attention.push(t('board.attention.open', { name, n: left.length, steps: left.map(s => s.content).join(t('list.steps')) }))
    }
    if (r.status === 'ci') attention.push(t('board.attention.ci', { name, said: clip(ciWords(r.track, r.word), 200) }))
    if (r.status === 'unreleased') {
      const words = ciWords(r.track, r.word)
      attention.push(t('board.attention.unreleased', { name, kinds: deliveryText(undeliveredOf(words)?.kinds ?? []), said: clip(words, 200) }))
    }
    if (r.status === 'failed') {
      const target = ci[r.one.id]?.target || t('board.attention.failedTarget')
      attention.push(t('board.attention.failed', { name, target, said: clip(ciWords(r.track, r.word), 200) }))
    }
    const caveat = caveatOf(r.track, push[r.one.id])
    if (caveat && !['running', 'ci', 'failed', 'unreleased'].includes(r.status)) attention.push(t('board.attention.caveat', { name, said: clip(caveat, 200) }))
    if (r.one.hasOpenPr && r.status !== 'running') attention.push(t('board.attention.pr', { name }))
  }
  const openLedger = ledger.filter(item => item.status === 'open')
  const known = new Set(everyone.map(s => s.id))
  for (const item of openLedger) {
    if (!item.owner) attention.push(t('board.attention.unassigned', { code: itemCode(item.id), text: item.text }))
    else if (!known.has(item.owner)) attention.push(t('board.attention.lost', { code: itemCode(item.id), text: item.text, owner: item.owner }))
  }
  const inProject = new Set(sessions.map(s => s.id))
  /** An owner as the ledger shows it: its title and status, and whether it works from another project's folder. */
  const ownerText = (id: string | null) => {
    if (!id) return t('board.owner.unassigned')
    const one = everyone.find(s => s.id === id)
    if (!one) return t('board.owner.gone', { id })
    const status = statusOf(one, tracks[id], words[id], now, ci[id], push[id])

    return t('board.owner.status', { title: one.title, tag: STATUS[status].tag, elsewhere: inProject.has(id) ? '' : t('board.owner.elsewhere') })
  }
  lines.push('', t('board.section.attention'), attention.length ? attention.join('\n') : t('board.none'))

  lines.push('', t('board.section.items'))
  const shown = input.isIncludingDone ? ledger : openLedger
  if (shown.length === 0) lines.push(openLedger.length === 0 && ledger.length > 0 ? t('board.allDone') : t('board.none'))
  for (const item of shown) {
    const note = item.note ? t('board.itemNote', { note: item.note }) : ''
    lines.push(t('board.item', { code: itemCode(item.id), id: item.id, status: item.status, text: item.text, owner: ownerText(item.owner), note }))
  }

  lines.push('', '## Sessions')
  let listed = 0
  for (const r of rows) {
    const isOwner = openLedger.some(item => item.owner === r.one.id)
    if (!input.isIncludingDone && !isActive(r.status) && !caveatOf(r.track, push[r.one.id]) && !r.one.hasOpenPr && !isOwner) continue
    listed += 1
    const flags = [r.one.hasOpenPr ? t('board.flag.pr') : '', r.one.isPinned ? t('board.flag.pinned') : ''].filter(Boolean).join(t('list.joiner'))
    lines.push(`### [${STATUS[r.status].tag}] ${r.one.title} (${r.one.id})`)
    lines.push(t('board.lastActive', { ago: ago(r.one.lastActivityAt, now), flags: flags ? t('board.flags', { flags }) : '' }))
    if (r.track) {
      if (r.track.plan.length) {
        const steps = r.track.plan.map(s => `${STEP_MARK[s.status]} ${s.content}`).join(' / ')
        lines.push(t('board.tasks', { done: r.track.plan.filter(s => s.status === 'completed').length, total: r.track.plan.length, steps }))
      }
      if (r.track.lastPrompt) lines.push(t('board.prompt', { text: clip(r.track.lastPrompt, 160) }))
      if (r.track.recap) lines.push(t('board.recap', { text: clip(r.track.recap, 300) }))
      else if (r.track.lastAnswer) lines.push(t('board.answer', { text: clip(r.track.lastAnswer, 300) }))
      if (r.track.ask) lines.push(t('board.ask', { text: r.track.ask }))
      const background = backgroundOf(r.track, now)
      if (background.length) {
        const tasks = background.map(task => t('board.backgroundTask', { label: clip(task.label, 80), ago: ago(task.at, now) })).join(t('list.steps'))
        lines.push(t('board.background', { n: background.length, tasks }))
      }
    } else {
      const said = r.word?.error ? t('board.readFailed', { error: r.word.error }) : (r.word?.said ?? t('board.reading'))
      lines.push(t('board.untracked', { said }))
    }
  }
  const hidden = rows.length - listed
  if (hidden > 0) lines.push('', t('board.hidden', { n: hidden }))

  return lines.join('\n')
}

export function emptyProject(key: string, name: string, path: string): ProjectFile {
  return { key, name, path, pmId: null, isDismissed: false, ledger: [], nextId: 1 }
}
