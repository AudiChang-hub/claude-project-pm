import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUOTE, applyPlan, betterCi, boardText, caveatOf, ledgerRow, ledgerText, ciTarget, ciTargets, ciVerdict, declaredOf, isCiPending, isDeliveredAgent, isDeliveredStatus, isPushedContent, keyFile, leftOf, ownCommitOf, parseLastWord, projectKey, reportOf, reportWords, statusOf, undeliveredOf } from '../hooks/sessions'
import type { Status } from '../hooks/sessions'
import { closesBoard } from '../hooks/actions'
import { isQaDescription, qaAttention, qaBlocker, qaShown, qaUpdate } from '../hooks/qa'
import { commitOfLine, isSettledAgent, itemOf, noticesOf, settledAgentState, stateOf } from '../hooks/agents'
import { MESSAGES, getLang, placeholders, resolveLang, setLang, t } from '../hooks/messages'
import type { Lang, MessageKey } from '../hooks/messages'
import { installOf, isReplaced } from '../hooks/update'

const NOW = Date.parse('2026-10-17T12:00:00.000Z')
/** The tests that read the mod's words read them in Traditional Chinese, whatever the machine's language. */
const ZH = { options: { language: 'zh-TW' } } as const
const PROJECT = 'C:\\Users\\dev\\Projects\\Acme 商店後台'
const DIR = 'C:/home/.claude/project-pm'
const PROJECT_FILE = `${DIR}/projects/${keyFile(projectKey(PROJECT))}.json`

const SESSIONS = [
  { sessionId: 'local_open', title: '商品列表頁', cwd: PROJECT, isArchived: false, isRunning: false, lastActivityAt: '2026-10-17T11:50:00.000Z' },
  { sessionId: 'local_ask', title: '移除舊版優惠欄位', cwd: `${PROJECT}\\.claude\\worktrees\\x`, isArchived: false, isRunning: false, lastActivityAt: '2026-10-17T11:40:00.000Z' },
  { sessionId: 'local_run', title: '金流對帳', cwd: PROJECT, isArchived: false, isRunning: true, lastActivityAt: '2026-10-17T11:59:00.000Z' },
  { sessionId: 'local_other', title: '別的專案', cwd: 'C:\\Users\\dev\\Projects\\Weather app', isArchived: false, isRunning: false, lastActivityAt: '2026-10-17T10:00:00.000Z' },
]

const track = (id: string, extra: object) => ({
  id,
  title: id,
  cwd: PROJECT,
  plan: [],
  recap: null,
  ask: null,
  lastPrompt: '',
  lastAnswer: '',
  turnAt: NOW - 600000,
  planAt: NOW - 600000,
  ...extra,
})

type Files = Map<string, string>
type Pane = { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }
/** What the mod asked of the disk and the app: files read and written, the app's tools called; `isAppAway` while a resumed session has no app tools yet. */
type Counts = { reads: number; calls: string[]; writes?: string[]; isAppAway?: boolean }

/** The test host spells paths its own way: compare them by what follows the data folder. */
// On Linux a Windows path is not absolute, so the host puts the working folder before it: the drive starts the path.
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^.*\/\.claude\/project-pm/, DIR).replace(/^.+\/(?=[a-z]:\/)/i, '')

/** What a host command answers: null for a command that is not there (no gh, no repository). */
type Host = (argv: readonly string[], cwd: string | undefined) => { exitCode: number; stdout: string } | null

/** The desktop app, the disk and the host's commands, from memory: `self` is this session's id. */
function world(on: On, self: string, files: Files, archived: string[] = [], host: Host = () => null, tools: string[] = [], panes: Pane[] = [], counts: Counts = { reads: 0, calls: [] }) {
  let list = [...SESSIONS]
  on('process.run', ($, e) => {
    const out = host(e.argv, e.init?.cwd)
    if (!out) throw new Error(`${e.argv[0]}: command not found`)

    return { value: { ...out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.env(on, { USERPROFILE: 'C:\\home' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: PROJECT }))
  on('session.id', () => ({ value: `transcript-${self}` }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // `tools` holds what the engine has registered now: a test empties it where the engine drops them.
  on('tool.register', ($, e) => {
    tools.push(e.name)

    return { value: { tool: `mcp__project-pm__${e.name}` } }
  })
  on('tool.list', () => ({ value: tools.map(name => ({ name: `mcp__project-pm__${name}`, description: name, mcp: true })) }))
  // The engine's panes: a test empties `panes` where the engine drops them (a new process, an unload).
  on('ui.open', ($, e) => {
    const open = panes.find(pane => pane.id === e.id)
    if (open) open.isPlaced = true
    else panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [...panes] }))
  on('ui.close', ($, e) => {
    const at = panes.findIndex(pane => pane.id === e.id)
    if (at >= 0) panes.splice(at, 1)

    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: files.has(norm(e.path)) || [...files.keys()].some(k => k.startsWith(`${norm(e.path)}/`)) }))
  on('fs.read', ($, e) => {
    counts.reads += 1
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: text }
  })
  on('fs.write', ($, e) => {
    counts.writes?.push(norm(e.path))
    files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const dir = norm(e.path)

    return {
      value: [...files.keys()]
        .filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
        .map(k => ({ name: k.slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: files.get(k)!.length, isLink: false })),
    }
  })
  on('mcp.call', ($, e) => {
    counts.calls.push(e.tool)
    if (counts.isAppAway) return { value: { content: [{ type: 'text' as const, text: 'not connected' }], isError: true } }
    const text = (t: string) => ({ value: { content: [{ type: 'text' as const, text: t }], isError: false } })
    if (e.tool === 'get_session') return text(JSON.stringify({ sessionId: self, title: '我', cwd: PROJECT }))
    if (e.tool === 'list_sessions') return text(JSON.stringify(list))
    if (e.tool === 'list_events') return text('[assistant] 已修好。\n[result] done (success), 1 turns')
    if (e.tool === 'archive_session') {
      archived.push(String(e.args?.session_id))
      list = list.filter(s => s.sessionId !== e.args?.session_id)

      return text('Archived.')
    }

    return { value: { content: [{ type: 'text' as const, text: 'unknown' }], isError: true } }
  })
}

const START = { cwd: PROJECT, surface: 'desktop', isInteractive: true } as const

test('a session keeps its own task list and recap on disk', ZH, async ($, on) => {
  const files: Files = new Map()
  mock.clock(on, { now: NOW })
  world(on, 'local_me', files)
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, () => ({ result: 'ok' }))
  await $.session.start(START)

  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: '讀程式', status: 'in_progress' }, { content: '改欄位', status: 'pending' }, { content: '測試', status: 'pending' }] } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
  const mid = JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!)
  expect(mid.plan.map((s: { status: string }) => s.status)).toEqual(['completed', 'in_progress', 'pending'])

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: '欄位已移除，還沒部署。', ask: '要部署嗎？' } as never)
  const end = JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!)
  expect(end.recap).toBe('欄位已移除，還沒部署。')
  expect(end.ask).toBe('要部署嗎？')
  expect(end.plan.every((s: { status: string }) => s.status === 'completed')).toBe(true)
})

test('the PM board puts what is left first, and the ledger tracks what was asked', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { plan: [{ content: '畫表格', status: 'completed' }, { content: '加篩選', status: 'pending' }] })))
  files.set(`${DIR}/sessions/local_ask.json`, JSON.stringify(track('local_ask', { ask: '要一起發 2.3.1 嗎？' })))
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)

  const shown = await $.tool.call({ tool: 'mcp__project-pm__board' } as never)
  const text = String((shown as { result?: unknown }).result)
  expect(text).toMatch(/## 需要處理/)
  expect(text).toMatch(/\[中斷・未完成\] 「商品列表頁」\(local_open\) 已停止，任務清單仍有 1 項未完成：加篩選/)
  expect(text).toMatch(/\[待回覆\] 「移除舊版優惠欄位」\(local_ask\) 等待使用者決策：要一起發 2.3.1 嗎？/)
  // Another project's session stays off this project's board.
  expect(text).not.toMatch(/別的專案/)

  await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'add', text: '列表頁加匯出 CSV' } as never)
  const after = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(after).toMatch(/工作項目 T-01「列表頁加匯出 CSV」尚未指派負責 Session/)

  await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, owner: 'local_open' } as never)
  const assigned = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(assigned).toMatch(/T-01 \(id 1\) \[open\] 列表頁加匯出 CSV｜負責：商品列表頁/)
  expect(assigned).not.toMatch(/尚未指派負責/)
})

test('the pane shows the project, and archives after a confirm', ZH, async ($, on) => {
  const files: Files = new Map()
  const archived: string[] = []
  const item = (id: number, status: string) => ({ id, text: `項目 ${id}`, owner: 'local_open', status, note: '', createdAt: NOW, updatedAt: NOW })
  const ledger = [item(1, 'done'), item(2, 'open'), item(3, 'dropped')]
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger, nextId: 4 }))
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { plan: [{ content: '畫表格', status: 'completed' }, { content: '加篩選', status: 'pending' }] })))
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, archived)
  await $.session.start(START)
  await clock.advance(400)

  const ui = await $.ui.mount({
    plugin: 'project-pm',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'project-pm',
    props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
  } as never)
  expect(await ui.find({ type: 'Text', text: 'Acme 商店後台' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ 加篩選/ })).toBeDefined()
  expect(await ui.find({ key: 'archive:local_run' })).toBeUndefined()

  // Progress counts the ledger, not the sessions' own checklists.
  expect(await ui.find({ type: 'Text', text: '50%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '工作項目完成 1/2' })).toBeDefined()

  await ui.press({ key: 'archive:local_open' })
  expect(await ui.find({ type: 'Text', text: /尚有 1 項步驟未完成/ })).toBeDefined()
  await ui.press({ key: 'yes:local_open' })
  expect(archived).toEqual(['local_open'])

  await ui.press({ key: 'scope:all' })
  expect(await ui.find({ type: 'Text', text: 'Weather app' })).toBeDefined()
  await ui.unmount()
})

test('task list updates replay as the desktop app sends them', () => {
  const plan = applyPlan([], { items: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'pending' }] })
  const advanced = applyPlan(plan, { advance: true })
  expect(advanced.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending'])
  const jumped = applyPlan(advanced, { done: [2], start: 3 })
  expect(jumped.map(s => s.status)).toEqual(['completed', 'completed', 'in_progress'])

  const session = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(session, track('x', { plan: advanced }) as never, undefined, NOW)).toBe('open')
  expect(statusOf(session, track('x', { plan: jumped.map(s => ({ ...s, status: 'completed' })) }) as never, undefined, NOW)).toBe('done')
})

test('work whose CI is still running is never done', () => {
  const twoDaysAgo = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 2 * 24 * 3600000).toISOString(), isPinned: false, hasOpenPr: false }
  const said = (lastAnswer: string, recap: string | null = null) => statusOf(twoDaysAgo, track('x', { lastAnswer, recap }) as never, undefined, NOW)

  expect(said('已推上 main（3fa1c2e），CI 還在跑，通過後才會打標籤和部署。')).toBe('ci')
  expect(said('已回覆對方。', '2.4.0 已推上 main，等 CI 通過後我會部署。')).toBe('ci')
  expect(said('Pushed to main; waiting for CI before tagging.')).toBe('ci')
  expect(said('CI 已通過，已打標籤並部署 2.3.1。')).toBe('done')
  expect(said('CI 跑完了，已部署 2.3.1。')).toBe('done')
  expect(said('先前 CI 還在跑，現在 CI 已通過並完成部署。')).toBe('done')
  expect(said('已修好返回鍵。')).toBe('done')
})

test('the ledger will not close an item while its session waits on CI', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '列表頁加匯出 CSV', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { recap: '已推上 main，CI 還在跑，還沒部署。' })))
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/\[等待 CI・未完成\] 「商品列表頁」\(local_open\) 最後回報 CI 尚未跑完/)

  const refused = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)
  // The verdict is kept; only the close is refused, and the answer says both.
  expect(refused).toMatch(/^QA 已記錄，但結案被擋：無法將 T-01 標記為完成：負責的 Session「商品列表頁」CI 尚未跑完/)
  expect(JSON.parse(files.get(PROJECT_FILE)!).ledger[0]).toMatchObject({ status: 'open', qa: { result: 'pass', by: 'user' } })

  // Only the person's explicit word, written down, closes it anyway.
  await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', force: true, note: '使用者確認 CI 已在 GitHub 上通過' } as never)
  expect(JSON.parse(files.get(PROJECT_FILE)!).ledger[0].status).toBe('done')
})

test('a session the app did not know at its start is tracked once it is known', ZH, async ($, on) => {
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  let isKnown = false
  // Registered ahead of the world's own mcp.call hook: get_session fails until the app has registered the session.
  on('mcp.call', { tool: 'get_session' }, ($, e, next) =>
    isKnown ? next(e) : { value: { content: [{ type: 'text' as const, text: 'session not found' }], isError: true } },
  )
  world(on, 'local_late', files)
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, () => ({ result: 'ok' }))
  await $.session.start(START)
  expect(files.has(`${DIR}/sessions/local_late.json`)).toBe(false)

  isKnown = true
  await clock.advance(31_000)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: '合併欄位', status: 'in_progress' }] } as never)
  const kept = JSON.parse(files.get(`${DIR}/sessions/local_late.json`)!)
  expect(kept.plan).toEqual([{ content: '合併欄位', status: 'in_progress' }])
})

test('an empty track does not hide a transcript that says CI is still running', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '合併重複的出貨日期欄位', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  // What a session writes when its module reloads, before its next turn ends: nothing yet.
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', {})))
  const clock = mock.clock(on, { now: NOW })
  on('mcp.call', { tool: 'list_events' }, ($, e, next) =>
    e.args?.session_id === 'local_open'
      ? { value: { content: [{ type: 'text' as const, text: '[assistant] 2.3.2 已推上 main，CI 正在跑，大約要 22 分鐘，我在背景等結果。\n[result] done (success), 8 turns' }], isError: false } }
      : next(e),
  )
  world(on, 'local_pm', files)
  await $.session.start(START)
  await clock.advance(400)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/\[等待 CI・未完成\] 「商品列表頁」\(local_open\)/)

  const ui = await $.ui.mount({
    plugin: 'project-pm',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'project-pm',
    props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
  } as never)
  // It owns open work and waits on CI: a card in sight, not a row among the ended.
  expect(await ui.find({ key: 'card:local_open' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '等待 CI' })).toBeDefined()
  await ui.unmount()
})

test('a recap stands only for the turn that wrote it', ZH, async ($, on) => {
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_me', files)
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(START)
  const turn = (answer: string) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: '2.4.0 已推上 main，CI 還在跑，通過後才會打標籤和部署。' } as never)
  await turn('已推上 main，我在背景等 CI。')
  expect(JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!).recap).toMatch(/CI 還在跑/)

  // Woken later by a notification, the session answers without a wrap_up of its own (and no prompt.submit).
  await clock.advance(30 * 60000)
  await turn('已打標籤 v2.4.0 並部署到正式站。')
  const kept = JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!)
  expect(kept.recap).toBe(null)
  const idle = { id: 'local_me', title: '我', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW + 30 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, kept, undefined, NOW + 31 * 60000)).toBe('done')
})

test('a track that missed later turns gives way to the transcript', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '商品總覽頁面', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  // Written when it pushed; the turns that saw CI pass and deployed never reached the file. The app saw them (11:50).
  const pushedAt = Date.parse('2026-10-17T11:31:00.000Z')
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(
      track('local_open', {
        plan: [{ content: '等 CI 通過後打標籤', status: 'completed' }],
        recap: '2.4.0 已推上 main（3fa1c2e）。CI 還在跑，通過後才會打標籤和部署；目前還沒部署。',
        lastAnswer: '還沒完成：CI 還在跑，大約 25 分鐘，我在背景等結果。',
        turnAt: pushedAt,
        planAt: pushedAt,
      }),
    ),
  )
  const clock = mock.clock(on, { now: NOW })
  const transcript = '[assistant] 「商品總覽」已經上線，正式站現在是 2.4.0。\n[assistant] (called mcp__ccd_turn__wrap_up)\n[assistant] 已部署 2.4.0，正式站驗證通過。\n[result] done (success), 14 turns'
  on('mcp.call', { tool: 'list_events' }, ($, e, next) =>
    e.args?.session_id === 'local_open' ? { value: { content: [{ type: 'text' as const, text: transcript }], isError: false } } : next(e),
  )
  world(on, 'local_pm', files)
  await $.session.start(START)
  await clock.advance(400)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/### \[已結束\] 商品列表頁 \(local_open\)/)
  expect(board).not.toMatch(/等待 CI・未完成\] 「商品列表頁」/)
  expect(board).not.toMatch(/\[需追蹤\] 「商品列表頁」/)
  expect(board).toMatch(/最後回報：已部署 2.4.0，正式站驗證通過。/)

  const closed = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)
  expect(closed).toMatch(/已更新工作項目 T-01/)
})

test('GitHub decides whether CI the words left running is still running', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '商品總覽頁面', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(track('local_open', { lastAnswer: '已推上 main（`3fa1c2e`），CI 還在跑，通過後才會打標籤和部署。', turnAt: at, planAt: at })),
  )
  const FULL = '3fa1c2e9d84b07a6c5e1f2039b8d7c6a5e4f3d21'
  let runs: object[] | null = [{ status: 'in_progress', conclusion: null }]
  const asked: string[] = []
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], (argv, cwd) => {
    asked.push(`${argv.join(' ')} @ ${cwd}`)
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return { exitCode: 0, stdout: `${FULL}\n` }
    if (argv[0] === 'gh' && runs) return { exitCode: 0, stdout: JSON.stringify(runs) }

    return null
  })
  await $.session.start(START)
  await clock.advance(400)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  const close = async () =>
    String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)

  // Still running on GitHub: the old guard stands.
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)
  expect(asked).toContain(`gh run list --commit ${FULL} --limit 20 --json status,conclusion,workflowName @ ${PROJECT}`)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」CI 尚未跑完/)

  // GitHub can't be asked: the words alone decide, as before.
  runs = null
  await clock.advance(61_000)
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)

  // Failed: something to handle, not something to wait on. An unknown answer is asked again after ten minutes.
  runs = [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }]
  await clock.advance(61_000)
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)
  await clock.advance(9 * 60_000)
  const failed = await board()
  expect(failed).toMatch(/\[CI 失敗・需處理\] 「商品列表頁」\(local_open\) GitHub 上的 CI（commit 3fa1c2e）失敗/)
  expect(failed).not.toMatch(/等待 CI・未完成\] 「商品列表頁」/)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」GitHub 上的 CI 失敗/)

  // Re-run and passed: no longer waiting on CI, and not asked again after that. But the words said tagging and
  // deploying come after CI, and nothing since says they happened: not released, not ended.
  runs = [{ status: 'completed', conclusion: 'success' }]
  await clock.advance(5 * 60_000 + 1000)
  const passed = await board()
  expect(passed).not.toMatch(/「商品列表頁」\(local_open\) (最後回報 CI|GitHub)/)
  expect(passed).toMatch(/### \[待發布・未完成\] 商品列表頁/)
  const before = asked.length
  await clock.advance(10 * 60_000)
  await board()
  expect(asked.length).toBe(before)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」最後回報尚未交付/)
})

test('a recap that says nothing is left is not a caveat', () => {
  const recap = (text: string) => caveatOf(track('x', { recap: text }) as never)
  expect(recap('之後版號和發布接力都由 PM 管，我這邊沒有任何未提交的修改。')).toBe(null)
  expect(recap('交接完成，沒有未推送的 commit。')).toBe(null)
  expect(recap('欄位已移除，還沒部署。')).not.toBe(null)
  expect(recap('改好了，但還沒提交。')).not.toBe(null)
  // Not done this time is no work left: only tests changed, the project's rules ask no tag.
  expect(recap('只改了測試，沒有打標籤也沒有部署。')).toBe(null)
})

test('the CI a session names: a run id, else a commit', () => {
  expect(ciTarget('CI 還在跑：https://github.com/o/r/actions/runs/41022337760')).toEqual({ run: '41022337760' })
  expect(ciTarget('2.4.0 已推上 main（`3fa1c2e`），CI 還在跑，1204 項全過')).toEqual({ sha: '3fa1c2e' })
  expect(ciTarget('2.4.0 已推上 main，CI 還在跑')).toBe(null)
})

test('an owner working from another project is not lost; only one gone from the list is', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = (id: number, owner: string) => ({ id, text: `項目 ${id}`, owner, status: 'open', note: '', createdAt: NOW, updatedAt: NOW })
  files.set(
    PROJECT_FILE,
    JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item(1, 'local_other'), item(2, 'local_gone')], nextId: 3 }),
  )
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).not.toMatch(/T-01「項目 1」的負責 Session/)
  expect(board).toMatch(/T-01 \(id 1\) \[open\] 項目 1｜負責：別的專案（已結束・其他專案的 Session）/)
  expect(board).toMatch(/\[負責人失聯\] 工作項目 T-02「項目 2」的負責 Session local_gone 已不在清單中/)
  expect(board).toMatch(/T-02 \(id 2\) \[open\] 項目 2｜負責：local_gone（已不在清單中）/)

  const ui = await $.ui.mount({
    plugin: 'project-pm',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'project-pm',
    props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
  } as never)
  expect(await ui.find({ type: 'Text', text: '負責　別的專案・已結束・其他專案' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '負責 Session 已不在清單中' })).toBeDefined()
  await ui.unmount()
})

