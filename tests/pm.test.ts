import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { applyPlan, betterCi, caveatOf, ciTarget, ciTargets, ciVerdict, isCiPending, isPushedContent, keyFile, parseLastWord, projectKey, statusOf, undeliveredOf } from '../hooks/sessions'
import { MESSAGES, getLang, placeholders, resolveLang, setLang, t } from '../hooks/messages'
import type { Lang, MessageKey } from '../hooks/messages'

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

/** The test host spells paths its own way: compare them by what follows the data folder. */
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^.*\/\.claude\/project-pm/, DIR)

/** What a host command answers: null for a command that is not there (no gh, no repository). */
type Host = (argv: readonly string[], cwd: string | undefined) => { exitCode: number; stdout: string } | null

/** The desktop app, the disk and the host's commands, from memory: `self` is this session's id. */
function world(on: On, self: string, files: Files, archived: string[] = [], host: Host = () => null, tools: string[] = []) {
  let list = [...SESSIONS]
  on('process.run', ($, e) => {
    const out = host(e.argv, e.init?.cwd)
    if (!out) throw new Error(`${e.argv[0]}: command not found`)

    return { value: { ...out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.env(on, { USERPROFILE: 'C:\\home' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: PROJECT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // `tools` holds what the engine has registered now: a test empties it where the engine drops them.
  on('tool.register', ($, e) => {
    tools.push(e.name)

    return { value: { tool: `mcp__project-pm__${e.name}` } }
  })
  on('tool.list', () => ({ value: tools.map(name => ({ name: `mcp__project-pm__${name}`, description: name, mcp: true })) }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.exists', ($, e) => ({ value: files.has(norm(e.path)) || [...files.keys()].some(k => k.startsWith(`${norm(e.path)}/`)) }))
  on('fs.read', ($, e) => {
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: text }
  })
  on('fs.write', ($, e) => {
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

  const refused = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done' } as never)) as { result?: unknown }).result)
  expect(refused).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」CI 尚未跑完/)
  expect(JSON.parse(files.get(PROJECT_FILE)!).ledger[0].status).toBe('open')

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

  const closed = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done' } as never)) as { result?: unknown }).result)
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
    String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done' } as never)) as { result?: unknown }).result)

  // Still running on GitHub: the old guard stands.
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)
  expect(asked).toContain(`gh run list --commit ${FULL} --limit 20 --json status,conclusion,workflowName @ ${PROJECT}`)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」CI 尚未跑完/)

  // GitHub can't be asked: the words alone decide, as before.
  runs = null
  await clock.advance(61_000)
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)

  // Failed: something to handle, not something to wait on.
  runs = [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }]
  await clock.advance(61_000)
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
  expect(recap('改好了，但沒有提交。')).not.toBe(null)
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
  expect(kinds('這次只改了清單，程式沒有動，也沒有 commit 或 push。等 PM 放行 2.4.2 後我再發布。')).toEqual(['commit', 'push', 'release'])
  expect(kinds('已推上 main（3fa1c2e），CI 通過，但還沒部署到正式站。')).toEqual(['release'])
  expect(kinds('2.4.2 還沒上線。')).toEqual(['release'])
  expect(kinds('Committed locally as 3fa1c2e; not pushed yet, waiting for your go-ahead.')).toEqual(['push', 'release'])
  // Committed here, pushed only once the PM confirms: not delivered either, and the commit is named for git to check.
  expect(undeliveredOf('commit 是 `9638755`，在本機 main，沒有 push，照 PM 的確認流程走。')).toEqual({ kinds: ['push'], sha: '9638755' })
  expect(undeliveredOf('commit 是 `532590d`，在本機 main，沒有 push。已回報 PM local_0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d。')?.sha).toBe('532590d')

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
    ['沒有改程式、但設定檔沒有 commit。', 'commit'],
  ]
  expect(own.filter(([text, want]) => kinds(text) !== want)).toEqual([])
})

test('work with no code to deliver is not left undelivered by a bare "no push"; work still to come is', () => {
  const kinds = (text: string) => (undeliveredOf(text)?.kinds ?? []).join(',') || 'none'
  // A real session's report on a data fix: nothing was ever going to be pushed.
  const dataFix = '已寫入並複查通過，沒有改程式，也沒有 push。'
  expect(kinds(dataFix)).toBe('none')
  const idle = { id: 'x', title: 't', cwd: '', isRunning: false, lastActivityAt: new Date(NOW - 5 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, track('x', { lastAnswer: dataFix }) as never, undefined, NOW)).toBe('done')

  const settled = [
    // No code, anywhere in the report.
    '這次是純資料修正。已寫入並複查通過。沒有 push。',
    '純資料修正，已寫入並複查。我也沒有 commit 或 push。',
    '沒有改程式，也沒有部署。',
    'No code changes. Also, we did not push.',
    // Not needed.
    '不需要 push，也不需要升版號。',
    '無需發布，資料已修正。',
    '沒有 push，因為不需要 push。',
    'No code changes, so nothing to commit or push.',
    'No need to push; the data fix is applied and verified.',
  ]
  expect(settled.filter(t => kinds(t) !== 'none')).toEqual([])

  const left: [string, string][] = [
    // Still to come, whatever else the report says.
    ['還沒 push。', 'push'],
    ['Not pushed yet.', 'push'],
    ['沒有改程式，但設定檔還沒 commit。', 'commit'],
    ['沒有改程式，但設定檔沒有 commit。', 'commit'],
    ['No code changes; the migration file is not committed.', 'commit'],
    ['No code changes, but the config is not committed yet.', 'commit'],
    ['沒有改程式。2.4.2 還沒上線。', 'release'],
    ['沒有改程式，也還沒 push。', 'push'],
    ['No code changes, and not pushed yet.', 'push'],
    ['不需要 commit，但還沒 push。', 'push'],
    // Waiting on a word before it goes out.
    ['沒有 push，等 PM 確認。', 'push'],
    ['沒有改程式，也沒有 push，等 PM 確認後再推。', 'push'],
    // A bare "no push" with nothing to say there was nothing to push: a commit kept here until the PM confirms.
    ['沒有 push。', 'push'],
    ['也沒有 push。', 'push'],
    ['沒有 push、也沒有打 tag。', 'push'],
    // Data named as a kind of work, or a folder: no statement that this work changed no code.
    ['這個看板只對只改資料的工作放行。commit 是 9638755，沒有 push。', 'push'],
    ['只改資料夾結構，沒有 push。', 'push'],
    ['放行的情況：回報裡宣告沒有改程式。commit 是 9638755，沒有 push。', 'push'],
  ]
  expect(left.filter(([text, want]) => kinds(text) !== want)).toEqual([])
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
    String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done', ...extra } as never)) as { result?: unknown }).result)
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

    return argv[0] === 'git' && argv[1] === 'branch' ? { exitCode: 0, stdout: remotes } : null
  })
  await $.session.start(START)
  const board = async () => String(((await $.tool.call({ tool: 'mcp__project-pm__board' } as never)) as { result?: unknown }).result)
  const close = async () =>
    String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done' } as never)) as { result?: unknown }).result)

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

/** A repository from memory: each commit's parent and files (path to blob), its local and remote branch tips. */
function fakeGit(commits: Record<string, { parent: string | null; files: Record<string, string> }>, heads: Record<string, string>, remotes: Record<string, string>) {
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
  const refused = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done' } as never)) as { result?: unknown }).result)
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
  const item = (id: number, status: string, owner: string | null) => ({ id, text: `Item ${id}`, owner, status, note: '', createdAt: NOW, updatedAt: NOW })
  files.set(
    PROJECT_FILE,
    JSON.stringify({ key: projectKey(PROJECT), name: 'Acme shop admin', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item(1, 'done', 'local_open'), item(2, 'open', 'local_ask'), item(3, 'open', null)], nextId: 4 }),
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

  const refused = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 2, status: 'done' } as never)) as { result?: unknown }).result)
  expect(refused).toMatch(/^Cannot mark T-02 done: The owning session "移除舊版優惠欄位" is waiting on CI \(last report: /)
  expect(refused).toMatch(/pass force: true/)

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
