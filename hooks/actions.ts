// What the PM does: who this session is, reading the other sessions, the
// files each session and project keep, claiming a project, and the PM's tools.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult } from 'claude-code'

import type { LastWord, LedgerItem, Me, Notice, ProjectFile, Session, Sessions, Track } from '../types'
import {
  boardText,
  emptyProject,
  groupProjects,
  isScratch,
  itemCode,
  keyFile,
  openSteps,
  parseLastWord,
  parseSessions,
  projectKey,
  projectName,
  projectPath,
  statusOf,
} from './sessions'
import type { Project, Status } from './sessions'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)
const sessions = atom({ plugin: 'project-pm', key: 'sessions' } as const, { list: [], fetchedAt: 0, error: null } as Sessions)
const tracks = atom({ plugin: 'project-pm', key: 'tracks' } as const, {} as Record<string, Track>)
const lastWords = atom({ plugin: 'project-pm', key: 'lastWords' } as const, {} as Record<string, LastWord>)
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

export async function changeMine($: EngineInterface, change: (track: Track) => Track) {
  if (!mine) return
  mine = change(mine)
  await saveMine($)
}

// ── Who this session is ──

export async function identify($: EngineInterface): Promise<Me | null> {
  const known = await read($, me)
  if (known?.id) return known
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
  if (id && !mine) {
    const kept = await readJson<Track>($, `${await dataDir($)}/sessions/${id}.json`)
    mine = kept ?? { id, title, cwd, plan: [], recap: null, ask: null, lastPrompt: '', lastAnswer: '', turnAt: 0, planAt: 0 }
    mine = { ...mine, title: title || mine.title, cwd }
    void saveMine($)
  }

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
    if (track) {
      fresh[id] = track
      trackSeen.set(id, entry.mtimeMs)
    }
  }
  if (Object.keys(fresh).length === 0) return
  await update($, tracks, all => {
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => wanted.has(id)))

    return { ...kept, ...fresh }
  })
}

/** Reads the last word of untracked sessions that did something since they were last read. */
export async function catchUp($: EngineInterface, list: Session[]) {
  const known = await read($, lastWords)
  const tracked = await read($, tracks)
  const stale = list.filter(one => !tracked[one.id] && known[one.id]?.activity !== one.lastActivityAt).slice(0, WORDS_PER_ROUND)
  if (stale.length === 0) return
  const fresh: Record<string, LastWord> = {}
  for (const one of stale) fresh[one.id] = await readLastWord($, one)
  await update($, lastWords, all => {
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => list.some(s => s.id === id)))

    return { ...kept, ...fresh }
  })
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
  const all = await read($, tracks)
  const words = await read($, lastWords)
  const now = await $.clock.now()
  const now_ = new Map<string, Status>()
  for (const one of state.list) {
    if (projectKey(one.cwd) !== self.projectKey) continue
    now_.set(one.id, statusOf(one, all[one.id], words[one.id], now))
  }
  const before = statusesBefore
  statusesBefore = now_
  if (!before) return
  for (const [id, status] of now_) {
    if (before.get(id) === status) continue
    const title = state.list.find(s => s.id === id)?.title ?? id
    if (status === 'asking') $.ui.toast(`「${title}」待你回覆`)
    if (status === 'open') $.ui.toast(`「${title}」已停止，仍有 ${openSteps(all[id]).length} 項步驟未完成`)
  }
}

export async function refresh($: EngineInterface, isForced = false) {
  const self = await read($, me)
  const isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (!isForced && !self?.isPm && !isPaneOpen) return
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
4. 一個工作項目只有在你確認對應 Session 真的做完（看板上沒有未完成步驟、收尾摘要沒提到還沒做的事，必要時用 list_events 看它的紀錄）之後，才用 ledger update 標成 done。
5. 說「都完成了」之前，看板的「需要處理」必須是空的、工作項目沒有 open；不是的話，逐條列出還差什麼。
6. 子 Session 在等使用者回覆時，把它的問題原文轉述給使用者，使用者回答後用 SendMessage 轉達回去。
7. 封存 Session 前先確認它沒有未完成步驟、沒有開著的 PR，並問過使用者。
8. 提到 Session 時用 [標題](#local_…) 連結它。`

export async function registerTools($: EngineInterface) {
  await $.tool.register({
    name: 'board',
    description:
      '專案狀態報告：列出此專案所有子 Session 的狀態（執行中、待回覆、中斷・未完成、背景執行、已結束）、任務清單進度、最新指令與收尾摘要，以及工作項目和需要處理的事項。回報進度或判斷是否有遺漏前必須先呼叫。',
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
        tracks: all,
        words,
        ledger: files[p.key]?.ledger ?? [],
        now,
        isIncludingDone,
      }),
    )
    .join('\n\n---\n\n')
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