test('after /reload-plugins the PM gets its tools back on its next turn', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  mock.clock(on, { now: NOW })
  const registered: string[] = []
  world(on, 'local_pm', files, [], undefined, registered)
  on('prompt.compose', () => ({ sections: [] }))

  // A reloaded copy of the module: no session.start, so nothing was registered yet.
  expect(registered).toEqual([])
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'] as const, tools: [], outputStyle: null, traits: [] }
  const composed = await $.prompt.compose(COMPOSE)
  expect(registered).toEqual(['board', 'ledger'])
  expect(composed.sections.map(s => s.id)).toContain('project-pm:role')

  // Once per copy: later turns register nothing again.
  await $.prompt.compose(COMPOSE)
  expect(registered).toEqual(['board', 'ledger'])
})

test('a session waiting on its own background commands is running in the background, not stopped', ZH, async ($, on) => {
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_me', files)
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b7k2m9x1q' } }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start(START)
  const file = () => JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!)

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: '在乾淨 worktree 跑完整後端與前端測試', status: 'in_progress' },
      { content: 'push 並等 CI 全部 success', status: 'pending' },
    ],
  } as never)
  await $.tool.call({ tool: 'Bash', command: 'python -m unittest discover', description: 'Run full backend test suite', run_in_background: true } as never)
  await $.turn.complete({
    answer: '完整後端測試、前端測試與整合測試正在乾淨 worktree 裡背景執行，完成後依結果修正或推送。',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
  })
  expect(file().background).toEqual([{ id: 'b7k2m9x1q', label: 'Run full backend test suite', at: NOW }])

  // Two hours on, the suite still running: past the words' 45 minutes, and still not "stopped midway".
  const at = (minutes: number) => ({ id: 'local_me', title: '我', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW).toISOString(), isPinned: false, hasOpenPr: false, at: NOW + minutes * 60000 })
  const later = at(120)
  expect(statusOf(later, file(), undefined, later.at)).toBe('waiting')

  // Its notification comes in: it is over, and the open steps speak again.
  await clock.advance(120 * 60000)
  await $.prompt.submit({
    text: '<task-notification> <task-id>b7k2m9x1q</task-id> <status>completed</status> <summary>Background command "Run full backend test suite" completed (exit code 0)</summary> </task-notification>',
  } as never)
  expect(file().background).toEqual([])
  expect(statusOf(later, file(), undefined, later.at + 60000)).toBe('open')
})

test('words of background work keep a session with open steps off the stopped list', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(
      track('local_open', {
        plan: [{ content: '跑完整測試', status: 'in_progress' }, { content: 'push', status: 'pending' }],
        lastAnswer: '完整後端測試、前端測試與整合測試正在乾淨 worktree 裡背景執行，完成後依結果修正或推送。',
        turnAt: at,
        planAt: at,
      }),
    ),
  )
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/### \[背景執行\] 商品列表頁 \(local_open\)/)
  expect(board).not.toMatch(/\[中斷・未完成\] 「商品列表頁」/)
})

test('the PM gets its tools back whenever the engine has dropped them', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const clock = mock.clock(on, { now: NOW })
  const registered: string[] = []
  world(on, 'local_pm', files, [], undefined, registered)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start(START)
  expect(registered).toEqual(['board', 'ledger'])

  // /board right after the mod's folder changed: the engine reloads the module and drops its tools.
  registered.length = 0
  await $.prompt.submit({ text: '看板怎麼樣了？' } as never)
  expect(registered).toEqual(['board', 'ledger'])

  // Dropped again between turns: the poll puts them back too.
  registered.length = 0
  await clock.advance(31_000)
  expect(registered).toEqual(['board', 'ledger'])

  // Present: nothing registered again.
  await $.prompt.submit({ text: '還有別的嗎？' } as never)
  expect(registered).toEqual(['board', 'ledger'])
})

test('only words of work still going on read as waiting, not words that name it', () => {
  const waits = (text: string) => parseLastWord(`[assistant] ${text}\n[result] done (success), 1 turns`, '').isWaiting
  const going = [
    // A real session's own words while its suite ran.
    '完整後端測試、前端測試與整合測試正在乾淨 worktree 裡背景執行，完成後依結果修正或推送。',
    '還在背景跑，大約 20 分鐘。',
    '我在背景等結果。',
    '已丟到背景跑，跑完會通知 PM。',
    '完整測試背景執行中。',
    '2.4.0 已推上 main，等 CI 通過後我會部署。',
    '等測試跑完再打標籤。',
    "Waiting for CI to finish (~21 minutes); I'll tag and deploy once it's green.",
    'The full suite is still running in the background.',
    "I'll tag the release once the checks pass.",
  ]
  const named = [
    // Sentences of a report about the background fix itself, its tasks all done and nothing running.
    '「背景」這個說法其實有抓到，45 分鐘的時間門檻也不是原因。',
    '判斷順序改成先看 CI、再看背景工作、最後才看任務清單。',
    'Session 會記下自己丟到背景跑的指令，直到收到「已結束」的通知才移除。',
    '它在 14:10 把完整測試丟到背景跑，14:10:15 結束那一輪，當時任務清單還有 4 步沒完成。',
    '背景偵測只對重新載入之後才開始跑的指令有效。',
    '子代理和監看類的背景工作還沒有追蹤。',
    '修正了背景判斷的誤判，任務 5/5 全部完成。',
    // Another session's state, its own clause.
    '那個 Session 之後已經繼續工作，目前在背景跑測試。',
    // The status's name, quoted.
    '**「商品總覽頁面」一直卡在「等待 CI」的原因**',
    'CI 已通過就不算「等待 CI」。',
    '不用等測試跑完，已經全部通過。',
    '| Waiting on CI (等待 CI) | Its last words say CI has not finished. |',
    'A command it started in the background has not reported back yet, for up to 6 hours.',
  ]
  expect(going.filter(t => !waits(t))).toEqual([])
  expect(named.filter(waits)).toEqual([])
})

test('words that leave work undelivered, and words that only name it', () => {
  const kinds = (text: string) => undeliveredOf(text)?.kinds ?? []
  // A real session's own words: done its part, waiting on the PM to release.
  expect(kinds('尚未 commit，等 PM 通知 2.4.1 上線後才發布 2.4.2。')).toEqual(['commit', 'release'])
  expect(kinds('功能修改仍未 commit 或 push，繼續等 PM 放行 2.4.2。')).toEqual(['commit', 'push', 'release'])
  // 也沒有 commit 或 push only says it was not done: git answers for commit and push (leftOf). The release waits.
  expect(kinds('這次只改了清單，程式沒有動，也沒有 commit 或 push。等 PM 放行 2.4.2 後我再發布。')).toEqual(['release'])
  expect(kinds('已推上 main（3fa1c2e），CI 通過，但還沒部署到正式站。')).toEqual(['release'])
  expect(kinds('2.4.2 還沒上線。')).toEqual(['release'])
  expect(kinds('Committed locally as 3fa1c2e; not pushed yet, waiting for your go-ahead.')).toEqual(['push', 'release'])
  // Committed here, pushed only once the PM confirms: the words name their commit, and git says whether it is pushed.
  const kept = 'commit 是 `9638755`，在本機 main，沒有 push，照 PM 的確認流程走。'
  expect(ownCommitOf(kept)).toBe('9638755')
  expect(leftOf(kept, { words: kept, sha: '9638755', isPushed: false, isOwn: true, checkedAt: NOW })).toEqual(['push'])
  expect(leftOf(kept, { words: kept, sha: '9638755', isPushed: true, isOwn: true, checkedAt: NOW })).toEqual([])
  expect(ownCommitOf('commit 是 `532590d`，在本機 main，沒有 push。已回報 PM local_0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d。')).toBe('532590d')

  const named = [
    // Double negatives and work done.
    '我這邊沒有任何未提交的修改，交接已完成。',
    '沒有未推送的 commit。',
    '已 commit 並推上 main，CI 通過，已部署 v2.4.1。',
    '原本還沒部署，現在已部署到正式站並驗證通過。',
    'The fix is committed, pushed and deployed.',
    // A rule, a status or a phrase named, not the work.
    '收尾摘要提到「尚未部署」這類字眼時，看板會列為『待發布』。',
    '還沒上線就不能顯示已結束。',
    '回報說還沒交付時，看板會判成待發布，不再顯示已結束。',
    '任務清單全勾，不能蓋過摘要裡寫明還沒做的內容。',
    '回報寫明工作還沒交付時就不會再顯示「已結束」。',
    // Someone else's work, in a folder shared with other sessions.
    '共用資料夾裡其他 Session 還沒提交的修改，以及別人暫存的刪除，都原樣留著。',
    // Not about delivering.
    '還要等 PM 下一輪確認。',
    '沒動到部署設定。',
    // A delivery word as a noun.
    '這只動本機、還沒公開的 commit。',
  ]
  expect(named.filter(t => undeliveredOf(t))).toEqual([])
})

test("someone else's undone work, or work a session disowns, is not its own to deliver", () => {
  const kinds = (text: string) => undeliveredOf(text)?.kinds ?? []
  // A real session's report: its own release done, then an aside about another session's uncommitted changes.
  const aside =
    '2.4.1 已上線，CI 全綠，正式站唯讀驗證通過。另外補充：發版前的檢查在共用資料夾被另一個 Session（版本 2.4.2）未提交的修改擋下，我改在乾淨的 worktree 重跑才通過；那些未提交的修改我都沒有動。'
  expect(kinds(aside)).toEqual([])
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, track('x', { lastAnswer: aside }) as never, undefined, NOW)).toBe('done')

  const others = [
    '其他 Session 還沒 commit 的修改都留著。',
    '另個 Session 還沒 push。',
    '版本 2.4.2 的未提交修改還在共用資料夾裡。',
    '那些未提交的修改，我都沒有動。',
    '共用資料夾裡有還沒 commit 的檔案，不是我的。',
    "Another session's changes are not committed yet; I didn't touch them.",
    'Those files are not committed, but they are not mine.',
  ]
  expect(others.filter(t => undeliveredOf(t))).toEqual([])

  // Its own work still counts, before or after an aside, and a later word of the same kind still stands.
  expect(kinds('我已部署 2.4.1，2.4.2 還沒 commit。')).toEqual(['commit'])
  expect(kinds('已部署 2.4.1，但 2.4.2 還沒部署。')).toEqual(['release'])
  expect(kinds('我還沒 push，別人的修改我沒碰。')).toEqual(['push'])
  expect(kinds('我還沒 push，那些暫存檔我都沒動。')).toEqual(['push'])
  expect(kinds('另一個 Session 的修改我沒動；我這次的修改還沒 commit。')).toEqual(['commit'])
  expect(kinds('還有未提交的修改，等測試跑完再 commit。')).toEqual(['commit'])
  expect(kinds('部署腳本還沒動手改，2.4.2 還沒部署。')).toEqual(['release'])
})

test('its own delivery said as what comes next is still to deliver; offers, rules and others are not', () => {
  const kinds = (text: string) => (undeliveredOf(text)?.kinds ?? []).join(',') || 'none'
  const ahead: [string, string][] = [
    ['之後再 push。', 'push'],
    ['接下來部署到正式站。', 'release'],
    ['明天發布 2.4.2。', 'release'],
    ['PM 確認後我再推。', 'push'],
    ['測試完成後再部署。', 'release'],
    ['測試都過了，稍後 commit。', 'commit'],
    ['已 commit 為 3fa1c2e，PM 放行後我會 push 並部署。', 'push,release'],
    ["I'll push after review.", 'push'],
    ['Next: deploy to production.', 'release'],
    ["The full suite takes about 10 minutes. I'll push once every exit code is 0.", 'push'],
  ]
  expect(ahead.filter(([text, want]) => kinds(text) !== want)).toEqual([])

  const notOwnToDo = [
    // Settled later in the same report.
    '之後再 push。……剛剛已 push。',
    // Rules and processes.
    '之後再 push 的情況會被判成待發布。',
    '流程是先 commit 再 push。',
    '發布規範是先打標籤、跑核對，通過後才推標籤。',
    // Someone else's.
    '另一個 Session 之後會部署 2.4.2。',
    '另一個工作階段準備推 2.4.2。',
    '我已經請子 Session 在 T-05 之後另外 commit。',
    '接下來它會推送，CI 通過後部署。',
    '我這邊不用再改任何檔案，接下來的推版和部署都由它負責。',
    '交接完成：之後版號和發布接力都由 PM 管，我這邊沒有任何未提交的修改。',
    '之後其他工作要 push、發 release，我照樣會先問你。',
    // Offers to the person, conditionals and questions: theirs to decide.
    '你可以之後再 push。',
    '如果要，下一步可以部署。',
    'You can deploy it later if you like.',
    '要不要接下來部署到正式站？',
    '接下來部署到正式站嗎？我先等你的意見。',
    // A future that will not come, a guess, a past told in order.
    '之後不會再部署舊版。',
    '今晚可能還會推送幾則，明天起就會安靜。',
    '之後它完成部署，卻沒有再更新摘要。',
    '之後補了一個修正提交，CI 就通過並部署了。',
    '之後另外提交 3fa1c2e，把現況文件的版本改成 2.4.1。',
    // A verb used as a noun or a consequence.
    'main 上我的 3fa1c2e 之後多了兩個 commit。',
    '讓合併後的提交也能被認出來。',
    '之後部署會改成讓腳本自己更新。',
    '之後改版在那裡 commit 再 push 就會更新。',
    '之後推送、SSH 就不會再詢問。',
    '主機上已經是新腳本，下次部署會直接用到。',
    // Done, with harmless words of what comes next.
    '2.4.1 已部署並驗證通過，接下來會繼續觀察錯誤率。',
  ]
  expect(notOwnToDo.filter(text => kinds(text) !== 'none')).toEqual([])

  // A push left for later, its commit named: git clears it once that commit is on a remote branch.
  const later = 'commit 是 3fa1c2e，PM 確認後我再推。'
  expect(undeliveredOf(later)).toEqual({ kinds: ['push'], sha: '3fa1c2e' })
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  const said = track('x', { lastAnswer: later }) as never
  expect(statusOf(idle, said, undefined, NOW)).toBe('unreleased')
  expect(statusOf(idle, said, undefined, NOW, undefined, { words: later, sha: '3fa1c2e', isPushed: true, checkedAt: NOW })).toBe('done')
})

test("a release handed on to the next version, or the person's own plan, is not this session's to deliver", () => {
  const kinds = (text: string) => (undeliveredOf(text)?.kinds ?? []).join(',') || 'none'
  // A real session's report: its release done and checked, the next version cleared to go, an aside on the person's plan.
  const handedOn =
    '2.4.1 已上正式站並驗證通過：標籤 v2.4.1、commit 3fa1c2e。結果已回報 PM，2.4.2 可以放行。這兩件商品我都沒碰，你原本打算上線後自己在商品頁調整，可以先看一下它們現在的狀態。'
  expect(kinds(handedOn)).toBe('none')
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, track('x', { lastAnswer: handedOn }) as never, undefined, NOW)).toBe('done')

  const notOwn = [
    '結果已回報 PM，下一個版本可以放行。',
    '下一版可以接著推。',
    '可以通知下一位部署。',
    '下個版本可以開始。',
    'The next release can go ahead.',
    '你原本打算上線後自己在商品頁調整。',
    "You'll deploy it yourself after review.",
    // The no-code statement and the bare negation in one clause, joined by 、.
    '沒有改程式、沒有 push，所以不需要版號。',
    '沒有改程式、也沒有 push。',
  ]
  expect(notOwn.filter(text => kinds(text) !== 'none')).toEqual([])

  const own: [string, string][] = [
    ['我之後會幫你部署到正式站。', 'release'],
    ['測試通過後我再通知你，然後部署。', 'release'],
    ['Next: deploy to production.', 'release'],
    ['沒有改程式、但設定檔還沒 commit。', 'commit'],
  ]
  expect(own.filter(([text, want]) => kinds(text) !== want)).toEqual([])
})

test('how a commit was made is not a commit left; a commit named by its hash is made', () => {
  // Git says the words' own commit is in the repository and on no remote branch, the folder not clean.
  const read = (text: string) => {
    const own = ownCommitOf(text)
    const kinds = leftOf(text, own ? { words: text, sha: own, isPushed: false, isOwn: true, checkedAt: NOW } : undefined)
    return kinds.length ? `${kinds.join(',')}${own ? `@${own}` : ''}` : 'none'
  }
  const cases: [string, string][] = [
    // A real session's report: amended rather than a new commit, then named the commit; only the push is left.
    ['已照 PM 的要求直接 amend，沒有另開 commit：新的 commit 是 `3fa1c2e`，取代原本的 `9b8c7d6`，在本機 main，沒有 push、沒有打 tag。', 'push@3fa1c2e'],
    ['沒有另外 commit，改動併進 3fa1c2e，沒有 push。', 'push@3fa1c2e'],
    ['沒有新增 commit，直接 amend 成 3fa1c2e。沒有 push。', 'push@3fa1c2e'],
    ['沒有拆成兩個 commit，commit 是 3fa1c2e，沒有 push。', 'push@3fa1c2e'],
    ['Not a separate commit: amended into 3fa1c2e. Not pushed.', 'push@3fa1c2e'],
    ['已 commit 為 3fa1c2e，沒有 push。', 'push@3fa1c2e'],
    ['剛才還沒 commit，現在新的 commit 是 3fa1c2e，沒有 push。', 'push@3fa1c2e'],
    ['The first attempt was not committed; committed as 3fa1c2e now. Not pushed.', 'push@3fa1c2e'],
    ['沒有用 force push，已正常 push 上去。', 'none'],
    // Left on purpose, and no delivery.
    ['沒有打 tag，也沒有另外寫 CHANGELOG。', 'none'],
    ['這句沒有交付動詞，不會擋。', 'none'],
    // Still not committed.
    ['還沒 commit。', 'commit'],
    // Not done this time: git answers, and here it has no commit of the words' own to ask about.
    ['沒有 commit，也沒有 push。', 'none'],
    ['修改還沒 commit，新的 commit 之後再開。', 'commit'],
    ['上一個 commit 是 3fa1c2e，這次的修改還沒 commit。', 'commit,push@3fa1c2e'],
    // Pushing is not all: the release waits on the PM's word, however long what stands between.
    ['2.4.3 已在 worktree 本機 commit 9b8c7d6（未 push）。等 PM 通知 2.4.1／2.4.2 上線後再 cherry-pick 發布。', 'push,release@9b8c7d6'],
  ]
  expect(cases.filter(([text, want]) => read(text) !== want)).toEqual([])
})

test('"follow up" reads a recap the way the board does, and goes once git shows the push done', () => {
  const recap = 'Committed 3fa1c2e locally (not pushed, no tag).'
  const one = track('x', { recap }) as never
  expect(caveatOf(one)).toBe(recap)
  const pushed = { words: recap, sha: '3fa1c2e', isPushed: true, checkedAt: NOW }
  expect(caveatOf(one, pushed)).toBe(null)
  // Work left other than delivering still shows, pushed or not; words about a rule or someone else's do not.
  const unverified = track('x', { recap: '已部署到正式站，但還沒驗證結帳流程。' }) as never
  expect(caveatOf(unverified)).not.toBe(null)
  expect(caveatOf(track('x', { recap: '收尾摘要提到「尚未驗證」這類字眼時會列為需追蹤。' }) as never)).toBe(null)
  expect(caveatOf(track('x', { recap: '另一個 Session 還沒測試它的修改，我這邊已部署並驗證。' }) as never)).toBe(null)
})

test('a commit kept here shows no "follow up" once git finds it pushed', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { recap: 'Committed 3fa1c2e locally (not pushed, no tag).', recapAt: at - 1000, lastAnswer: 'Done.', turnAt: at, planAt: at })))
  let remotes = ''
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], argv => {
    if (argv[0] === 'git' && argv[1] === 'branch') return { exitCode: 0, stdout: remotes }
    // The commit is in this repository.
    return argv[0] === 'git' && argv[1] === 'rev-parse' ? { exitCode: 0, stdout: '3fa1c2e' } : null
  })
  await $.session.start(START)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)

  const before = await board()
  expect(before).toMatch(/\[待發布・未完成\] 「商品列表頁」\(local_open\) 最後回報尚未交付（push）/)
  expect(before).not.toMatch(/\[需追蹤\] 「商品列表頁」/)

  remotes = '  origin/main\n'
  await clock.advance(61_000)
  const after = await board()
  expect(after).not.toMatch(/\[需追蹤\] 「商品列表頁」/)
  expect(after).not.toMatch(/待發布・未完成\] 「商品列表頁」/)
})

test("a sentence that tells how something is judged is about the judging, not this session's work", () => {
  const kinds = (text: string) => (undeliveredOf(text)?.kinds ?? []).join(',') || 'none'
  const judging = [
    // A real session's report on a fix to this very board.
    '結果是 commit 一出現在遠端，看板就會誤判成「已結束」，但發布其實還在等 PM。',
    '看板把它判成待發布，但它其實還沒 push 的只是別的分支。',
    '這句會被列為待發布，而且 commit 還沒 push 的情況也一樣。',
    '舊規則漏判了，結果還沒部署的 Session 顯示成已結束。',
    'The board flags it as not released, yet nothing was left to push.',
    '沒有待發布的工作，這是看板誤判。',
    '這句會被列為『待發布』，而且 commit 還沒 push 的情況也一樣。',
    // Another session described by what it waits on.
    '現有紀錄有三筆判斷改變，以及一個正在等 PM 通知才發布的 Acme Session。',
    '還沒 push 的 Session 有兩個。',
  ]
  expect(judging.filter(text => kinds(text) !== 'none')).toEqual([])

  const own: [string, string][] = [
    // Its own state in the same sentence: the clause says I.
    ['看板會判成待發布，因為我還沒 push。', 'push'],
    ['這次還沒 commit，看板顯示待發布是對的。', 'commit'],
    ['我還沒部署，所以看板列為待發布。', 'release'],
    // A board or a status named alone does not make a sentence a description.
    ['業績看板還沒部署。', 'release'],
    ['2.4.3 待發布，還沒 push。', 'push'],
    ['還沒 push。', 'push'],
    // A misjudgment fixed is work done; 列為 alone is a listing.
    ['看板誤判已修好，commit 是 3fa1c2e，只在本機，還沒 push。', 'push'],
    ['又修了一個小誤判，所以 amend 進同一個還沒推送的 commit。', 'push'],
    ['2.4.3 已經在 main 上但還沒發布，我已在現況文件列為待確認事項。', 'release'],
  ]
  expect(own.filter(([text, want]) => kinds(text) !== want)).toEqual([])
})

test('a release told step by step after it went out is done; how and in what order is not work left', () => {
  const kinds = (text: string) => (undeliveredOf(text)?.kinds ?? []).join(',') || 'none'
  // A real session's recap: released, then each step in the past, in order.
  const told = [
    '2.4.1 已上線，兩次 CI 都 success，正式站驗證通過，暫存目錄和分支都清掉了，已回報 PM。',
    '- 以 3fa1c2e 為基準 cherry-pick。',
    '- CI success 之後才推標籤，推之前檢查通過。',
    '- 部署前有備份。',
    '- 部署：腳本執行成功，沒有先手動 merge。',
    '- 對齊時沒有用 reset。',
  ].join('\n')
  expect(kinds(told)).toBe('none')
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, track('x', { recap: told, recapAt: NOW - 600000 - 1, lastAnswer: '已回報 PM。' }) as never, undefined, NOW)).toBe('done')

  const notWorkLeft = [
    '部署：腳本執行成功，沒有先手動 merge。',
    // In a sentence that waits, where a plain "not done" counts: how it was done still is no work left.
    '沒有先手動 merge，等 CI 結果出來。',
    '沒有直接 push 到 main，等 PM 審核。',
    '沒有直接 push 到 main，走 PR 合併。',
    '沒有手動部署，用腳本部署完成。',
    'CI success 之後才推標籤，推之前檢查通過。',
    '部署前有備份。',
    // A step for whoever does the next version.
    '2.4.1 已完成；2.4.2 推送前要先 rebase 到 3fa1c2e 上，這點已經告訴 PM。',
  ]
  expect(notWorkLeft.filter(text => kinds(text) !== 'none')).toEqual([])

  const left: [string, string][] = [
    ['我部署了 2.4.1，2.4.2 部署前還要等 PM。', 'release'],
    ['2.4.1 已上線；2.4.2 還沒部署。', 'release'],
    ['還沒 merge。', 'release'],
    ['推送前要等 CI 跑完。', 'push'],
    ['CI 通過後我再推標籤。', 'push'],
    ['通過後才會打標籤和部署。', 'release'],
    // 才 in a sentence still looking ahead is the plan.
    ['我還在等 2.4.0 部署完成，之後才推 2.4.1。', 'push'],
    ['我會先申請放行，放行後才 push。', 'push'],
    ['CI 通過後才由我推標籤。', 'push'],
    ['審核後才能部署。', 'release'],
  ]
  expect(left.filter(([text, want]) => kinds(text) !== want)).toEqual([])
})

test('a bare "not done" is no work left; work said to be left, or waited on, is', () => {
  const kinds = (text: string) => (undeliveredOf(text)?.kinds ?? []).join(',') || 'none'
  // A real session's report on a data fix: nothing was ever going to be pushed.
  const dataFix = '已寫入並複查通過，沒有改程式，也沒有 push。'
  expect(kinds(dataFix)).toBe('none')
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, track('x', { lastAnswer: dataFix }) as never, undefined, NOW)).toBe('done')
  // Only tests changed, and the project's rules ask no tag or deploy for that: pushed, CI passed, nothing left.
  const testsOnly = '只改了測試檔，已推上 main，CI success。沒有打標籤也沒有部署。'
  expect(kinds(testsOnly)).toBe('none')
  expect(statusOf(idle, track('x', { lastAnswer: testsOnly }) as never, undefined, NOW)).toBe('done')

  const notLeft = [
    '這次是純資料修正。已寫入並複查通過。沒有 push。',
    '沒有改程式，也沒有部署。',
    'No code changes. Also, we did not push.',
    '不需要 push，也不需要升版號。',
    '無需發布，資料已修正。',
    'No need to push; the data fix is applied and verified.',
    // Not done this time, with no word that it is left: git answers for commit and push, a declaration for a release.
    '沒有 push。',
    '沒有 push、也沒有打 tag。',
    '沒有改程式，但設定檔沒有 commit。',
    '並未部署。',
    "We didn't deploy.",
  ]
  expect(notLeft.filter(t => kinds(t) !== 'none')).toEqual([])

  const left: [string, string][] = [
    // Said to be left, whatever else the report says.
    ['還沒 push。', 'push'],
    ['Not pushed yet.', 'push'],
    ['沒有改程式，但設定檔還沒 commit。', 'commit'],
    ['No code changes; the migration file is not committed.', 'commit'],
    ['沒有改程式。2.4.2 還沒上線。', 'release'],
    ['2.4.2 尚未部署。', 'release'],
    ['2.4.2 未部署。', 'release'],
    ["The fix hasn't been deployed.", 'release'],
    ['不需要 commit，但還沒 push。', 'push'],
    // Still to come.
    ['之後再部署。', 'release'],
    ['等 PM 放行後部署。', 'release'],
    // Waiting on a word before it goes out.
    ['沒有 push，等 PM 確認。', 'push'],
    ['沒有改程式，也沒有 push，等 PM 確認後再推。', 'push'],
    // Still sitting here: as good as said to be left.
    ['修正只在本機，沒有 push。', 'push'],
    ['在那之前，修正放在本機，沒有 commit。', 'commit'],
    ['改動只存在本機 repo，沒有推送到任何地方。', 'push'],
    // Tagging is a release's.
    ['2.4.2 還沒打標籤。', 'release'],
    ['CI 通過後我會接著打標籤和部署。', 'release'],
  ]
  expect(left.filter(([text, want]) => kinds(text) !== want)).toEqual([])
})

test('a declared delivery decides the release; git decides commit and push', () => {
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  const status = (text: string) => statusOf(idle, track('x', { lastAnswer: text }) as never, undefined, NOW)
  const forms: [string, ReturnType<typeof declaredOf>][] = [
    ['交付：不需要部署（只改測試檔）', 'none'],
    ['**交付**：已部署 2.4.1', 'done'],
    ['- 交付：待部署（等 PM 放行）', 'pending'],
    ['交付：已部署 2.4.1；2.4.2 待部署', 'pending'],
    ['Delivery: not needed', 'none'],
    ['Delivery: deployed to production', 'done'],
    ['Delivery: pending (waiting on the PM)', 'pending'],
    ['交付：PR #12', null],
    ['這次的交付很順利。', null],
  ]
  expect(forms.filter(([text, want]) => declaredOf(text) !== want)).toEqual([])

  // The declaration stands over the words, either way; the last line stands.
  expect(status('程式已推上 main。還沒部署到正式站。\n交付：不需要部署（只改測試檔）')).toBe('done')
  expect(status('已推上 main，CI 通過。\n交付：待部署（等 PM 放行）')).toBe('unreleased')
  expect(status('交付：待部署（等 PM 放行）\n…\n交付：已部署 2.4.1')).toBe('done')
  // Where the words alone would say otherwise.
  expect(status('2.4.2 還沒部署到正式站。\nDelivery: done')).toBe('done')
  expect(status('All merged and tested.\nDelivery: pending (waiting on the PM)')).toBe('unreleased')
  // A release only: commit and push are still git's.
  const kept = 'commit 是 3fa1c2e，在本機。\n交付：不需要部署'
  expect(leftOf(kept, { words: kept, sha: '3fa1c2e', isPushed: false, isOwn: true, checkedAt: NOW })).toEqual(['push'])

  // Git settles commit and push however the words put it: a clean folder whose HEAD is on a remote branch.
  const said = '還沒 commit，也還沒 push。'
  expect(leftOf(said, undefined)).toEqual(['commit', 'push'])
  expect(leftOf(said, { words: said, sha: '', isPushed: true, isClean: true, checkedAt: NOW })).toEqual([])
  // A dirty folder settles nothing, and adds nothing the words did not say (a shared folder holds others' changes).
  expect(leftOf(said, { words: said, sha: '', isPushed: false, isClean: false, checkedAt: NOW })).toEqual(['commit', 'push'])
  expect(leftOf('已完成。', { words: '已完成。', sha: '', isPushed: false, isClean: false, checkedAt: NOW })).toEqual([])
  // A hash named otherwise is not the words' own commit.
  expect(ownCommitOf('以 3fa1c2e 為基準 cherry-pick，取代原本的 9b8c7d6。')).toBe(null)
  expect(ownCommitOf('沒有另外 commit，改動併進 3fa1c2e。')).toBe('3fa1c2e')
  expect(ownCommitOf('已在本機 main 提交為 **9b8c7d6**，沒有 push。')).toBe('9b8c7d6')
  expect(ownCommitOf('2.4.2 已做好，只在本機提交（4028240），沒有推送。')).toBe('4028240')
  expect(ownCommitOf('已在本機 main commit **3fa1c2e**。')).toBe('3fa1c2e')
})

test('a session whose words leave its work undelivered is not ended, however ticked its list', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '商品圖片可貼連結上傳', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  const steps = ['定位商品圖片儲存流程', '實作伺服器端安全下載圖片', '補測試並跑相關測試', '等 PM 放行後升版 2.4.2 發布', '正式站唯讀驗證並回報 PM']
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(
      track('local_open', {
        // wrap_up ticked every step, the two it had put back to pending included.
        plan: steps.map(content => ({ content, status: 'completed' })),
        recap: '已依 PM 要求修正任務清單：前 5 步維持完成，「升版 2.4.2 發布」和「正式站唯讀驗證並回報 PM」改回待辦。功能修改仍未 commit 或 push，繼續等 PM 放行 2.4.2。',
        recapAt: at - 5000,
        lastAnswer: '這次只改了清單，程式沒有動，也沒有 commit 或 push。等 PM 放行 2.4.2 後我再發布，到正式站唯讀驗證，最後回報 PM。',
        turnAt: at,
        planAt: at,
      }),
    ),
  )
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/- \[待發布・未完成\] 「商品列表頁」\(local_open\) 最後回報尚未交付（commit、push、發布／部署／上線）/)
  expect(board).toMatch(/### \[待發布・未完成\] 商品列表頁/)
  expect(board).not.toMatch(/\[已結束\] 商品列表頁/)

  const close = async (extra: object = {}) =>
    String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user', ...extra } as never)) as { result?: unknown }).result)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」最後回報尚未交付/)
  expect(await close({ force: true, note: '使用者確認 2.4.2 已上線' })).toMatch(/已更新工作項目 T-01/)
})

test('a commit kept here until the PM confirms is undelivered until git shows it pushed', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '收緊背景判斷', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(track('local_open', { lastAnswer: 'T-04 修好了：commit 是 `9638755`，在本機 main 上，沒有 push、也沒有打 tag。19 項測試全部通過。', turnAt: at, planAt: at })),
  )
  let remotes = ''
  const asked: string[] = []
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], (argv, cwd) => {
    asked.push(`${argv.join(' ')} @ ${cwd}`)
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return { exitCode: 0, stdout: '9638755' }

    return argv[0] === 'git' && argv[1] === 'branch' ? { exitCode: 0, stdout: remotes } : null
  })
  await $.session.start(START)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  const close = async () =>
    String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)

  expect(await board()).toMatch(/\[待發布・未完成\] 「商品列表頁」\(local_open\) 最後回報尚未交付（push）/)
  expect(asked).toContain(`git branch -r --contains 9638755 @ ${PROJECT}`)
  expect(await close()).toMatch(/無法將 T-01 標記為完成/)

  // The PM pushes it from this machine: origin/main holds it now.
  remotes = '  origin/HEAD -> origin/main\n  origin/main\n'
  await clock.advance(61_000)
  expect(await board()).toMatch(/### \[已結束\] 商品列表頁|另有 \d+ 個已結束/)
  expect(await board()).not.toMatch(/待發布・未完成\] 「商品列表頁」/)
  expect(await close()).toMatch(/已更新工作項目 T-01/)
})

test('CI named in quotes or in a rule is not CI still running', () => {
  const running = [
    '已推上 main（3fa1c2e），CI 還在跑，通過後才會打標籤和部署。',
    'CI 還要跑 1 小時，跑完再部署。',
    '同時 CI 還在跑。',
    '已推上 main（CI 還在跑）。',
    'Pushed to main; waiting for CI before tagging.',
    'The checks are still running.',
    '修正已推上 9f8e7d6，正在等 9f8e7d6 的 CI。',
    '接下來：推送、等 CI 通過後部署。',
    '等待 CI 通過後再部署。',
    'CI 重跑中，大約 10 分鐘。',
    'CI 還要跑 20 分鐘。',
  ]
  // A real session's report about this very board, its own CI long passed.
  const report = `T-04 修好了：看板現在只有在回報說工作「還在進行」時，才會判成「背景執行」。commit 是 \`9638755\`，在本機 main 上，沒有 push、也沒有打 tag。19 項測試全部通過，validate 也通過。

**問題出在哪**
- 只要回報裡出現「背景」兩個字就會命中，所以我上一輪那份講背景判斷修正的回報被當成還在背景跑。
- 同一類的誤判還有一種：回報引用狀態名稱「等待 CI」時，也會被當成在等 CI。我更早的回報就有這種句子。

**現在的判斷規則**
- **中文：** 例如「正在…背景執行」「我在背景等」「背景執行中」「背景…完成後」「等 CI 通過後」。
- 「等」前面是引號、括號，或「不用、不必、別」的也不算。
- **英文：** 例如 "still running in the background"、句首的 "Waiting for CI to finish"、"I'll … once the checks pass"。表格裡的 "Waiting on CI" 這種狀態名稱不算。`
  const named = [
    report,
    '**「商品列表頁」一直卡在「等待 CI」的原因**',
    '- **用 GitHub 確認 CI：** 文字看起來像「CI 還在跑」時，會在該 Session 的資料夾用 `gh` 查實際狀態。',
    '- 查不到時照原本的文字判斷，CI 真的還在跑時一樣會擋結案。',
    '- 如果一則已經完成的回報寫成「CI 通過後才打標籤並部署」，單看文字仍可能被當成還在跑。',
    '- **修正：** PM 每一輪、以及每 30 秒的定時更新，都會檢查兩個工具還在不在，不在就重新註冊。',
    'CI 已通過就不算「等待 CI」(等待 CI)。',
    // The status named without quotes.
    '其他 PM 那句仍然判成等待 CI。',
    '看板查到自己的 commit 結果 success，不再標等待 CI。',
    '- HEAD 比回報晚時維持等待 CI。',
    // A name in code.
    'WAITING 和 CI_PENDING 都一樣。',
    // Another session's CI.
    '另一個 Session 的 CI 還在跑。',
    // The status in a list or a chain of statuses.
    '- 優先順序：待回覆 → CI 失敗／等待 CI → 背景執行 → 未完成 → 待發布 → 已結束。CI 通過後如果回報還說沒部署，會從等待 CI 轉成待發布。',
    '- 第三個指標改名「尚未完成」，把未完成、等待 CI、CI 失敗、待發布都算進去。',
    // Re-runs told of in a rule.
    '同一個 commit 上，同一個 workflow 還有別的 run（重跑，或取消後又跑一次），被取消的那個就略過。',
  ]
  expect(running.filter(t => !isCiPending(t))).toEqual([])
  expect(named.filter(isCiPending)).toEqual([])
  // Nor do they read as work going on in the background.
  const waits = (text: string) => parseLastWord(`[assistant] ${text}\n[result] done (success), 1 turns`, '').isWaiting
  expect(named.filter(waits)).toEqual([])
})

test('the CI a report names: nearest its own CI words first, never part of an id', () => {
  expect(ciTargets('另外參考了別的專案 b8e41f0 的寫法。本次 commit `3fa1c2e` 已推上 main，CI 還在跑。').shas).toEqual(['3fa1c2e', 'b8e41f0'])
  expect(ciTargets('commit 是 `532590d`，CI 還在跑，已回報 PM local_0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d。').shas).toEqual(['532590d'])
  expect(ciTargets('CI 還在跑：https://github.com/o/r/actions/runs/41022337760，前一次是 run 39030000001。').runs[0]).toBe('41022337760')
})

test('GitHub is asked about a commit of this repository, else about its HEAD', ZH, async ($, on) => {
  const files: Files = new Map()
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  // Hashes quoted from an example and another project come before its own, nearer its CI words.
  const words = 'CI 還在跑，寫法照 demo 的 8c41d2e 和另一個專案的 b8e41f0；這次推上去的是 3fa1c2e。'
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { lastAnswer: words, turnAt: at, planAt: at })))
  const FULL = '3fa1c2e9d84b07a6c5e1f2039b8d7c6a5e4f3d21'
  const HEAD = '7d2e4b1c0a9f8e7d6c5b4a3928170f6e5d4c3b2a'
  let headAt = Math.floor(at / 1000) - 60
  let isOwnNamed = true
  const asked: string[] = []
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], argv => {
    asked.push(argv.join(' '))
    if (argv[1] === 'rev-parse') return isOwnNamed && argv[4] === '3fa1c2e^{commit}' ? { exitCode: 0, stdout: FULL } : { exitCode: 1, stdout: '' }
    if (argv[1] === 'log') return { exitCode: 0, stdout: `${HEAD} ${headAt}` }
    if (argv[0] === 'gh') return { exitCode: 0, stdout: JSON.stringify([{ status: 'completed', conclusion: 'success' }]) }

    return null
  })
  await $.session.start(START)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)

  // The two quoted hashes are not commits here: the session's own one answers.
  expect(await board()).not.toMatch(/等待 CI・未完成\] 「商品列表頁」/)
  expect(asked.filter(a => a.startsWith('git rev-parse')).map(a => a.split(' ')[4])).toEqual(['8c41d2e^{commit}', 'b8e41f0^{commit}', '3fa1c2e^{commit}'])
  expect(asked).toContain(`gh run list --commit ${FULL} --limit 20 --json status,conclusion,workflowName`)

  // None of the named hashes is here: the folder's HEAD, committed before the words, answers instead.
  isOwnNamed = false
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { lastAnswer: `${words} `, turnAt: at, planAt: at })))
  await clock.advance(31_000)
  expect(await board()).not.toMatch(/等待 CI・未完成\] 「商品列表頁」/)
  expect(asked).toContain(`gh run list --commit ${HEAD} --limit 20 --json status,conclusion,workflowName`)

  // A HEAD committed after the words is not what they waited on: the words decide.
  headAt = Math.floor(at / 1000) + 60
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { lastAnswer: `${words}  `, turnAt: at, planAt: at })))
  await clock.advance(31_000)
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)
})

/**
 * A repository from memory: each commit's parent and files (path to blob), its local and remote branch tips. A commit
 * may also have a title, the lines it adds by file (`git diff-tree -p`) and a patch id (`git cherry`).
 */
type FakeCommit = { parent: string | null; files: Record<string, string>; title?: string; added?: Record<string, string[]>; patch?: string }
function fakeGit(commits: Record<string, FakeCommit>, heads: Record<string, string>, remotes: Record<string, string>) {
  const chain = (id: string) => {
    const ids: string[] = []
    for (let at: string | null = id; at; at = commits[at]!.parent) ids.push(at)

    return ids
  }
  const holds = (tip: string, id: string) => chain(tip).includes(id)
  const differs = (a: string, b: string) => {
    const fa = commits[a]!.files
    const fb = commits[b]!.files
    return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(p => fa[p] !== fb[p]).sort()
  }
  const paths = (args: string[]) => args.slice(args.indexOf('--') + 1)

  return async (args: string[]): Promise<string | null> => {
    const [cmd] = args
    if (cmd === '-c' && args[2] === 'diff-tree') {
      const added = commits[args.at(-1)!]!.added ?? {}
      return Object.entries(added).map(([file, lines]) => [`--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@', ...lines.map(line => `+${line}`)].join('\n')).join('\n')
    }
    if (cmd === 'cherry') {
      // Equivalent when a commit on the remote since the base has the same patch.
      const base = chain(args[2]!).find(id => holds(remotes[args[1]!]!, id))!
      const same = chain(remotes[args[1]!]!).filter(id => !holds(base, id)).some(id => commits[id]!.patch && commits[id]!.patch === commits[args[2]!]!.patch)
      return `${same ? '-' : '+'} ${args[2]}`
    }
    if (cmd === 'log' && args[1] === '-1') return commits[args[3]!]!.title ?? ''
    if (cmd === 'log' && args.some(a => a.startsWith('--grep='))) {
      const title = args.find(a => a.startsWith('--grep='))!.slice('--grep='.length)
      const [from, to] = args.at(-1)!.split('..') as [string, string]
      return chain(remotes[to] ?? to).filter(id => !holds(from, id) && commits[id]!.title === title).map(id => `${id}\t${title}`).join('\n')
    }
    if (cmd === 'branch') return Object.keys(remotes).filter(r => holds(remotes[r]!, args[3]!)).join('\n')
    if (cmd === 'for-each-ref' && args.includes('refs/remotes')) return Object.keys(remotes).join('\n')
    if (cmd === 'for-each-ref') return Object.values(heads).filter(h => holds(h, args[2]!)).join('\n')
    if (cmd === 'merge-base') return chain(args[1]!).find(id => holds(remotes[args[2]!] ?? args[2]!, id)) ?? null
    if (cmd === '-c') return differs(args[5]!, args[6]!).join('\0')
    if (cmd === 'ls-tree') {
      const files = commits[remotes[args[3]!] ?? args[3]!]!.files
      return paths(args).filter(p => files[p]).map(p => `100644 blob ${files[p]}\t${p}`).join('\0')
    }
    if (cmd === 'log') {
      const [from, to] = args[3]!.split('..') as [string, string]
      const wanted = paths(args)
      return chain(remotes[to] ?? to)
        .filter(id => !holds(from, id) && commits[id]!.parent && differs(commits[id]!.parent!, id).some(p => wanted.includes(p)))
        .join('\n')
    }
    if (cmd === 'rev-list') {
      const [from, to] = args[3]!.split('..') as [string, string]
      return holds(to, from) ? chain(to).slice(0, chain(to).indexOf(from)).slice(0, 5).join('\n') : ''
    }

    return null
  }
}

test('a commit counts as pushed once its content is on a remote branch: rebased, squashed or edited after', async () => {
  const commits = {
    base: { parent: null, files: { 'a.ts': 'a0', 'b.ts': 'b0' } },
    // Two local commits, kept on a backup branch, pushed as one squash.
    l1: { parent: 'base', files: { 'a.ts': 'a1', 'b.ts': 'b0' } },
    l2: { parent: 'l1', files: { 'a.ts': 'a2', 'b.ts': 'b1' } },
    squash: { parent: 'base', files: { 'a.ts': 'a2', 'b.ts': 'b1' } },
    // Then the remote edited a.ts again.
    later: { parent: 'squash', files: { 'a.ts': 'a3', 'b.ts': 'b1' } },
    // Never pushed: a new file on top of the remote.
    mine: { parent: 'later', files: { 'a.ts': 'a3', 'b.ts': 'b1', 'c.ts': 'c1' } },
    // Half of it on the remote: a.ts as pushed, b.ts not.
    half: { parent: 'base', files: { 'a.ts': 'a2', 'b.ts': 'bX' } },
  }
  const git = fakeGit(commits, { backup: 'l2', main: 'mine', other: 'half' }, { 'origin/main': 'later' })

  expect(await isPushedContent(git, 'squash')).toBe(true)
  // Its content is the squash's, though a.ts moved on since.
  expect(await isPushedContent(git, 'l2')).toBe(true)
  // An earlier commit of the squash: its a.ts was edited by l2, so only its descendant l2 matches.
  expect(await isPushedContent(git, 'l1')).toBe(true)
  expect(await isPushedContent(git, 'mine')).toBe(false)
  expect(await isPushedContent(git, 'half')).toBe(false)

  // The backup branch gone, nothing ties l1 to what was pushed: the safe answer is not pushed.
  const bare = fakeGit(commits, { main: 'mine' }, { 'origin/main': 'later' })
  expect(await isPushedContent(bare, 'l1')).toBe(false)
  expect(await isPushedContent(bare, 'l2')).toBe(true)
})

test('a cancelled run is no failure: left out when its workflow ran again, else the commit has not passed', () => {
  const run = (conclusion: string, workflowName = 'CI') => ({ status: 'completed', conclusion, workflowName })
  expect(ciVerdict([run('cancelled'), run('success')])).toBe('success')
  expect(ciVerdict([run('cancelled'), run('failure')])).toBe('failure')
  expect(ciVerdict([run('cancelled')])).toBe('unknown')
  expect(ciVerdict([run('cancelled'), run('success', 'Lint')])).toBe('unknown')
  expect(ciVerdict([run('skipped', 'Docs'), run('success')])).toBe('success')
  expect(ciVerdict([run('cancelled'), { status: 'in_progress', conclusion: null, workflowName: 'CI' }])).toBe('pending')

  expect(betterCi('failure', 'success')).toBe('success')
  expect(betterCi('failure', 'pending')).toBe('pending')
  expect(betterCi('unknown', 'failure')).toBe('failure')
})

test('a fix pushed after a cancelled or failed commit is what CI waits on', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '商品列表頁加匯出 CSV', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
  const B = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432'
  // A first, then its fix B on top; the remote branch's tip is B (or A, before B is pushed).
  let tip = B
  // The folder's HEAD: committed after the words unless a scenario says otherwise (others keep committing).
  let headAt = Math.floor(at / 1000) + 600
  const runs: Record<string, object[]> = {}
  let saying = 0
  const say = (lastAnswer: string) => {
    saying += 1
    files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { lastAnswer: `${lastAnswer}${' '.repeat(saying)}`, turnAt: at, planAt: at })))
  }
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], argv => {
    const full = (short: string) => [A, B].find(c => c.startsWith(short.replace('^{commit}', '')))
    if (argv[1] === 'rev-parse') return full(argv[4]!) ? { exitCode: 0, stdout: full(argv[4]!)! } : { exitCode: 1, stdout: '' }
    if (argv[1] === 'merge-base') return { exitCode: argv[3] === A && argv[4] === B ? 0 : 1, stdout: '' }
    if (argv[1] === 'for-each-ref') return { exitCode: 0, stdout: argv[3] === A || argv[3] === tip ? `${tip}\n${tip}` : '' }
    if (argv[1] === 'log') return { exitCode: 0, stdout: `${tip} ${headAt}` }
    if (argv[0] === 'gh' && argv[1] === 'run' && argv[2] === 'list') return { exitCode: 0, stdout: JSON.stringify(runs[argv[4]!] ?? []) }
    if (argv[0] === 'gh' && argv[2] === 'view') return { exitCode: 0, stdout: JSON.stringify({ status: 'completed', conclusion: 'cancelled', workflowName: 'CI', headSha: A }) }

    return null
  })
  await $.session.start(START)
  const board = async () => {
    await clock.advance(61_000)
    return String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  }
  const cancelled = [{ status: 'completed', conclusion: 'cancelled', workflowName: 'CI' }]
  const failed = [{ status: 'completed', conclusion: 'failure', workflowName: 'CI' }]
  const passed = [{ status: 'completed', conclusion: 'success', workflowName: 'CI' }]
  const running = [{ status: 'in_progress', conclusion: null, workflowName: 'CI' }]

  // A called off, its fix B passed: done, and the ledger closes.
  runs[A] = cancelled
  runs[B] = passed
  say('a1b2c3d 不符合專案的命名規則，所以取消了它的 CI；修正已推上 9f8e7d6，正在等 9f8e7d6 的 CI。')
  let shown = await board()
  expect(shown).not.toMatch(/「商品列表頁」\(local_open\) (最後回報 CI|GitHub)/)
  expect(shown).not.toMatch(/CI 失敗・需處理\] 「商品列表頁」/)

  // B still running: waiting on CI, not failed.
  runs[B] = running
  say('a1b2c3d 不符合專案的命名規則，所以取消了它的 CI；修正已推上 9f8e7d6，正在等 9f8e7d6 的 CI。')
  shown = await board()
  expect(shown).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)
  expect(shown).not.toMatch(/CI 失敗・需處理\] 「商品列表頁」/)

  // A failed rather than called off, B passed: the fix is the newer word.
  runs[A] = failed
  runs[B] = passed
  say('a1b2c3d 的 CI 失敗了，修正已推上 9f8e7d6，正在等 9f8e7d6 的 CI。')
  expect(await board()).not.toMatch(/CI 失敗・需處理\] 「商品列表頁」/)

  // Only A named, called off; the branch's tip B holds it and passed.
  runs[A] = cancelled
  say('已推上 a1b2c3d，CI 還在跑。')
  expect(await board()).not.toMatch(/「商品列表頁」\(local_open\) (最後回報 CI|GitHub)/)

  // A's old run still going, its fix B failed: B is the newer word, and it failed.
  runs[A] = running
  runs[B] = failed
  say('a1b2c3d 的 CI 還在跑，但修正已推上 9f8e7d6，正在等 9f8e7d6 的 CI。')
  shown = await board()
  expect(shown).toMatch(/\[CI 失敗・需處理\] 「商品列表頁」\(local_open\) GitHub 上的 CI（commit 9f8e7d6）失敗/)
  runs[B] = passed

  // A cancelled run named by its id: its commit A is handed over, and B, named after it, answers.
  say('run 41022337761 被我取消了；修正 9f8e7d6 已推上，正在等它的 CI。')
  expect(await board()).not.toMatch(/「商品列表頁」\(local_open\) (最後回報 CI|GitHub)/)

  // Called off, and nothing after it: not passed, not failed. The words decide: waiting on CI.
  tip = A
  headAt = Math.floor(at / 1000) - 60
  runs[A] = cancelled
  delete runs[B]
  say('已推上 a1b2c3d，取消了它的 CI，等一下再重跑 CI。')
  shown = await board()
  expect(shown).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)
  expect(shown).not.toMatch(/CI 失敗・需處理\] 「商品列表頁」/)
  const refused = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)
  expect(refused).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」CI 尚未跑完/)
})

test('both languages say every message, with the same values to fill in', () => {
  const keys = (lang: Lang) => Object.keys(MESSAGES[lang]).sort()
  expect(keys('en')).toEqual(keys('zh-TW'))
  const mismatched = keys('en').filter(key => {
    const k = key as MessageKey
    return placeholders(MESSAGES.en[k]).join() !== placeholders(MESSAGES['zh-TW'][k]).join()
  })
  expect(mismatched).toEqual([])
  expect(keys('en').filter(key => !MESSAGES.en[key as MessageKey].trim() || !MESSAGES['zh-TW'][key as MessageKey].trim())).toEqual([])
})

test('the language: the option when it names one, else the system, any Chinese reading Traditional', () => {
  expect(resolveLang('auto', 'zh-TW')).toBe('zh-TW')
  expect(resolveLang(undefined, 'zh-Hant-HK')).toBe('zh-TW')
  expect(resolveLang('auto', 'zh-HK')).toBe('zh-TW')
  // Simplified Chinese reads Traditional rather than English.
  expect(resolveLang('auto', 'zh-CN')).toBe('zh-TW')
  expect(resolveLang('auto', 'zh-Hans-SG')).toBe('zh-TW')
  expect(resolveLang('auto', 'en-US')).toBe('en')
  expect(resolveLang('auto', 'ja-JP')).toBe('en')
  expect(resolveLang('auto', '')).toBe('en')
  expect(resolveLang('en', 'zh-TW')).toBe('en')
  expect(resolveLang('zh-TW', 'en-US')).toBe('zh-TW')
  expect(resolveLang('fr', 'fr-FR')).toBe('en')

  const was = getLang()
  setLang('en')
  expect(t('time.hours', { n: 1 })).toBe('1 hour ago')
  expect(t('time.days', { n: 3 })).toBe('3 days ago')
  expect(t('board.hidden', { n: 1 })).toMatch(/^1 more ended session with nothing left is not listed/)
  setLang('zh-TW')
  expect(t('time.hours', { n: 1 })).toBe('1 小時前')
  setLang(was)
})

test('in English: the board, the ledger and the pane', { options: { language: 'en' } }, async ($, on) => {
  const files: Files = new Map()
  // Item 1 was closed before its owner worked on: the steps it left since still show.
  const item = (id: number, status: string, owner: string | null, at = NOW) => ({ id, text: `Item ${id}`, owner, status, note: '', createdAt: at, updatedAt: at })
  files.set(
    PROJECT_FILE,
    JSON.stringify({ key: projectKey(PROJECT), name: 'Acme shop admin', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item(1, 'done', 'local_open', NOW - 3_600_000), item(2, 'open', 'local_ask'), item(3, 'open', null)], nextId: 4 }),
  )
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { plan: [{ content: 'Draw the table', status: 'completed' }, { content: 'Add filters', status: 'pending' }] })))
  files.set(`${DIR}/sessions/local_ask.json`, JSON.stringify(track('local_ask', { lastAnswer: 'Pushed to main; CI is still running.' })))
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)
  await clock.advance(400)

  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/^# Project status: /)
  expect(board).toMatch(/## Needs attention/)
  expect(board).toMatch(/- \[Stopped · unfinished\] "商品列表頁" \(local_open\) stopped with 1 step left on its task list: Add filters/)
  expect(board).toMatch(/- \[Waiting on CI · unfinished\] "移除舊版優惠欄位" \(local_ask\) last said CI has not finished/)
  expect(board).toMatch(/- \[Unassigned\] Work item T-03 "Item 3" has no owning session yet/)
  expect(board).toMatch(/Last active 10 min ago/)
  // Only the data stays as it was written: the sessions' titles, the project's folder, a transcript's words.
  expect(board.replace(/商品列表頁|移除舊版優惠欄位|金流對帳|Acme 商店後台|已修好。/g, '')).not.toMatch(/[一-鿿]/)

  const refused = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 2, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)
  // The verdict is kept; only the close is refused, and the answer says both.
  expect(refused).toMatch(/^QA recorded, but closing was refused: Cannot mark T-02 done: The owning session "移除舊版優惠欄位" is waiting on CI \(last report: /)
  expect(refused).toMatch(/pass force: true/)
  expect(JSON.parse(files.get(PROJECT_FILE)!).ledger[1]).toMatchObject({ status: 'open', qa: { result: 'pass', by: 'user' } })

  const ui = await $.ui.mount({
    plugin: 'project-pm',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'project-pm',
    props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
  } as never)
  expect(await ui.find({ type: 'Text', text: 'Work items done 1/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Waiting on CI' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Unfinished' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Not finished' })).toBeDefined()
  await ui.press({ key: 'archive:local_open' })
  expect(await ui.find({ type: 'Text', text: 'Archive it? 1 step left' })).toBeDefined()
  await ui.unmount()
})

test('/pm lang switches the language and saves it as the option', { options: { language: 'zh-TW' } }, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  mock.clock(on, { now: NOW })
  const saved: { key: string; value: unknown }[] = []
  let refusal: string | null = null
  on('config.set', ($, e) => {
    if (refusal) return { deny: refusal }
    saved.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  world(on, 'local_pm', files)
  await $.session.start(START)
  const pm = async (args: string) => String(((await $.command.run({ command: 'pm', args } as never)) as { text?: unknown }).text)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)

  expect(await board()).toMatch(/^# 專案狀態報告：/)
  expect(await pm('lang en')).toBe('The board now speaks en.')
  expect(saved).toEqual([{ key: 'project-pm.language', value: 'en' }])
  expect(await board()).toMatch(/^# Project status: /)

  expect(await pm('lang')).toBe('Usage: /pm lang en, /pm lang zh-TW or /pm lang auto (follow the system). Now: en.')

  refusal = 'locked by policy'
  expect(await pm('lang zh-TW')).toBe('看板語言已在這個 Session 改為 zh-TW，但無法存進設定（locked by policy）；下次啟動會恢復原設定。')
  expect(await board()).toMatch(/^# 專案狀態報告：/)
})

test('the board stays open until the person closes it: after a restart, an unload, or a window too narrow', ZH, async ($, on) => {
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  const panes: Pane[] = []
  world(on, 'local_me', files, [], undefined, [], panes)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  const board = async () => String(((await $.command.run({ command: 'board', args: '' } as never)) as { text?: unknown }).text)
  const isUp = () => panes.some(pane => pane.id === 'project-pm')
  const kept = () => JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!).isBoardOpen
  await $.session.start(START)
  // Not the PM, nothing said yet: no board.
  expect(isUp()).toBe(false)

  expect(await board()).toBe('已開啟專案看板。')
  expect(isUp()).toBe(true)
  expect(kept()).toBe(true)

  // The process restarts (the app resumes a session it stopped): a new process has no panes.
  panes.length = 0
  await $.session.start(START)
  expect(isUp()).toBe(true)

  // The engine drops it: the person's next prompt brings it back, and so does the poll.
  panes.length = 0
  await $.prompt.submit({ text: '看板呢？' } as never)
  expect(isUp()).toBe(true)
  panes.length = 0
  await clock.advance(31_000)
  expect(isUp()).toBe(true)
  // Gone again at once: the poll waits five minutes before it tries again.
  panes.length = 0
  await clock.advance(31_000)
  expect(isUp()).toBe(false)
  await clock.advance(5 * 60_000)
  expect(isUp()).toBe(true)

  // Opened unasked on a narrow window, it waits undrawn: /board places it rather than closing it.
  panes[0]!.isPlaced = false
  expect(await board()).toBe('已開啟專案看板。')
  expect(panes[0]!.isPlaced).toBe(true)
  // So does the person's next prompt.
  panes[0]!.isPlaced = false
  await $.prompt.submit({ text: '再看一次。' } as never)
  expect(panes[0]!.isPlaced).toBe(true)

  // /board turns it off: it stays closed, through prompts, the poll and a restart.
  expect(await board()).toBe('已收合專案看板，再次執行 /board 可重新開啟。')
  expect(isUp()).toBe(false)
  expect(kept()).toBe(false)
  await $.prompt.submit({ text: '繼續。' } as never)
  await clock.advance(6 * 60_000)
  await $.session.start(START)
  expect(isUp()).toBe(false)

  // And on again.
  expect(await board()).toBe('已開啟專案看板。')
  expect(isUp()).toBe(true)
  expect(kept()).toBe(true)
})

test("the person's close keeps the board closed; the engine's unload does not", () => {
  const close = (kind: string, id = 'project-pm') => closesBoard({ id, origin: { kind } })
  expect(close('person')).toBe(true)
  expect(close('plugin')).toBe(true)
  expect(close('unload')).toBe(false)
  // Another pane of the mod's, were there one, is not the board.
  expect(close('person', 'something-else')).toBe(false)
})

test('a new process opens the board as the person left it', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(`${DIR}/sessions/local_me.json`, JSON.stringify(track('local_me', { isBoardOpen: true })))
  mock.clock(on, { now: NOW })
  const panes: Pane[] = []
  world(on, 'local_me', files, [], undefined, [], panes)
  await $.session.start(START)
  expect(panes.map(pane => pane.id)).toEqual(['project-pm'])
})

test('the PM gets its board at the start unless the person closed it', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  files.set(`${DIR}/sessions/local_pm.json`, JSON.stringify(track('local_pm', { isBoardOpen: false })))
  const clock = mock.clock(on, { now: NOW })
  const panes: Pane[] = []
  world(on, 'local_pm', files, [], undefined, [], panes)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start(START)
  await $.prompt.submit({ text: '看一下。' } as never)
  await clock.advance(6 * 60_000)
  expect(panes).toEqual([])

  // /pm opens it again, and it is kept open.
  await $.command.run({ command: 'pm', args: '' } as never)
  expect(panes.map(pane => pane.id)).toEqual(['project-pm'])
  expect(JSON.parse(files.get(`${DIR}/sessions/local_pm.json`)!).isBoardOpen).toBe(true)
})

test('the PM with nothing said gets its board at the start', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  mock.clock(on, { now: NOW })
  const panes: Pane[] = []
  world(on, 'local_pm', files, [], undefined, [], panes)
  await $.session.start(START)
  expect(panes.map(pane => [pane.id, pane.title])).toEqual([['project-pm', 'Acme 商店後台 · PM']])
})

test('a quiet PM asks again only what can have changed', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  // A session of this project waiting on CI GitHub knows nothing about, and one of another project with a push left.
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { lastAnswer: '已 push 3fa1c2e，CI 還在跑。' })))
  files.set(`${DIR}/sessions/local_other.json`, JSON.stringify(track('local_other', { cwd: 'C:\Users\dev\Projects\Weather app', lastAnswer: '已 commit 9b8c7d6，還沒 push。' })))
  const clock = mock.clock(on, { now: NOW })
  const asked: string[] = []
  const host: Host = argv => {
    asked.push(argv[0] === 'gh' ? `gh ${argv[1]} ${argv[2]}` : `git ${argv[1]}`)
    if (argv[0] === 'gh') return { exitCode: 0, stdout: '[]' }
    if (argv[1] === 'rev-parse') return { exitCode: 0, stdout: '3fa1c2e0000000000000000000000000000000ab' }
    return { exitCode: 1, stdout: '' }
  }
  const counts: Counts = { reads: 0, calls: [], writes: [] }
  world(on, 'local_pm', files, [], host, [], [], counts)
  await $.session.start(START)
  await clock.advance(1000)
  // The first round asks GitHub about this project's CI; the other project's push is the other project's PM's.
  expect(asked.filter(a => a.startsWith('gh'))).toEqual(['gh run list'])
  // Its transcript is kept under its desktop id, for its next process.
  expect(JSON.parse(files.get(`${DIR}/transcripts.json`)!)).toEqual({ 'transcript-local_pm': 'local_pm' })
  const at = { asked: asked.length, reads: counts.reads, calls: counts.calls.length, writes: counts.writes!.length }

  // Ten quiet minutes: the app's list each round, and nothing else read, run or written.
  for (let i = 0; i < 20; i++) await clock.advance(30_000)
  expect(asked.slice(at.asked)).toEqual([])
  expect(counts.reads - at.reads).toBe(0)
  expect(counts.writes!.slice(at.writes)).toEqual([])
  expect(counts.calls.slice(at.calls).filter(c => c !== 'list_sessions')).toEqual([])
  expect(counts.calls.slice(at.calls).length).toBe(20)

  // An unknown answer is asked again after ten minutes.
  await clock.advance(30_000)
  expect(asked.slice(at.asked).filter(a => a.startsWith('gh'))).toEqual(['gh run list'])

  // The board tool over every project asks about the other project's push too.
  const before = asked.length
  await $.tool.call({ tool: 'mcp__project-pm__board', scope: 'all' } as never)
  expect(asked.slice(before).filter(a => a.startsWith('git')).length).toBeGreaterThan(0)
})

test("a resumed session draws its board at once, before the app's tools reach it", ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  files.set(`${DIR}/sessions/local_pm.json`, JSON.stringify(track('local_pm', {})))
  // What the session's last process kept: its transcript's desktop id, and its last round.
  files.set(`${DIR}/transcripts.json`, JSON.stringify({ 'transcript-local_pm': 'local_pm' }))
  const kept = { list: [{ id: 'local_open', title: '商品列表頁', cwd: PROJECT, isRunning: false, lastActivityAt: '2026-10-17T11:50:00.000Z', isPinned: false, hasOpenPr: false }], fetchedAt: NOW - 60_000, error: null }
  files.set(`${DIR}/rounds/local_pm.json`, JSON.stringify({ sessions: kept, lastWords: {}, ciChecks: {}, pushChecks: {} }))
  const clock = mock.clock(on, { now: NOW })
  const panes: Pane[] = []
  const counts: Counts = { reads: 0, calls: [], isAppAway: true }
  world(on, 'local_pm', files, [], undefined, [], panes, counts)
  await $.session.start(START)
  // The PM's board is up at the start, drawn from the last round.
  expect(panes.map(pane => [pane.id, pane.title])).toEqual([['project-pm', 'Acme 商店後台 · PM']])
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board', include_done: true } as never)) as { result?: unknown }).result)
  expect(await board()).toMatch(/商品列表頁 \(local_open\)/)

  // The first round finds no app yet.
  await clock.advance(1_000)
  // The person looks at it and the app's tools arrive: a round follows within seconds, not at the next poll.
  counts.isAppAway = false
  const asked = counts.calls.length
  await clock.advance(3_000)
  expect(counts.calls.slice(asked)).toContain('list_sessions')
  // And it knows its transcript from now on.
  expect(JSON.parse(files.get(`${DIR}/transcripts.json`)!)).toEqual({ 'transcript-local_pm': 'local_pm' })
})

test('sessions of a project with a PM are asked to declare their delivery; other projects hear nothing', ZH, async ($, on) => {
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'] as const, tools: [], outputStyle: null, traits: [] }
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_open', files)
  on('prompt.compose', () => ({ sections: [] }))
  // No PM for this project yet: nothing is added.
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])

  // Once the project has a PM, its other sessions are asked for one fixed line at their end.
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  await $.command.run({ command: 'board', args: '' } as never)
  await clock.advance(31_000)
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.map(one => one.id)).toEqual(['project-pm:delivery'])
  expect(sections[0]!.text).toMatch(/交付：不需要部署\n交付：已部署（版本或位置）\n交付：待部署（等什麼）/)
})

test('a session running an older copy than the installed one reloads, and only then', () => {
  const root = String.raw`C:\Users\dev\.claude\plugins\cache\acme-mods\project-pm\0.5.1`
  const listing = (path: string) => ({
    version: 2,
    plugins: {
      'project-pm@acme-mods': [{ scope: 'user', installPath: path, version: path.split(/[\\/]/).at(-1) }],
      'project-pm@other-market': [{ scope: 'user', installPath: String.raw`C:\elsewhere\project-pm\9.9.9`, version: '9.9.9' }],
    },
  })

  // The same copy: nothing to do.
  expect(isReplaced(installOf(listing(root), 'project-pm', root), root)).toBe(false)
  // A newer copy of the same marketplace's plugin: reload.
  const newer = installOf(listing(String.raw`C:\Users\dev\.claude\plugins\cache\acme-mods\project-pm\0.6.0`), 'project-pm', root)
  expect(isReplaced(newer, root)).toBe(true)
  expect(newer?.version).toBe('0.6.0')
  // A copy run from a mods folder or --plugin-dir is never replaced by an install.
  expect(installOf(listing(root), 'project-pm', String.raw`C:\Users\dev\.claude\local-mods\project-pm`)).toBe(null)
  // The same version installed again into the same folder: reload once it was updated since this copy saw it.
  const again = { plugins: { 'project-pm@acme-mods': [{ scope: 'user', installPath: root, lastUpdated: '2026-11-06T09:00:00.000Z' }] } }
  expect(isReplaced(installOf(again, 'project-pm', root), root, '2026-11-06T09:00:00.000Z')).toBe(false)
  expect(isReplaced(installOf(again, 'project-pm', root), root, '2026-10-20T02:27:00.000Z')).toBe(true)
  // Uninstalled: nothing to reload into.
  expect(isReplaced(installOf({ plugins: {} }, 'project-pm', root), root)).toBe(false)
})

test('a report sets the status by its fields; its free text never reads as something it did not report', () => {
  const session = { id: 'local_open', title: '商品列表頁', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  const reported = (input: Record<string, unknown>, extra: object = {}) =>
    statusOf(session, track('local_open', { report: reportOf(input), reportAt: NOW, ...extra }) as never, undefined, NOW)

  expect(reported({ status: 'waiting_ci', summary: '匯出 CSV 已推上 main', ci: 'https://github.com/acme/shop/actions/runs/12345678901' })).toBe('ci')
  expect(reported({ status: 'waiting_user', summary: '要一起發 2.3.1 嗎' })).toBe('asking')
  expect(reported({ status: 'blocked', summary: '等設計稿' })).toBe('open')
  expect(reported({ status: 'in_progress', summary: '做了一半' })).toBe('open')
  expect(reported({ status: 'waiting_release', summary: '改好了，還沒部署' })).toBe('unreleased')
  expect(reported({ status: 'done', summary: '完成', delivery: 'pending' })).toBe('unreleased')
  expect(reported({ status: 'done', summary: '完成', delivery: 'released' })).toBe('done')
  // What the summary says is not read: "CI 還在跑" in a done report is no CI running.
  expect(reported({ status: 'done', summary: '修好「CI 還在跑」被誤判的問題', delivery: 'not_needed' })).toBe('done')
  // The report outranks the words of the same turn.
  expect(reported({ status: 'done', summary: '完成', delivery: 'not_needed' }, { lastAnswer: '已推上 main，CI 還在跑，通過後才會部署。' })).toBe('done')

  expect(reportOf({ status: 'finished', summary: 'x' })).toBe(null)
  expect(reportOf({ status: 'done', summary: '  完成  ', commit: 'commit 3FA1C2E', delivery: 'maybe' })).toEqual({ status: 'done', summary: '完成', commit: '3fa1c2e' })
  expect(reportWords({ status: 'waiting_ci', summary: '', ci: 'run 12345678901', commit: '3fa1c2e' })).toBe('CI is still running (run 12345678901) for commit 3fa1c2e.\nCommitted as 3fa1c2e.')
})

test('a session of a project with a PM gets the report tool, keeps its report and tells the PM at once', ZH, async ($, on) => {
  const files: Files = new Map()
  const tools: string[] = []
  const sent: { to: string; text: string }[] = []
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  // The PM's mod takes update messages in.
  files.set(`${DIR}/sessions/local_pm.json`, JSON.stringify(track('local_pm', { inbox: 1 })))
  mock.clock(on, { now: NOW })
  on('session.send', ($, e) => {
    sent.push({ to: e.to, text: e.text })

    return { isDelivered: true }
  })
  world(on, 'local_open', files, [], () => null, tools)
  await $.session.start(START)
  expect(tools).toContain('report')

  const answer = await $.tool.call({ tool: 'mcp__project-pm__report', status: 'waiting_ci', summary: '匯出 CSV 已推上 main', commit: '3fa1c2e' } as never)
  expect(String((answer as { result?: unknown }).result)).toBe('已回報給 PM：waiting_ci。')
  const kept = JSON.parse(files.get(`${DIR}/sessions/local_open.json`)!)
  expect(kept.report).toEqual({ status: 'waiting_ci', summary: '匯出 CSV 已推上 main', commit: '3fa1c2e' })
  expect(kept.inbox).toBe(1)
  // The PM is told now, by id only: its board reads the track from disk.
  expect(sent).toEqual([{ to: 'local_pm', text: '[project-pm:update] {"id":"local_open"}' }])

  const refused = await $.tool.call({ tool: 'mcp__project-pm__report', status: 'finished', summary: 'x' } as never)
  expect(String((refused as { result?: unknown }).result)).toMatch(/status 要是 done/)
})

test('a PM whose mod cannot take updates in is not sent them, and the PM itself never reports', ZH, async ($, on) => {
  const files: Files = new Map()
  const tools: string[] = []
  const sent: string[] = []
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_oldpm', isDismissed: false, ledger: [], nextId: 1 }))
  // An older PM: its track has no inbox, so a message would start a turn there.
  files.set(`${DIR}/sessions/local_oldpm.json`, JSON.stringify(track('local_oldpm', {})))
  mock.clock(on, { now: NOW })
  on('session.send', ($, e) => {
    sent.push(e.to)

    return { isDelivered: true }
  })
  world(on, 'local_open', files, [], () => null, tools)
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__project-pm__report', status: 'done', summary: '完成', delivery: 'not_needed' } as never)
  expect(JSON.parse(files.get(`${DIR}/sessions/local_open.json`)!).report.status).toBe('done')
  expect(sent).toEqual([])
})

test('the PM takes an update in without a turn and its board reads the session at once', ZH, async ($, on) => {
  const files: Files = new Map()
  const counts: Counts = { reads: 0, calls: [] }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const clock = mock.clock(on, { now: NOW })
  on('session.receive', ($, e) => ({ text: e.text }))
  world(on, 'local_pm', files, [], () => null, [], [], counts)
  await $.session.start(START)
  await clock.advance(1_000)

  // The session wrote its report, then told the PM.
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { report: { status: 'waiting_user', summary: '要一起發 2.3.1 嗎？' }, reportAt: NOW })))
  const calls = counts.calls.length
  const taken = await $.session.receive({
    origin: { kind: 'peer', plugin: 'project-pm' },
    text: '<cross-session-message from="local_open" name="商品列表頁">\n[project-pm:update] {"id":"local_open"}\n</cross-session-message>',
  } as never)
  expect(taken).toEqual({ consumed: 'project-pm: update from local_open' })
  await clock.advance(200)
  // A round ran at once, not at the next 30-second poll.
  expect(counts.calls.slice(calls)).toContain('list_sessions')
  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).toMatch(/\[待回覆\] 「商品列表頁」\(local_open\) 等待使用者決策：要一起發 2\.3\.1 嗎？/)
  expect(board).toMatch(/回報：\[waiting_user\] 要一起發 2\.3\.1 嗎？/)

  // Anything else a peer sends goes on to the model as before.
  const other = await $.session.receive({ origin: { kind: 'peer' }, text: '幫我看一下 PR' } as never)
  expect(other).toEqual({ text: '幫我看一下 PR' })
})

test('the development guidelines reach the PM and the sessions of its project, read fresh each turn', { options: { language: 'zh-TW', guidelines: '~/Documents/rules.md' } }, async ($, on) => {
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'] as const, tools: [], outputStyle: null, traits: [] }
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const RULES = 'C:/home/Documents/rules.md'
  files.set(RULES, '\uFEFF# 準則\n\n- 只改要改的標的\n')
  mock.clock(on, { now: NOW })
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(JSON.stringify(e))

    return { value: undefined }
  })
  world(on, 'local_pm', files)
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(START)

  const rules = async () => (await $.prompt.compose(COMPOSE)).sections.find(one => one.id === 'project-pm:guidelines')?.text
  const first = await rules()
  expect(first).toMatch(/^# 開發準則/)
  expect(first).toMatch(/你是 PM/)
  // A request against the guidelines is asked about, as a one-time exception, and the file is not theirs to change.
  expect(first).toMatch(/問使用者這次是否要例外執行/)
  expect(first).toMatch(/例外只算這一次/)
  expect(first).toMatch(/只有使用者明確要求修改準則時才改/)
  expect(first).toMatch(/記在對應工作項目的備註/)
  expect(first).toMatch(/# 準則\n\n- 只改要改的標的$/)

  // An edit to the file reaches the next turn.
  files.set(RULES, '# 準則\n\n- 先寫重現測試')
  expect(await rules()).toMatch(/先寫重現測試$/)

  // A file that cannot be read adds nothing and is logged once.
  files.delete(RULES)
  expect(await rules()).toBeUndefined()
  expect(await rules()).toBeUndefined()
  expect(logs.filter(line => /讀不到開發準則/.test(line))).toHaveLength(1)
})

test('a session of a project with a PM gets the guidelines without the PM part; other projects get nothing', { options: { language: 'zh-TW', guidelines: 'docs/RULES.md' } }, async ($, on) => {
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'] as const, tools: [], outputStyle: null, traits: [] }
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  // A relative path is the project's own file.
  files.set(`${PROJECT.replace(/\\/g, '/')}/docs/RULES.md`, '- 一個 commit 只做一件事')
  world(on, 'local_open', files)
  on('prompt.compose', () => ({ sections: [] }))
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])

  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  await $.command.run({ command: 'board', args: '' } as never)
  await clock.advance(31_000)
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.map(one => one.id)).toEqual(['project-pm:delivery', 'project-pm:guidelines'])
  expect(sections[1]!.text).toMatch(/「Acme 商店後台」/)
  expect(sections[1]!.text).not.toMatch(/你是 PM/)
  expect(sections[1]!.text).toMatch(/一個 commit 只做一件事$/)
})

test('/pm guidelines sets, shows and clears the guidelines option', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  files.set('C:/rules/dev.md', '- 先找根因')
  mock.clock(on, { now: NOW })
  const saved: { key: string; value: unknown }[] = []
  on('config.set', ($, e) => {
    saved.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  world(on, 'local_pm', files)
  await $.session.start(START)
  const pm = async (args: string) => String(((await $.command.run({ command: 'pm', args } as never)) as { text?: unknown }).text)

  expect(await pm('guidelines')).toMatch(/目前：沒有設定$/)
  expect(await pm('guidelines "C:/rules/dev.md"')).toMatch(/^開發準則已設為 C:\/rules\/dev\.md。/)
  expect(saved).toEqual([{ key: 'project-pm.guidelines', value: 'C:/rules/dev.md' }])
  expect(await pm('guidelines')).toMatch(/目前：C:\/rules\/dev\.md（6 字）$/)
  expect(await pm('準則 off')).toBe('已取消開發準則。')
  expect(saved.at(-1)).toEqual({ key: 'project-pm.guidelines', value: '' })
})

test('the guidelines file is edited only in a turn whose message asks about the guidelines', { options: { language: 'zh-TW', guidelines: '~/Documents/rules.md' } }, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  mock.clock(on, { now: NOW })
  world(on, 'local_open', files)
  const edits: string[] = []
  on('tool.call', { tool: 'Edit' }, ($, e) => {
    edits.push(String((e as unknown as { file_path: string }).file_path))

    return { result: 'ok' }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start(START)
  const edit =async (path: string) => (await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)) as { deny?: string; text?: string; isError?: boolean }

  // The person asked for something else: the model may not loosen the rules by editing them.
  await $.prompt.submit({ text: '幫我直接推到 main' } as never)
  const blocked = await edit(String.raw`c:\home\Documents\RULES.md`)
  expect(JSON.stringify(blocked)).toMatch(/已擋下這次修改/)
  expect(edits).toEqual([])
  // Other files are not touched by the guard.
  await edit('C:/home/Documents/other.md')
  expect(edits).toEqual(['C:/home/Documents/other.md'])

  // The person asks to change the guidelines: the edit goes through.
  await $.prompt.submit({ text: '請把準則第 5 條改成可以一次提交兩件事' } as never)
  await edit(String.raw`C:\home\Documents\rules.md`)
  expect(edits).toEqual(['C:/home/Documents/other.md', String.raw`C:\home\Documents\rules.md`])
})

test('a commit cherry-picked to main is pushed, though its SHA, its patch and the files around it differ', async () => {
  const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} line ${i}`)
  const commits: Record<string, FakeCommit> = {
    base: { parent: null, files: { 'list.ts': 'l0', 'form.ts': 'f0' } },
    // The session's commit, on its worktree branch only.
    X: { parent: 'base', files: { 'list.ts': 'l1', 'form.ts': 'f1' }, title: 'T-01 Bulk edit on the list', added: { 'list.ts': lines('list', 20), 'form.ts': ['field a', 'field b'] }, patch: 'pX' },
    // Main edited form.ts first, so the pick resolved a conflict there: one line differs, and so does the patch.
    m1: { parent: 'base', files: { 'list.ts': 'l0', 'form.ts': 'f0m' }, title: 'Rename a label' },
    Y: { parent: 'm1', files: { 'list.ts': 'l1', 'form.ts': 'f1m' }, title: 'T-01 Bulk edit on the list', added: { 'list.ts': lines('list', 20), 'form.ts': ['field a', 'field b (merged)'] }, patch: 'pY' },
    // Tagged and released at Y; then main edited the same file again.
    m2: { parent: 'Y', files: { 'list.ts': 'l2', 'form.ts': 'f1m' }, title: 'Tidy the list' },
    // A clean pick of another commit: the same patch.
    Z: { parent: 'base', files: { 'list.ts': 'l0', 'form.ts': 'f0z' }, title: 'T-02 Fix a typo', added: { 'form.ts': ['typo fixed'] }, patch: 'pZ' },
    m3: { parent: 'm2', files: { 'list.ts': 'l2', 'form.ts': 'f1mz' }, title: 'T-02 Fix a typo (picked)', added: { 'form.ts': ['typo fixed'] }, patch: 'pZ' },
    // The same title as X, but another change: not the same work.
    W: { parent: 'base', files: { 'list.ts': 'lw', 'form.ts': 'f0' }, title: 'T-01 Bulk edit on the list', added: { 'list.ts': lines('other', 20) }, patch: 'pW' },
  }
  const git = fakeGit(commits, { worktree: 'X', fix: 'Z', other: 'W' }, { 'origin/main': 'm3' })

  // Neither its SHA nor its blobs are on main, and its patch differs: its title and its lines are.
  expect(await isPushedContent(git, 'X')).toBe(true)
  // A clean pick: git cherry finds it by its patch.
  expect(await isPushedContent(git, 'Z')).toBe(true)
  expect(await isPushedContent(git, 'W')).toBe(false)
})

test('a released report is delivered, and the ledger closes it without force', ZH, async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '清單批次修改', owner: 'local_open', status: 'open', note: '', createdAt: NOW - 7_200_000, updatedAt: NOW - 7_200_000 }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  // Its commit is on a worktree branch only; main holds a cherry-pick git cannot tie back to it here.
  const report = { status: 'done', summary: 'T-01 已隨 2.4.1 上線', delivery: 'released', commit: '3fa1c2e' }
  const plan = Array.from({ length: 6 }, (_, i) => ({ content: `步驟 ${i + 1}`, status: 'completed' }))
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { plan, report, reportAt: NOW - 600_000 - 1, lastAnswer: 'T-01 已隨 2.4.1 上線。' })))
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], argv => (argv[0] === 'git' && argv[1] === 'rev-parse' ? { exitCode: 0, stdout: '3fa1c2e' } : null))
  await $.session.start(START)
  await clock.advance(61_000)
  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).not.toMatch(/待發布・未完成\] 「商品列表頁」/)
  expect(board).not.toMatch(/Committed as|Delivery: deployed/)
  const close = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'user' } as never)) as { result?: unknown }).result)
  expect(close).toMatch(/已更新工作項目 T-01/)
})

test('work the person closed in the ledger leaves the attention list until the session reports again', ZH, async ($, on) => {
  const files: Files = new Map()
  const closed = { id: 1, text: '清單批次修改', owner: 'local_open', status: 'done', note: '使用者確認結案', createdAt: NOW - 7_200_000, updatedAt: NOW - 60_000 }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [closed], nextId: 2 }))
  // Its words still leave a push: the person judged it and closed the item after them.
  const said = (turnAt: number, lastAnswer = '2.4.1 還沒 push，等 PM 確認。') => track('local_open', { lastAnswer, turnAt, planAt: turnAt })
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(said(NOW - 600_000)))
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)
  await clock.advance(400)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  const before = await board()
  expect(before).not.toMatch(/待發布・未完成\] 「商品列表頁」/)
  expect(before).toMatch(/待發布 0/)

  // It speaks again after the close: its words count again.
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(said(NOW + 30_000, '2.4.1 還是沒 push，還在等 PM 確認。')))
  await clock.advance(61_000)
  expect(await board()).toMatch(/\[待發布・未完成\] 「商品列表頁」\(local_open\) 最後回報尚未交付（push）/)
})

test('the board quotes the report itself beside its verdict, never the words its checks read', () => {
  const one = { id: 'local_open', title: '商品列表頁', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW - 5 * 60_000).toISOString(), isPinned: false, hasOpenPr: false }
  const report = { status: 'done', summary: 'T-01 完成，等 PM 放行後部署', delivery: 'pending', commit: '3fa1c2e' }
  // Called directly, boardText speaks the language set here, not the plugin's option: each language in turn.
  const board = (lang: Lang) => {
    const was = getLang()
    setLang(lang)
    try {
      return boardText({
        project: { name: 'Acme 商店後台', path: PROJECT },
        sessions: [one],
        tracks: { local_open: track('local_open', { report, reportAt: NOW - 600_000 - 1 }) as never },
        words: {},
        ledger: [],
        now: NOW,
      } as never)
    } finally {
      setLang(was)
    }
  }
  const zh = board('zh-TW')
  expect(zh).toMatch(/\[待發布・未完成\] 「商品列表頁」\(local_open\) 最後回報尚未交付（發布／部署／上線），不能視為完成：\[done, pending, 3fa1c2e\] T-01 完成，等 PM 放行後部署/)
  const en = board('en')
  expect(en).toMatch(/\[Not released · unfinished\] "商品列表頁" \(local_open\) .*: \[done, pending, 3fa1c2e\] T-01 完成，等 PM 放行後部署/)
  for (const text of [zh, en]) expect(text).not.toMatch(/Committed as|Delivery: pending/)
})

test('the ledger answers with what changed, lists open items by default, and shows one item whole by id', ZH, async ($, on) => {
  const files: Files = new Map()
  const long = '驗收：'.padEnd(400, '過')
  // A ledger that has grown: 25 items done with long notes, 5 open.
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    text: `工作項目 ${i + 1}`,
    owner: i === 29 ? 'local_open' : null,
    status: i < 25 ? 'done' : 'open',
    note: i < 25 ? long : '',
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
  }))
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: items, nextId: 31 }))
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { lastAnswer: '2.4.1 還沒 push，等 PM 確認。' })))
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)
  const ledger = async (input: object) => String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown }).result)

  // Add and update answer with the one item.
  const added = await ledger({ action: 'add', text: '匯出 CSV' })
  expect(added.split('\n')).toEqual(['已新增工作項目 T-31（id 31）。', 'T-31 (id 31) [open] 匯出 CSV｜負責：未指派'])
  const updated = await ledger({ action: 'update', id: 26, note: '進行中' })
  expect(updated.split('\n')).toEqual(['已更新工作項目 T-26。', 'T-26 (id 26) [open] 工作項目 26｜負責：未指派｜備註：進行中'])
  expect(await ledger({ action: 'update', id: 99 })).toBe('找不到工作項目 id 99。')
  // A refusal: the reason and the item, nothing else.
  const refused = await ledger({ action: 'update', id: 30, status: 'done' })
  expect(refused).toMatch(/^無法將 T-30 標記為完成：/)
  expect(refused).toMatch(/\nT-30 \(id 30\) \[open\] 工作項目 30｜負責：local_open$/)
  expect(refused).not.toMatch(/T-01|T-26/)

  // A list: the open items, and a line for the rest.
  const open = await ledger({ action: 'list' })
  expect(open.split('\n').filter(line => line.startsWith('T-')).map(line => line.split(' ')[0])).toEqual(['T-26', 'T-27', 'T-28', 'T-29', 'T-30', 'T-31'])
  expect(open).toMatch(/另有 25 項已結案或放棄/)
  // Every item on request, each note cut to a line; one item by id, whole.
  const all = await ledger({ action: 'list', include_done: true })
  expect(all.split('\n').filter(line => line.startsWith('T-')).length).toBe(31)
  expect(all).not.toMatch(/另有/)
  expect(all.length).toBeLessThan(31 * 160)
  expect(await ledger({ action: 'list', id: 1 })).toBe(`T-01 (id 1) [done] 工作項目 1｜負責：未指派｜備註：${long}`)
})

test('ledger rows read in both languages, clipped in a list and whole on their own', () => {
  const item = { id: 3, text: '匯出 CSV'.padEnd(150, '。'), owner: null, status: 'open' as const, note: 'n'.repeat(200), createdAt: NOW, updatedAt: NOW }
  const rows = (lang: Lang) => {
    const was = getLang()
    setLang(lang)
    try {
      return { list: ledgerText([item, { ...item, id: 4, status: 'done' as const }]), whole: ledgerRow(item, true) }
    } finally {
      setLang(was)
    }
  }
  const zh = rows('zh-TW')
  expect(zh.list).toMatch(/^T-03 \(id 3\) \[open\] 匯出 CSV。+…｜負責：未指派｜備註：n+…\n（另有 1 項已結案或放棄/)
  expect(zh.whole).toContain('n'.repeat(200))
  const en = rows('en')
  expect(en.list).toMatch(/^T-03 \(id 3\) \[open\] .+… \| owner: unassigned \| note: n+…\n\(1 more done or dropped/)
  expect(en.whole).toContain('n'.repeat(200))
})

test('a report keeps its long telling in a file the board points to; the PM reads one line', ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  mock.clock(on, { now: NOW })
  world(on, 'local_open', files)
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(START)
  const detail = `## 做法\n${'說明。'.repeat(800)}`
  const answer = String(((await $.tool.call({ tool: 'mcp__project-pm__report', status: 'done', summary: '匯出 CSV 完成', commit: '3fa1c2e', delivery: 'not_needed', detail } as never)) as { result?: unknown }).result)
  const path = `${DIR}/reports/local_open/2026-10-17T12-00-00-000Z.md`
  expect(answer).toBe(`已回報給 PM：done。詳細內容已存到 ${path}，給 PM 的訊息附上這個路徑即可。`)
  expect(files.get(path)).toBe(`${detail}\n`)
  const kept = JSON.parse(files.get(`${DIR}/sessions/local_open.json`)!)
  expect(kept.report).toEqual({ status: 'done', summary: '匯出 CSV 完成', commit: '3fa1c2e', delivery: 'not_needed', detail: path })

  // The instruction asks for the short form, in messages to the PM too.
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'] as const, tools: [], outputStyle: null, traits: [] }
  const asked = (await $.prompt.compose(COMPOSE)).sections.find(one => one.id === 'project-pm:delivery')?.text ?? ''
  expect(asked).toMatch(/寫進 detail/)
  expect(asked).toMatch(/SendMessage、wrap_up 摘要、最後的回答）也用同樣的短格式，總長約 300 字以內/)
})

test('the board points to the detail file and quotes one short line', ZH, () => {
  const one = { id: 'local_open', title: '商品列表頁', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW - 5 * 60_000).toISOString(), isPinned: false, hasOpenPr: false }
  const report = { status: 'waiting_release', summary: `匯出 CSV 完成，等 PM 放行。${'細節'.repeat(200)}`, delivery: 'pending', detail: `${DIR}/reports/local_open/x.md` }
  const board = (lang: Lang) => {
    const was = getLang()
    setLang(lang)
    try {
      return boardText({ project: { name: 'Acme 商店後台', path: PROJECT }, sessions: [one], tracks: { local_open: track('local_open', { report, reportAt: NOW - 600_000 - 1, recap: '很長的收尾摘要。'.repeat(50), recapAt: NOW - 600_000 - 2, lastAnswer: '很長的最後回答。'.repeat(100), lastPrompt: '<task-notification> 背景作業完成 </task-notification>', plan: [{ content: '畫表格', status: 'completed' }, { content: '加匯出', status: 'completed' }] }) as never }, words: {}, ledger: [], now: NOW } as never)
    } finally {
      setLang(was)
    }
  }
  for (const [lang, attention, detailLine] of [['zh-TW', '- [待發布・未完成]', `詳細：${DIR}/reports/local_open/x.md`], ['en', '- [Not released · unfinished]', `Detail: ${DIR}/reports/local_open/x.md`]] as const) {
    const text = board(lang)
    const line = text.split('\n').find(l => l.startsWith(attention))!
    // The quote is one line, cut at 120 characters (QUOTE).
    expect(QUOTE).toBe(120)
    expect(line.slice(line.lastIndexOf('[waiting_release')).length).toBeLessThanOrEqual(120)
    expect(text).toContain(detailLine)
    // The report stands for the turn: the long answer beside it is not repeated.
    expect(text).not.toContain('很長的最後回答')
    expect(text).not.toContain('很長的收尾摘要')
    // A list all ticked is its count; a notification is no instruction.
    expect(text).toContain(lang === 'en' ? 'Tasks 2/2\n' : '任務 2/2\n')
    expect(text).not.toContain('畫表格')
    expect(text).not.toContain('task-notification')
  }
})

/** The PM with agents: the engine's Agent tool, spawn, list and notifications, from memory. */
function agentWorld(on: On, files: Files, git: (argv: readonly string[]) => { exitCode: number; stdout: string } | null) {
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const calls: Record<string, unknown>[] = []
  const spawned: { prompt: string }[] = []
  const seen: string[] = []
  const live: { id: string }[] = []
  world(on, 'local_pm', files, [], argv => (argv[0] === 'git' ? git(argv) : null))
  on('tool.call', { tool: 'Agent' }, ($, e) => {
    const input = e as unknown as Record<string, unknown>
    calls.push(input)
    const agentId = `a${calls.length}`
    live.push({ id: agentId })

    return { result: { agentId, isAsync: true, status: 'async_launched' } } as never
  })
  on('agent.spawn', ($, e) => {
    spawned.push({ prompt: e.prompt })

    return { model: 'claude-opus-5-5' } as never
  })
  on('agent.list', () => ({ value: live.map(one => ({ id: one.id, description: '', type: 'general-purpose', status: 'running' })) }) as never)
  on('prompt.submit', ($, e) => {
    seen.push(e.text)

    return { text: e.text } as never
  })

  return { calls, spawned, seen, live }
}

const notice = (id: string, result: string, extra = '') =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>${result}</result>\n<usage><subagent_tokens>58000</subagent_tokens><tool_uses>12</tool_uses><duration_ms>140000</duration_ms></usage>${extra}\n</task-notification>`
const worktreeOf = (id: string) => `\n<worktree><worktreePath>C:/w/.claude/worktrees/agent-${id}</worktreePath><worktreeBranch>worktree-agent-${id}</worktreeBranch></worktree>`

test("the PM's agents: in the background, in a worktree unless they only read, followed to the end", ZH, async ($, on) => {
  const files: Files = new Map()
  let merged = false
  const clock = mock.clock(on, { now: NOW })
  const w = agentWorld(on, files, argv => {
    if (argv[1] === 'rev-parse') return { exitCode: 0, stdout: 'true' }
    if (argv[1] === 'merge-base') return merged ? { exitCode: 0, stdout: '' } : { exitCode: 1, stdout: '' }
    return null
  })
  await $.session.start(START)
  const agents = () => JSON.parse(files.get(`${DIR}/sessions/local_pm.json`)!).agents as { id: string; state: string; [k: string]: unknown }[]
  const ledger = async (input: object) => {
    const out = (await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown; deny?: string }
    return String(out.result ?? out.deny)
  }
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board', include_done: true } as never)) as { result?: unknown }).result)

  // The spawn: the brief, its detail file, and the work item it does.
  await $.agent.spawn({ tool_use_id: 'call-1', prompt: '依範本排序匯出欄位', description: 'T-12 修正匯出欄位順序', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  const brief = w.spawned[0]!.prompt
  expect(brief).toMatch(/^依範本排序匯出欄位\n\n---\n這是 PM 派給你的背景工作（工作項目 T-12）/)
  expect(brief).toMatch(/不要 push、不要發布，也不要改 PM 的 ledger/)
  expect(brief).toMatch(/你在自己的 git worktree 裡工作/)
  const detail = /寫進這個檔案：(\S+\.md)。/.exec(brief)?.[1]
  expect(detail).toMatch(/^C:\/home\/\.claude\/project-pm\/reports\/agents\/.+\.md$/)

  // The call: in the background and in a worktree; recorded as running.
  await $.tool.call({ tool: 'Agent', tool_use_id: 'call-1', description: 'T-12 修正匯出欄位順序', prompt: '依範本排序匯出欄位', subagent_type: 'general-purpose' } as never)
  expect([w.calls[0]!.run_in_background, w.calls[0]!.isolation]).toEqual([true, 'worktree'])
  expect(agents()).toEqual([{ id: 'a1', description: 'T-12 修正匯出欄位順序', item: 12, type: 'general-purpose', isolated: true, state: 'running', startedAt: NOW, detail }])
  // A type that only reads stays in the folder.
  await $.tool.call({ tool: 'Agent', tool_use_id: 'call-2', description: 'T-13 查詢舊日期格式', prompt: '查一下', subagent_type: 'Explore' } as never)
  expect([w.calls[1]!.run_in_background, w.calls[1]!.isolation]).toEqual([true, undefined])
  expect(agents()[1]).toMatchObject({ id: 'a2', isolated: false, state: 'running', item: 13 })

  // An agent owns a work item: it is not closed while the agent runs, and an agent cannot change the ledger.
  await ledger({ action: 'add', text: '修正匯出欄位順序', owner: 'agent:a1' })
  expect(await ledger({ action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'agent:q1' })).toMatch(/^QA 已記錄，但結案被擋：無法將 T-01 標記為完成：負責的 Agent「T-12 修正匯出欄位順序」執行中/)
  expect(await ledger({ action: 'update', id: 1, status: 'done', agentId: 'a1' })).toBe('Agent 只能讀 ledger（list），新增和修改工作項目是 PM 的事。把要改的內容寫在你的回覆裡，交給 PM。')
  expect(await ledger({ action: 'add', text: '另一件事', agentId: 'a1' })).toMatch(/^Agent 只能讀 ledger/)
  expect(await ledger({ action: 'list', agentId: 'a1' })).toMatch(/^T-01 \(id 1\) \[open\] 修正匯出欄位順序｜負責：agent:a1/)

  // It finishes: its long reply goes to a file, the PM reads the first line and the path; it waits to be verified.
  const reply = '[done, 3fa1c2e] 欄位依範本排序，新增 6 項測試\n做法：…\n驗證：…'
  await $.prompt.submit({ text: notice('a1', reply, worktreeOf('a1')), isMeta: true } as never)
  const kept = `${DIR}/reports/agents/a1.md`
  expect(files.get(kept)).toBe(`${reply}\n`)
  expect(w.seen.at(-1)).toContain(`<result>[done, 3fa1c2e] 欄位依範本排序，新增 6 項測試\n詳細：${kept}</result>`)
  expect(w.seen.at(-1)).not.toContain('做法')
  expect(agents()[0]).toMatchObject({ state: 'verify', commit: '3fa1c2e', tokens: 58000, tools: 12, durationMs: 140000, detail: kept, worktree: { branch: 'worktree-agent-a1' } })
  expect(await ledger({ action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'agent:q1' })).toMatch(/負責的 Agent「T-12 修正匯出欄位順序」待驗收/)
  const text = await board()
  expect(text).toMatch(/- \[Agent 待驗收\] T-12 修正匯出欄位順序：commit 3fa1c2e 在分支 worktree-agent-a1，尚未合併進專案分支/)
  expect(text).toMatch(/負責：Agent「T-12 修正匯出欄位順序」（待驗收）/)
  expect(text).toMatch(/## Agents\n- ◆ \[待驗收\] T-12 修正匯出欄位順序（a1）・耗時 2 分 20 秒：\[done, 3fa1c2e\] 欄位依範本排序，新增 6 項測試/)
  expect(text).not.toMatch(/負責人失聯/)
  // The pane: the agents beside the sessions, a diamond for each, the work item's agent owner and the detail file.
  const ui = await $.ui.mount({
    plugin: 'project-pm',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'project-pm',
    props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } },
  } as never)
  expect(await ui.find({ type: 'Text', text: '其中 Agent 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'AGENTS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'T-12 修正匯出欄位順序' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '待驗收' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '58k tokens　·　工具 12 次' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '負責　Agent・修正匯出欄位順序・待驗收' })).toBeDefined()
  expect(await ui.find({ key: 'agentDetail:a1' })).toBeDefined()

  // A second notice of the same agent (it was sent a message and ran again) updates its record, not a new one.
  await $.prompt.submit({ text: notice('a1', '[done, 3fa1c2e] 補上一項測試', worktreeOf('a1')), isMeta: true } as never)
  expect(agents().filter(a => a.id === 'a1').length).toBe(1)
  expect(agents()[0]).toMatchObject({ state: 'verify', result: '[done, 3fa1c2e] 補上一項測試' })
  // A command's notification is none of the agents' business: it passes as it came.
  const command = '<task-notification>\n<task-id>bxyz</task-id>\n<status>completed</status>\n<result>output</result>\n</task-notification>'
  await $.prompt.submit({ text: command, isMeta: true } as never)
  expect(w.seen.at(-1)).toBe(command)

  // The read-only agent is no longer running anywhere: the PM's process before this one ended with it.
  w.live.splice(1, 1)
  await clock.advance(31_000)
  expect(agents()[1]).toMatchObject({ id: 'a2', state: 'lost' })
  expect(await board()).toMatch(/- \[Agent 已中斷\] T-13 查詢舊日期格式：PM 的程序結束時它還在執行，需要重新派工/)

  // The PM merges the commit: done, and the work item closes.
  merged = true
  expect(await ledger({ action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'agent:q1' })).toMatch(/^已更新工作項目 T-01/)
  expect(agents()[0]).toMatchObject({ state: 'done' })
})

test('an agent that may write is refused outside git; one that only reads goes ahead', ZH, async ($, on) => {
  const files: Files = new Map()
  mock.clock(on, { now: NOW })
  const w = agentWorld(on, files, () => null)
  await $.session.start(START)
  const write = (await $.tool.call({ tool: 'Agent', tool_use_id: 'c1', description: '改檔案', prompt: 'x', subagent_type: 'general-purpose' } as never)) as { deny?: string }
  expect(write.deny).toMatch(/^這個專案的資料夾不是 git repo/)
  expect(w.calls).toEqual([])
  await $.tool.call({ tool: 'Agent', tool_use_id: 'c2', description: '只查詢', prompt: 'x', subagent_type: 'Explore' } as never)
  expect(w.calls.length).toBe(1)
})

test('a session that is not the PM starts agents as it likes', ZH, async ($, on) => {
  const files: Files = new Map()
  mock.clock(on, { now: NOW })
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  const calls: Record<string, unknown>[] = []
  world(on, 'local_open', files)
  on('tool.call', { tool: 'Agent' }, ($, e) => {
    calls.push(e as unknown as Record<string, unknown>)
    return { result: { agentId: 'z1' } } as never
  })
  await $.session.start(START)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'c1', description: 'x', prompt: 'x', subagent_type: 'general-purpose' } as never)
  expect([calls[0]!.run_in_background, calls[0]!.isolation]).toEqual([undefined, undefined])
  expect(JSON.parse(files.get(`${DIR}/sessions/local_open.json`)!).agents).toBe(undefined)
})

test("the PM's agents in English: the brief, the notice and the board", { options: { language: 'en' } }, async ($, on) => {
  const files: Files = new Map()
  mock.clock(on, { now: NOW })
  const w = agentWorld(on, files, argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'true' } : null))
  await $.session.start(START)
  await $.agent.spawn({ tool_use_id: 'call-1', prompt: 'Sort the export columns', description: 'T-12 Fix CSV column order', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  expect(w.spawned[0]!.prompt).toMatch(/\n---\nThis is background work the PM has given you \(work item T-12\)/)
  expect(w.spawned[0]!.prompt).toMatch(/You work in a git worktree of your own/)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'call-1', description: 'T-12 Fix CSV column order', prompt: 'x', subagent_type: 'general-purpose' } as never)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'call-2', description: 'T-15 Check old date format', prompt: 'x', subagent_type: 'Explore' } as never)
  await $.prompt.submit({ text: notice('a1', '[done, 3fa1c2e] Columns follow the template\nHow: …', worktreeOf('a1')), isMeta: true } as never)
  expect(w.seen.at(-1)).toContain(`<result>[done, 3fa1c2e] Columns follow the template\nDetail: ${DIR}/reports/agents/a1.md</result>`)
  await $.prompt.submit({ text: notice('a2', '[waiting_user] 312 old orders use day-first dates: convert them?'), isMeta: true } as never)
  const ledger = (await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'add', text: 'x', agentId: 'a2' } as never)) as { deny?: string }
  expect(ledger.deny).toMatch(/^An agent may only read the ledger/)
  const text = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(text).toMatch(/- \[Agent to verify\] T-12 Fix CSV column order: commit 3fa1c2e on branch worktree-agent-a1/)
  expect(text).toMatch(/- \[Agent needs decision\] T-15 Check old date format: \[waiting_user\] 312 old orders/)
  expect(text).toMatch(/## Agents\n- ◆ \[To verify\] T-12 Fix CSV column order \(a1\) · took 2 m 20 s: /)
})

test('a notice and a first line read as the agent wrote them', () => {
  const [one] = noticesOf(notice('a7', '[blocked] needs a login\nmore', worktreeOf('a7')))
  expect(one).toEqual({ id: 'a7', status: 'completed', result: '[blocked] needs a login\nmore', tokens: 58000, tools: 12, durationMs: 140000, worktree: { path: 'C:/w/.claude/worktrees/agent-a7', branch: 'worktree-agent-a7' } })
  expect(stateOf('completed', '[blocked] needs a login', true)).toBe('decide')
  expect(stateOf('completed', '[done, 3fa1c2e] x', true)).toBe('verify')
  expect(stateOf('completed', '[done, 3fa1c2e] x', false)).toBe('done')
  expect(stateOf('failed', '[done] x', false)).toBe('failed')
  expect(stateOf('killed', '', false)).toBe('failed')
  expect(itemOf('T-07 Fix it')).toBe(7)
  expect(itemOf('Fix it')).toBe(null)
  expect(commitOfLine('[done, 3FA1C2E] x')).toBe('3fa1c2e')
})

test('a turn that ended with wrap_up waits only on what it started, not on words that describe waiting', ZH, async ($, on) => {
  const one = { id: 'x', title: 't', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW - 5 * 60_000).toISOString(), isPinned: false, hasOpenPr: false }
  // A real session's closing words: how the board treats work items, not anything it waits on.
  const answer = 'T-24 完成。交給 Agent 的工作項目，要等它完成才能結案；有 commit 的，要等 PM 合併進專案分支才算完成。'
  const wrapped = track('x', { lastAnswer: answer, recap: 'T-24 完成，已 commit。', recapAt: NOW - 600_000 - 1 })
  expect(statusOf(one, wrapped as never, undefined, NOW)).toBe('done')
  // With no wrap_up, the words are all there is to go on, for a while.
  expect(statusOf(one, track('x', { lastAnswer: answer }) as never, undefined, NOW)).toBe('waiting')
  // A background command it started still counts, recap or not.
  expect(statusOf(one, { ...wrapped, background: [{ id: 'b1', label: 'tests', at: NOW - 60_000 }] } as never, undefined, NOW)).toBe('waiting')
})

test("a session's own background agent keeps it in the background until its notification", ZH, async ($, on) => {
  const files: Files = new Map()
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [], nextId: 1 }))
  mock.clock(on, { now: NOW })
  world(on, 'local_open', files)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { agentId: 'ag1', isAsync: true, status: 'async_launched' } }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  await $.session.start(START)
  const file = () => JSON.parse(files.get(`${DIR}/sessions/local_open.json`)!)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'c1', description: '跑整合測試', prompt: 'x', subagent_type: 'general-purpose', run_in_background: true } as never)
  expect(file().background).toEqual([{ id: 'ag1', label: '跑整合測試', at: NOW }])
  await $.prompt.submit({ text: '<task-notification>\n<task-id>ag1</task-id>\n<status>completed</status>\n<result>ok</result>\n</task-notification>', isMeta: true } as never)
  expect(file().background).toEqual([])
})

/** A git that knows which agent commits exist and which branches still hold them. */
function settlingGit(gone: Set<string>, holders: Record<string, string>) {
  return (argv: readonly string[]) => {
    if (argv[1] === 'rev-parse' && argv[2] === '--verify') return gone.has(String(argv[4]).replace('^{commit}', '')) ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: 'x' }
    if (argv[1] === 'rev-parse') return { exitCode: 0, stdout: 'true' }
    if (argv[1] === 'merge-base') return { exitCode: 1, stdout: '' }
    if (argv[1] === 'branch') return { exitCode: 0, stdout: holders[String(argv.at(-1))] ?? '' }
    return null
  }
}
const failedNotice = (id: string, result: string) => notice(id, result).replace('<status>completed</status>', '<status>failed</status>')

/** Five agents the PM let go or settled in different ways, from the fake Acme shop's back office. */
async function settleAgents($: Parameters<TestBody>[0], on: On, lang: 'zh' | 'en') {
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  const gone = new Set(['2222222'])
  const holders: Record<string, string> = { '1111111': '  worktree-agent-a1' }
  agentWorld(on, files, settlingGit(gone, holders))
  await $.session.start(START)
  const agents = () => JSON.parse(files.get(`${DIR}/sessions/local_pm.json`)!).agents as { id: string; state: string }[]
  const stateOf = (id: string) => agents().find(a => a.id === id)?.state
  const ledger = async (input: object) => String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown }).result)
  const call = (n: number, description: string, type = 'general-purpose') =>
    $.tool.call({ tool: 'Agent', tool_use_id: `call-${n}`, description, prompt: 'x', subagent_type: type } as never)
  await call(1, 'T-21 Bulk edit on the list')
  await call(2, 'T-22 Keep the filter on reload')
  await call(3, 'T-23 Check old date format', 'Explore')
  await call(4, 'T-24 Speed up the export', 'Explore')
  await call(5, 'T-25 Retry failed uploads', 'Explore')
  for (const n of [3, 4, 5]) await ledger({ action: 'add', text: `item ${n}`, owner: `agent:a${n}` })
  // Closed while its agent still ran: what the agent says when it ends counts.
  await ledger({ action: 'update', id: 3, status: 'dropped' })
  await clock.advance(1000)
  await $.prompt.submit({ text: notice('a1', '[done, 1111111] Bulk edit', worktreeOf('a1')), isMeta: true } as never)
  await $.prompt.submit({ text: notice('a2', '[done, 2222222] Filter kept', worktreeOf('a2')), isMeta: true } as never)
  await $.prompt.submit({ text: notice('a3', '[waiting_user] 312 rows use day-first dates: convert them?'), isMeta: true } as never)
  await $.prompt.submit({ text: failedNotice('a4', 'stopped'), isMeta: true } as never)
  await $.prompt.submit({ text: failedNotice('a5', 'stopped'), isMeta: true } as never)
  expect(agents().map(a => a.state)).toEqual(['verify', 'verify', 'decide', 'failed', 'failed'])

  // The person's word, after they ended: one item dropped, one done (forced, with a note).
  await clock.advance(1000)
  await ledger({ action: 'update', id: 1, status: 'dropped' })
  await ledger({ action: 'update', id: 2, status: 'done', force: true, note: 'done by hand' })
  await clock.advance(31_000)
  // A commit still on a branch waits; one git no longer has is let go; so are the closed items' agents.
  expect([stateOf('a1'), stateOf('a2'), stateOf('a3'), stateOf('a4'), stateOf('a5')]).toEqual(['verify', 'dropped', 'dropped', 'done', 'failed'])
  // Its worktree and branch deleted unmerged: no branch holds the commit any more.
  delete holders['1111111']
  await clock.advance(31_000)
  expect(stateOf('a1')).toBe('dropped')

  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  const fresh = await board()
  const attention = fresh.split('## Agents')[0]!
  expect(attention).not.toMatch(/T-21|T-22|T-23|T-24/)
  expect(attention).toMatch(/T-25/)
  expect(fresh).toMatch(lang === 'en' ? /- ◆ \[Dropped\] T-21 Bulk edit on the list \(a1\)/ : /- ◆ \[已捨棄\] T-21 Bulk edit on the list（a1）/)
  // An hour on, the settled ones fold away like the done ones; the failed one stays.
  await clock.advance(61 * 60_000)
  const later = await board()
  expect(later).not.toMatch(/T-21|T-22|T-23|T-24/)
  expect(later).toMatch(/T-25/)
  expect(later).toContain(lang === 'en' ? '4 more agents done or dropped and not listed' : '另有 4 個已完成或已捨棄的 Agent 未列出')
}

test("an agent's card settles with its work items, and a commit no branch holds is let go", { ...ZH, timeoutMs: 20_000 }, async ($, on) => {
  await settleAgents($, on, 'zh')
})

test("an agent's card settles with its work items, in English", { options: { language: 'en' }, timeoutMs: 20_000 }, async ($, on) => {
  await settleAgents($, on, 'en')
})

test("the person's closing settles an ended agent only when it came after the end", () => {
  const one = { id: 'a9', description: 'T-09 x', item: 9, type: 'general-purpose', isolated: true, state: 'verify', startedAt: 100, endedAt: 200 } as const
  const item = (status: string, updatedAt: number, owner = 'agent:a9') => ({ id: 1, text: 'x', owner, status, createdAt: 50, updatedAt }) as never
  expect(settledAgentState(one, [item('dropped', 300)])).toBe('dropped')
  expect(settledAgentState(one, [item('dropped', 300), item('done', 250)])).toBe('done')
  expect(settledAgentState(one, [item('dropped', 300), item('open', 250)])).toBe(null)
  expect(settledAgentState(one, [item('dropped', 150)])).toBe(null)
  expect(settledAgentState(one, [item('dropped', 300, 'agent:a8')])).toBe(null)
  expect(settledAgentState({ ...one, state: 'running', endedAt: undefined }, [item('dropped', 300)])).toBe(null)
  expect([isSettledAgent('done'), isSettledAgent('dropped'), isSettledAgent('verify'), isSettledAgent('failed')]).toEqual([true, true, false, false])
})

// ── QA: the verdict a work item needs before it closes (docs/design/qa.md) ──

/** What the QA tests read, in each language. */
const QA_WORDS = {
  zh: {
    row: 'T-01 (id 1) [open] 清單批次修改｜負責：local_open',
    awaiting: /- \[待 QA\] T-01「清單批次修改」：商品列表頁（[^）]+）已交付，還沒有驗收紀錄。派一個「T-01 QA」Agent 驗收/,
    itemAwaiting: /- T-01 \(id 1\) \[open\] 清單批次修改｜負責：商品列表頁（[^）]+）｜待 QA/,
    none: /^無法將 T-01 標記為完成：還沒有驗收紀錄。派一個獨立的驗收 Agent/,
    bad: /^qa 只能是 pass、fail 或 skip，這次沒有修改。/,
    needsBy: /^qa 為 pass 或 fail 時要填 qa_by/,
    needsNote: /^qa 為 skip 時要在 qa_note 寫理由/,
    byOwner: /^驗收者不能是負責人（local_open），這次沒有修改。派一個獨立的「T-01 QA」Agent 驗收。/,
    updated: /^已更新工作項目 T-01。\nT-01 \(id 1\) \[open\] 清單批次修改｜負責：local_open｜QA 不通過（agent:q1，於 3fa1c2e）$/,
    failed: /- \[QA 不通過\] T-01「清單批次修改」：沒有重現測試（agent:q1）/,
    refusedFail: /^無法將 T-01 標記為完成：驗收不通過（沒有重現測試）。交回負責人修正/,
    closed: /^已更新工作項目 T-01。\nT-01 \(id 1\) \[done\] 清單批次修改｜負責：local_open｜QA 通過（agent:q2，於 3fa1c2e）｜驗收條件：批次改價後列表即時更新$/,
    skipped: /\[done\] 文件錯字｜負責：未指派｜QA 略過：只改文件/,
    paneAwaiting: '1 項待 QA',
    paneFailed: '1 項 QA 不通過',
    paneItemAwaiting: '待 QA',
    paneItemFailed: 'QA 不通過（agent:q1，於 3fa1c2e）',
  },
  en: {
    row: 'T-01 (id 1) [open] Batch edit | owner: local_open',
    awaiting: /- \[Awaiting QA\] T-01 "Batch edit": its owner 商品列表頁 \([^)]+\) has delivered and there is no QA record. Start a "T-01 QA" agent/,
    itemAwaiting: /- T-01 \(id 1\) \[open\] Batch edit \| owner: 商品列表頁 \([^)]+\) \| awaiting QA/,
    none: /^Cannot mark T-01 done: it has no QA record. Start an independent QA agent/,
    bad: /^qa is pass, fail or skip; nothing was changed\./,
    needsBy: /^qa pass or fail needs qa_by/,
    needsNote: /^qa skip needs its reason in qa_note/,
    byOwner: /^Whoever checks an item may not be its owner \(local_open\); nothing was changed\. Start an independent "T-01 QA" agent\./,
    updated: /^Updated work item T-01\.\nT-01 \(id 1\) \[open\] Batch edit \| owner: local_open \| QA failed \(agent:q1 at 3fa1c2e\)$/,
    failed: /- \[QA failed\] T-01 "Batch edit": 沒有重現測試 \(agent:q1\)/,
    refusedFail: /^Cannot mark T-01 done: it failed QA \(沒有重現測試\)\. Hand it back to its owner/,
    closed: /^Updated work item T-01\.\nT-01 \(id 1\) \[done\] Batch edit \| owner: local_open \| QA passed \(agent:q2 at 3fa1c2e\) \| criteria: 批次改價後列表即時更新$/,
    skipped: /\[done\] Typo in docs \| owner: unassigned \| QA skipped: 只改文件/,
    paneAwaiting: '1 awaiting QA',
    paneFailed: '1 failed QA',
    paneItemAwaiting: 'awaiting QA',
    paneItemFailed: 'QA failed (agent:q1 at 3fa1c2e)',
  },
} as const

async function qaGate($: Parameters<TestBody>[0], on: On, lang: 'zh' | 'en') {
  const w = QA_WORDS[lang]
  const files: Files = new Map()
  // Items written before QA: no criteria, no qa. The owner has released its work (as in the release test above).
  const old = (id: number, text: string, owner: string | null) => ({ id, text, owner, status: 'open', note: '', createdAt: NOW - 7_200_000, updatedAt: NOW - 7_200_000 })
  const ledgerItems = [old(1, lang === 'zh' ? '清單批次修改' : 'Batch edit', 'local_open'), old(2, lang === 'zh' ? '文件錯字' : 'Typo in docs', null), old(3, lang === 'zh' ? '舊報表' : 'Old report', null)]
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: ledgerItems, nextId: 4 }))
  const report = { status: 'done', summary: 'T-01 已隨 2.4.1 上線', delivery: 'released', commit: '3fa1c2e' }
  const plan = [{ content: '步驟 1', status: 'completed' }]
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { plan, report, reportAt: NOW - 600_000 - 1, lastAnswer: 'T-01 已隨 2.4.1 上線。' })))
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], argv => (argv[0] === 'git' && argv[1] === 'rev-parse' ? { exitCode: 0, stdout: '3fa1c2e' } : null))
  await $.session.start(START)
  await clock.advance(61_000)
  const ledger = async (input: object) => String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown }).result)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board', include_done: true } as never)) as { result?: unknown }).result)
  const saved = () => JSON.parse(files.get(PROJECT_FILE)!).ledger as Record<string, unknown>[]
  const pane = async () =>
    $.ui.mount({
      plugin: 'project-pm',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'project-pm',
      props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } },
    } as never)

  // Old data reads as before; its owner has delivered, so the board and the pane ask for QA.
  expect(await ledger({ action: 'list', id: 1 })).toBe(w.row)
  let text = await board()
  expect(text).toMatch(w.awaiting)
  expect(text).toMatch(w.itemAwaiting)
  let ui = await pane()
  expect(await ui.find({ type: 'Text', text: w.paneAwaiting })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: w.paneItemAwaiting })).toBeDefined()

  // No verdict: it does not close, and nothing is written.
  expect(await ledger({ action: 'update', id: 1, status: 'done' })).toMatch(w.none)
  expect(saved()[0]).toEqual(ledgerItems[0])
  // A verdict that cannot be recorded changes nothing, a status beside it included.
  expect(await ledger({ action: 'update', id: 1, qa: 'maybe', qa_by: 'agent:q1', status: 'done' })).toMatch(w.bad)
  expect(await ledger({ action: 'update', id: 1, qa: 'pass', status: 'done' })).toMatch(w.needsBy)
  expect(await ledger({ action: 'update', id: 2, qa: 'skip', status: 'done' })).toMatch(w.needsNote)
  expect(await ledger({ action: 'update', id: 2, qa: 'skip', qa_note: '   ', status: 'done' })).toMatch(w.needsNote)
  expect(await ledger({ action: 'update', id: 2, qa: 'skip' })).toMatch(w.needsNote)
  expect(await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'local_open', status: 'done' })).toMatch(w.byOwner)
  expect(saved()).toEqual(ledgerItems)
  // An update without QA writes the old item back without the new fields.
  await ledger({ action: 'update', id: 3, note: 'x' })
  expect(Object.keys(saved()[2]!).sort()).toEqual(Object.keys(ledgerItems[2]!).sort())

  // A failed verdict is kept and shown; the item stays open.
  expect(await ledger({ action: 'update', id: 1, qa: 'fail', qa_by: 'agent:q1', qa_note: '沒有重現測試' })).toMatch(w.updated)
  expect(saved()[0]!.qa).toEqual({ result: 'fail', by: 'agent:q1', at: NOW + 61_000, note: '沒有重現測試', commit: '3fa1c2e' })
  text = await board()
  expect(text).toMatch(w.failed)
  expect(text).not.toMatch(w.awaiting)
  await ui.unmount()
  ui = await pane()
  expect(await ui.find({ type: 'Text', text: w.paneFailed })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: w.paneItemFailed })).toBeDefined()
  expect(await ledger({ action: 'update', id: 1, status: 'done' })).toMatch(w.refusedFail)
  // Its checker made its owner: the verdict was for another owner, so it goes, and the item does not close.
  await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'agent:q1' })
  expect(await ledger({ action: 'update', id: 1, owner: 'agent:q1', status: 'done' })).toMatch(w.none)
  expect(saved()[0]!.owner).toBe('local_open')

  // Passed by someone else, criteria written, and closed in one call.
  expect(await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'agent:q2', criteria: '批次改價後列表即時更新', status: 'done' })).toMatch(w.closed)
  expect(saved()[0]).toMatchObject({ status: 'done', criteria: '批次改價後列表即時更新', qa: { result: 'pass', by: 'agent:q2' } })
  // Skipped for a reason: the PM's own word closes it.
  await ledger({ action: 'update', id: 2, qa: 'skip', qa_note: '只改文件', status: 'done' })
  expect(saved()[1]).toMatchObject({ status: 'done', qa: { result: 'skipped', by: 'local_pm', note: '只改文件' } })
  expect(await ledger({ action: 'list', id: 2 })).toMatch(w.skipped)
  // Force still closes without QA, and only with a note.
  expect(await ledger({ action: 'update', id: 3, status: 'done', force: true })).toMatch(lang === 'zh' ? /^無法將 T-03 標記為完成：還沒有驗收紀錄/ : /^Cannot mark T-03 done: it has no QA record/)
  await ledger({ action: 'update', id: 3, status: 'done', force: true, note: '使用者確認不需要驗收' })
  expect(saved()[2]).toMatchObject({ status: 'done' })
  expect(saved()[2]!.qa).toBe(undefined)
  // A new item takes its criteria.
  await ledger({ action: 'add', text: 'x', criteria: '  匯出含表頭  ' })
  expect(saved()[3]).toMatchObject({ criteria: '匯出含表頭' })
}

test('the ledger closes an item only once it passed QA, checked by someone not its owner', ZH, async ($, on) => {
  await qaGate($, on, 'zh')
})

test('the ledger closes an item only once it passed QA, in English', { options: { language: 'en' } }, async ($, on) => {
  await qaGate($, on, 'en')
})

test('QA is due once the owner has delivered: a session ended, to release or on CI; an agent done or to verify', () => {
  const delivered: Status[] = ['done', 'unreleased', 'ci']
  for (const status of ['running', 'asking', 'failed', 'open', 'unreleased', 'ci', 'waiting', 'done', 'stale'] as Status[]) expect(isDeliveredStatus(status)).toBe(delivered.includes(status))
  for (const state of ['running', 'done', 'verify', 'decide', 'failed', 'lost', 'dropped'] as const) expect(isDeliveredAgent(state)).toBe(state === 'done' || state === 'verify')
  const item = { id: 1, text: 'x', owner: 'local_a', status: 'open' as const, note: '', createdAt: NOW, updatedAt: NOW }
  expect([qaShown(item, false), qaShown(item, true), qaShown({ ...item, status: 'done' }, true)]).toEqual([null, 'awaiting', null])
  expect(qaShown({ ...item, qa: { result: 'fail', by: 'user', at: NOW, note: '' } }, false)).toBe('fail')
  // The gate on its own: a verdict by the owner, a failed one, or a skip without its reason never closes.
  const qa = (result: 'pass' | 'fail' | 'skipped', by = 'agent:q', note = 'n') => ({ result, by, at: NOW, note })
  expect([qaBlocker(qa('pass'), 'local_a', 'T-01'), qaBlocker(qa('skipped'), 'local_a', 'T-01'), qaBlocker(qa('pass'), null, 'T-01')]).toEqual([null, null, null])
  for (const blocked of [undefined, qa('fail'), qa('pass', 'local_a'), qa('skipped', 'agent:q', ' ')]) expect(qaBlocker(blocked, 'local_a', 'T-01')).not.toBe(null)
})

async function qaBriefs($: Parameters<TestBody>[0], on: On, lang: 'zh' | 'en') {
  const files: Files = new Map()
  mock.clock(on, { now: NOW })
  const w = agentWorld(on, files, argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'true' } : null))
  await $.session.start(START)
  const spawn = (id: string, description: string, subagentType: string) =>
    $.agent.spawn({ tool_use_id: id, prompt: 'x', description, subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  const words =
    lang === 'zh'
      ? { qa: '這是 T-12 的獨立驗收（QA）', checks: ['只包含這個工作項目的標的', '修正之前會失敗', 'git show', 'git log -p', '讀程式推斷', '看 exit code', 'CHANGELOG', 'secret', '實際畫面'], qaReply: '[pass] 或 [fail]', reply: '[狀態, commit]', file: '寫進這個檔案：', inReply: '你不能寫檔：完整說明', readOnly: '這是唯讀工作：不要修改任何檔案。' }
      : { qa: 'This is the independent QA of T-12.', checks: ['only what this work item is about', 'fails before the fix', 'git show', 'git log -p', 'inferred from reading the code', 'read the exit code', 'CHANGELOG', 'secret', 'on screen'], qaReply: '[pass] or [fail]', reply: '[status, commit]', file: 'to this file: ', inReply: 'You cannot write files: put the full account', readOnly: 'This work only reads: change no file.' }

  // A QA agent: the checklist, pass or fail for its first line, and the rest in its reply (it only reads).
  await spawn('c1', lang === 'zh' ? 'T-12 QA（第二次）' : 'T-12 QA (second)', 'Explore')
  const qa = w.spawned[0]!.prompt
  expect(qa).toContain(words.qa)
  for (const check of words.checks) expect(qa).toContain(check)
  // A QA agent only reads: nothing it is asked to do may write, not even outside the project's folder.
  expect(qa).not.toContain('git archive')
  expect([qa.includes(words.qaReply), qa.includes(words.inReply), qa.includes(words.readOnly)]).toEqual([true, true, true])
  expect([qa.includes(words.reply), qa.includes(words.file)]).toEqual([false, false])
  // Another agent that only reads: the usual first line, its account in its reply, no checklist.
  await spawn('c2', 'T-13 Lookup of old dates', 'Explore')
  const lookup = w.spawned[1]!.prompt
  expect([lookup.includes(words.reply), lookup.includes(words.inReply), lookup.includes(words.qa), lookup.includes(words.file)]).toEqual([true, true, false, false])
  // One that writes: the detail file, as before, and no checklist.
  await spawn('c3', 'T-14 Fix', 'general-purpose')
  const writer = w.spawned[2]!.prompt
  expect([writer.includes(words.reply), writer.includes(words.file), writer.includes(words.inReply), writer.includes(words.qa)]).toEqual([true, true, false, false])

  // The QA agent's verdict and account: its first line for the PM, the rest kept in a file.
  await $.tool.call({ tool: 'Agent', tool_use_id: 'c1', description: 'T-12 QA', prompt: 'x', subagent_type: 'Explore' } as never)
  await $.prompt.submit({ text: notice('a1', '[fail] no repro test\n1. diff ok\n2. missing', ''), isMeta: true } as never)
  const one = JSON.parse(files.get(`${DIR}/sessions/local_pm.json`)!).agents[0]
  expect(one).toMatchObject({ id: 'a1', state: 'done', result: '[fail] no repro test', detail: `${DIR}/reports/agents/a1.md` })
  expect(files.get(`${DIR}/reports/agents/a1.md`)).toBe('[fail] no repro test\n1. diff ok\n2. missing\n')
}

test('a QA agent gets the checklist; an agent that only reads keeps its account in its reply', ZH, async ($, on) => {
  await qaBriefs($, on, 'zh')
})

test('a QA agent gets the checklist, in English', { options: { language: 'en' } }, async ($, on) => {
  await qaBriefs($, on, 'en')
})

test('a QA description leads with the item and QA', () => {
  expect(['T-12 QA', ' t-3 qa of export', 'T-12 QA: diff abc', 'T-31 QA（第二次）', 'T-31 QA(2nd)', 'T-31 QA (2nd)', 'T-31 QA-2', 'T-31 QA、複驗'].map(isQaDescription)).toEqual([true, true, true, true, true, true, true, true])
  expect(['T-12 QAX', 'T-12 QAfix', 'QA T-12', 'T-12 fix QA', 'T-12'].map(isQaDescription)).toEqual([false, false, false, false, false])
})

test('the QA core decides on plain data, with no engine: an update, a close and the attention lines, in both languages', () => {
  const was = getLang()
  try {
    for (const lang of ['zh-TW', 'en'] as const) {
      setLang(lang)
      const item = { id: 7, text: 'Export', owner: 'local_dev', status: 'open' as const, note: '', createdAt: NOW, updatedAt: NOW }
      // Recording only: the verdict it keeps; a bad one is refused; closing without one is refused.
      expect(qaUpdate(item, { qa: 'fail', qa_by: 'agent:q', qa_note: 'no test' }, 'local_dev', 'pm', NOW, false, 'abc1234')).toEqual({ qa: { result: 'fail', by: 'agent:q', at: NOW, note: 'no test', commit: 'abc1234' }, isRecorded: true, refusal: null })
      expect(qaUpdate(item, {}, 'local_dev', 'pm', NOW, false)).toEqual({ qa: undefined, isRecorded: false, refusal: null })
      expect('error' in qaUpdate(item, { qa: 'pass', qa_by: 'LOCAL_DEV ' }, 'local_dev', 'pm', NOW, false)).toBe(true)
      const unchecked = qaUpdate(item, {}, 'local_dev', 'pm', NOW, true)
      expect('refusal' in unchecked && unchecked.refusal !== null).toBe(true)
      // A failed verdict recorded with a close: kept, and the close refused.
      const failedClose = qaUpdate(item, { qa: 'fail', qa_by: 'agent:q' }, 'local_dev', 'pm', NOW, true)
      expect('qa' in failedClose && failedClose.isRecorded && failedClose.qa?.result === 'fail' && failedClose.refusal !== null).toBe(true)
      // Closing: a pass by someone else goes through; the verdict it had counts too, unless its checker is now the owner.
      const passed = { ...item, qa: { result: 'pass' as const, by: 'agent:q', at: NOW, note: '' } }
      expect(qaUpdate(passed, {}, 'local_dev', 'pm', NOW, true)).toEqual({ qa: passed.qa, isRecorded: false, refusal: null })
      expect(qaUpdate(passed, {}, ' LOCAL_DEV', 'pm', NOW, true)).toEqual({ qa: passed.qa, isRecorded: false, refusal: null })
      // Another owner, or a reopen: the verdict goes.
      expect(qaUpdate(passed, {}, 'local_other', 'pm', NOW, false)).toEqual({ qa: undefined, isRecorded: false, refusal: null })
      expect(qaUpdate({ ...passed, status: 'done' }, { status: 'open' }, 'local_dev', 'pm', NOW, false)).toEqual({ qa: undefined, isRecorded: false, refusal: null })
      // A skip is the caller's own word.
      expect(qaUpdate(item, { qa: 'skip', qa_note: 'docs' }, 'local_dev', 'pm', NOW, true)).toEqual({ qa: { result: 'skipped', by: 'pm', at: NOW, note: 'docs' }, isRecorded: true, refusal: null })
      // Attention: awaiting once the host says the owner delivered, failed whatever it says; closed items never.
      const failed = { ...item, id: 8, qa: { result: 'fail' as const, by: 'agent:q', at: NOW, note: 'no test' } }
      const lines = qaAttention([item, failed, { ...item, id: 9, status: 'done' as const }], owner => owner === 'local_dev', owner => `<${owner}>`)
      expect(lines.length).toBe(2)
      expect(lines[0]).toContain('T-07')
      expect(lines[0]).toContain('<local_dev>')
      expect(lines[1]).toContain('T-08')
      expect(lines[1]).toContain('no test')
      expect(qaAttention([item], () => false, String)).toEqual([])
    }
  } finally {
    setLang(was)
  }
})

// ── The T-31 QA review's findings B, C, D, F, G: each reproduced first, in both languages ──

const FINDING_WORDS = {
  zh: {
    byOwner: /^驗收者不能是負責人（[^）]+），這次沒有修改。/,
    byOwnerClose: /^無法將 T-04 標記為完成：驗收者 Local_Open 就是負責人。/,
    none: /^無法將 T-01 標記為完成：還沒有驗收紀錄。/,
    kept: /^QA 已記錄，但結案被擋：無法將 T-06 標記為完成：驗收不通過（缺測試）。/,
    itemFailed: /- T-06 \(id 6\) \[open\] 匯出欄位｜負責：商品列表頁（[^）]+）｜QA 不通過（agent:q3，於 3fa1c2e）/,
    gone: /- \[待 QA\] T-03「舊報表」：local_gone（已不在清單中）已交付，還沒有驗收紀錄。/,
    paneAwaiting: '3 項待 QA',
  },
  en: {
    byOwner: /^Whoever checks an item may not be its owner \([^)]+\); nothing was changed\./,
    byOwnerClose: /^Cannot mark T-04 done: it was checked by Local_Open, its owner\./,
    none: /^Cannot mark T-01 done: it has no QA record\./,
    kept: /^QA recorded, but closing was refused: Cannot mark T-06 done: it failed QA \(缺測試\)\./,
    itemFailed: /- T-06 \(id 6\) \[open\] 匯出欄位 \| owner: 商品列表頁 \([^)]+\) \| QA failed \(agent:q3 at 3fa1c2e\)/,
    gone: /- \[Awaiting QA\] T-03 "舊報表": its owner local_gone \(no longer listed\) has delivered and there is no QA record\./,
    paneAwaiting: '3 awaiting QA',
  },
} as const

async function qaFindings($: Parameters<TestBody>[0], on: On, lang: 'zh' | 'en') {
  const w = FINDING_WORDS[lang]
  const files: Files = new Map()
  const at = NOW - 7_200_000
  const item = (id: number, text: string, owner: string | null, extra: object = {}) => ({ id, text, owner, status: 'open', note: '', createdAt: at, updatedAt: at, ...extra })
  const items = [
    item(1, '商品匯入', 'local_open'),
    item(2, '已結案的頁面', 'local_open', { status: 'done', qa: { result: 'pass', by: 'agent:q1', at, note: '' } }),
    item(3, '舊報表', 'local_gone'),
    item(4, '舊紀錄', 'local_open', { qa: { result: 'pass', by: 'Local_Open ', at, note: '' } }),
    item(5, '文件', null, { criteria: '保留這條' }),
    item(6, '匯出欄位', 'local_open'),
  ]
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: items, nextId: 7 }))
  const report = { status: 'done', summary: 'T-01 已隨 2.4.1 上線', delivery: 'released', commit: '3fa1c2e' }
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { plan: [{ content: '步驟 1', status: 'completed' }], report, reportAt: NOW - 600_000 - 1, lastAnswer: 'T-01 已隨 2.4.1 上線。' })))
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_pm', files, [], argv => (argv[0] === 'git' && argv[1] === 'rev-parse' ? { exitCode: 0, stdout: '3fa1c2e9b0d4c6a8e2f1b3d5c7a9e0f2b4d6c8a1' } : null))
  await $.session.start(START)
  await clock.advance(61_000)
  const ledger = async (input: object) => String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown }).result)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  const saved = (id: number) => (JSON.parse(files.get(PROJECT_FILE)!).ledger as Record<string, unknown>[]).find(i => i.id === id)!

  // F: an owner no longer listed (archived, or gone) has nothing left to do: its open items await QA, on the board and the pane.
  expect(await board()).toMatch(w.gone)
  const ui = await $.ui.mount({
    plugin: 'project-pm',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'project-pm',
    props: { title: 'PM', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 80 } },
  } as never)
  expect(await ui.find({ type: 'Text', text: w.paneAwaiting })).toBeDefined()
  await ui.unmount()

  // B: the owner checking its own work is caught whatever its case or spaces, on either side.
  expect(await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'LOCAL_OPEN' })).toMatch(w.byOwner)
  expect(await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: ' local_open ' })).toMatch(w.byOwner)
  await ledger({ action: 'update', id: 1, owner: ' agent:a1 ' })
  expect(await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'agent:A1' })).toMatch(w.byOwner)
  expect(saved(1).owner).toBe('agent:a1')
  expect(saved(1).qa).toBe(undefined)
  // …and a verdict already kept by the owner under another spelling does not close the item.
  expect(await ledger({ action: 'update', id: 4, status: 'done' })).toMatch(w.byOwnerClose)

  // C: a verdict is for the owner it checked, and records the project's HEAD it checked.
  await ledger({ action: 'update', id: 1, owner: 'local_open' })
  await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'agent:q1' })
  expect(saved(1).qa).toEqual({ result: 'pass', by: 'agent:q1', at: NOW + 61_000, note: '', commit: '3fa1c2e' })
  await ledger({ action: 'update', id: 1, owner: 'LOCAL_OPEN' })
  expect(saved(1).qa).toMatchObject({ result: 'pass' })
  await ledger({ action: 'update', id: 1, owner: 'local_ask' })
  expect(saved(1).qa).toBe(undefined)
  expect(await ledger({ action: 'update', id: 1, status: 'done' })).toMatch(w.none)
  // Reopened after it closed: its verdict goes too.
  await ledger({ action: 'update', id: 2, status: 'open' })
  expect(saved(2)).toMatchObject({ status: 'open' })
  expect(saved(2).qa).toBe(undefined)

  // D: a verdict recorded beside a refused close is kept; the answer says so and why it did not close.
  expect(await ledger({ action: 'update', id: 6, qa: 'fail', qa_by: 'agent:q3', qa_note: '缺測試', status: 'done' })).toMatch(w.kept)
  expect(saved(6)).toMatchObject({ status: 'open', qa: { result: 'fail', by: 'agent:q3', note: '缺測試', commit: '3fa1c2e' } })
  expect(await board()).toMatch(w.itemFailed)

  // G: criteria that are not text leave the criteria as they were; an empty string clears them.
  await ledger({ action: 'update', id: 5, criteria: 5 })
  await ledger({ action: 'update', id: 5, criteria: null })
  expect(saved(5).criteria).toBe('保留這條')
  await ledger({ action: 'update', id: 5, criteria: '' })
  expect(saved(5).criteria).toBe(undefined)
}

test('QA review findings: owner spelling, a new owner or a reopen voids the verdict, a refused close keeps it, a gone owner awaits QA', ZH, async ($, on) => {
  await qaFindings($, on, 'zh')
})

test('QA review findings, in English', { options: { language: 'en' } }, async ($, on) => {
  await qaFindings($, on, 'en')
})

// ── Owner ids written with spaces or another case: every check finds the owner (QA review, follow-up 1) ──

async function ownerSpelling($: Parameters<TestBody>[0], on: On) {
  const files: Files = new Map()
  mock.clock(on, { now: NOW })
  agentWorld(on, files, argv => (argv[1] === 'rev-parse' ? { exitCode: 0, stdout: 'true' } : null))
  // Old items, their owners written before ids were trimmed: a running agent, and a session waiting on CI.
  const at = NOW - 3_600_000
  const items = [
    { id: 1, text: 'Export', owner: ' agent:a1 ', status: 'open', note: '', createdAt: at, updatedAt: at },
    { id: 2, text: 'Import', owner: 'LOCAL_OPEN', status: 'open', note: '', createdAt: at, updatedAt: at },
  ]
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: items, nextId: 3 }))
  files.set(`${DIR}/sessions/local_open.json`, JSON.stringify(track('local_open', { recap: 'Pushed to main; CI is still running. 已推上 main，CI 還在跑。' })))
  await $.session.start(START)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'c1', description: 'T-01 Export', prompt: 'x', subagent_type: 'general-purpose' } as never)
  const ledger = async (input: object) => String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown }).result)
  const saved = (id: number) => (JSON.parse(files.get(PROJECT_FILE)!).ledger as Record<string, unknown>[]).find(i => i.id === id)!

  // The running agent has not delivered: its item does not await QA. The session waiting on CI has (QA is due before
  // the release), and it is named, not taken for a session gone from the list.
  const board = String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  expect(board).not.toMatch(/\[(待 QA|Awaiting QA)\] T-01/)
  expect(board).toMatch(/\[(待 QA|Awaiting QA)\] T-02\D.*商品列表頁/)
  expect(board).not.toMatch(/LOCAL_OPEN/)
  // A pass does not close either: the owner gate finds the running agent and the session waiting on CI.
  await ledger({ action: 'update', id: 1, qa: 'pass', qa_by: 'agent:q1', status: 'done' })
  await ledger({ action: 'update', id: 2, qa: 'pass', qa_by: 'agent:q1', status: 'done' })
  expect([saved(1).status, saved(2).status]).toEqual(['open', 'open'])
  // New owners are written trimmed.
  await ledger({ action: 'add', text: 'x', owner: ' local_open ' })
  await ledger({ action: 'update', id: 2, owner: '  agent:a1 ' })
  expect([saved(3).owner, saved(2).owner]).toEqual(['local_open', 'agent:a1'])
}

test('an owner written with spaces or in another case is still found by every check', ZH, async ($, on) => {
  await ownerSpelling($, on)
})

test('an owner written with spaces or in another case is still found, in English', { options: { language: 'en' } }, async ($, on) => {
  await ownerSpelling($, on)
})

// ── A verdict recorded with a change of owner: neither the old owner nor the new one may be its checker (follow-up 2) ──

async function verdictWithNewOwner($: Parameters<TestBody>[0], on: On, lang: 'zh' | 'en') {
  const files: Files = new Map()
  const at = NOW - 3_600_000
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [{ id: 1, text: 'Export', owner: 'local_open', status: 'open', note: '', createdAt: at, updatedAt: at }], nextId: 2 }))
  mock.clock(on, { now: NOW })
  world(on, 'local_pm', files)
  await $.session.start(START)
  const ledger = async (input: object) => String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', ...input } as never)) as { result?: unknown }).result)
  const saved = () => JSON.parse(files.get(PROJECT_FILE)!).ledger[0] as Record<string, unknown>
  const refused = lang === 'zh' ? /^驗收者不能是負責人（local_open），這次沒有修改。/ : /^Whoever checks an item may not be its owner \(local_open\); nothing was changed\./

  // The old owner hands the item on and passes its own work in the same update: refused, nothing changes.
  expect(await ledger({ action: 'update', id: 1, owner: 'local_ask', qa: 'pass', qa_by: 'LOCAL_OPEN ' })).toMatch(refused)
  expect(saved()).toMatchObject({ owner: 'local_open' })
  expect(saved().qa).toBe(undefined)
  // The new owner may not either; someone else may.
  expect(await ledger({ action: 'update', id: 1, owner: 'local_ask', qa: 'pass', qa_by: 'local_ask' })).toMatch(lang === 'zh' ? /^驗收者不能是負責人（local_ask）/ : /^Whoever checks an item may not be its owner \(local_ask\)/)
  await ledger({ action: 'update', id: 1, owner: 'local_ask', qa: 'pass', qa_by: 'agent:q1' })
  expect(saved()).toMatchObject({ owner: 'local_ask', qa: { result: 'pass', by: 'agent:q1' } })
}

test('a verdict recorded with a change of owner is checked against both owners', ZH, async ($, on) => {
  await verdictWithNewOwner($, on, 'zh')
})

test('a verdict recorded with a change of owner is checked against both owners, in English', { options: { language: 'en' } }, async ($, on) => {
  await verdictWithNewOwner($, on, 'en')
})
