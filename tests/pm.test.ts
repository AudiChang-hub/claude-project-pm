import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { applyPlan, caveatOf, ciTarget, keyFile, projectKey, statusOf } from '../hooks/sessions'

const NOW = Date.parse('2026-10-17T12:00:00.000Z')
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
  on('tool.register', ($, e) => {
    tools.push(e.name)

    return { value: { tool: `mcp__project-pm__${e.name}` } }
  })
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

test('a session keeps its own task list and recap on disk', async ($, on) => {
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

test('the PM board puts what is left first, and the ledger tracks what was asked', async ($, on) => {
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

test('the pane shows the project, and archives after a confirm', async ($, on) => {
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

  expect(said('已推上 main（4dca77c），CI 還在跑，通過後才會打標籤和部署。')).toBe('ci')
  expect(said('已回覆對方。', '1.86.11 已推上 main，等 CI 通過後我會部署。')).toBe('ci')
  expect(said('Pushed to main; waiting for CI before tagging.')).toBe('ci')
  expect(said('CI 已通過，已打標籤並部署 2.3.1。')).toBe('done')
  expect(said('CI 跑完了，已部署 2.3.1。')).toBe('done')
  expect(said('先前 CI 還在跑，現在 CI 已通過並完成部署。')).toBe('done')
  expect(said('已修好返回鍵。')).toBe('done')
})

test('the ledger will not close an item while its session waits on CI', async ($, on) => {
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

test('a session the app did not know at its start is tracked once it is known', async ($, on) => {
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

test('an empty track does not hide a transcript that says CI is still running', async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '合併重複的日期欄位', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
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

test('a recap stands only for the turn that wrote it', async ($, on) => {
  const files: Files = new Map()
  const clock = mock.clock(on, { now: NOW })
  world(on, 'local_me', files)
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(START)
  const turn = (answer: string) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: '1.86.11 已推上 main，CI 還在跑，通過後才會打標籤和部署。' } as never)
  await turn('已推上 main，我在背景等 CI。')
  expect(JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!).recap).toMatch(/CI 還在跑/)

  // Woken later by a notification, the session answers without a wrap_up of its own (and no prompt.submit).
  await clock.advance(30 * 60000)
  await turn('已打標籤 v1.86.11 並部署到正式站。')
  const kept = JSON.parse(files.get(`${DIR}/sessions/local_me.json`)!)
  expect(kept.recap).toBe(null)
  const idle = { id: 'local_me', title: '我', cwd: PROJECT, isRunning: false, lastActivityAt: new Date(NOW + 30 * 60000).toISOString(), isPinned: false, hasOpenPr: false }
  expect(statusOf(idle, kept, undefined, NOW + 31 * 60000)).toBe('done')
})

test('a track that missed later turns gives way to the transcript', async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '訂單總覽頁面', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  // Written when it pushed; the turns that saw CI pass and deployed never reached the file. The app saw them (11:50).
  const pushedAt = Date.parse('2026-10-17T11:31:00.000Z')
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(
      track('local_open', {
        plan: [{ content: '等 CI 通過後打標籤', status: 'completed' }],
        recap: '1.86.11 已推上 main（4dca77c）。CI 還在跑，通過後才會打標籤和部署；目前還沒部署。',
        lastAnswer: '還沒完成：CI 還在跑，大約 25 分鐘，我在背景等結果。',
        turnAt: pushedAt,
        planAt: pushedAt,
      }),
    ),
  )
  const clock = mock.clock(on, { now: NOW })
  const transcript = '[assistant] 「訂單總覽」已經上線，正式站現在是 1.86.11。\n[assistant] (called mcp__ccd_turn__wrap_up)\n[assistant] 已部署 1.86.11，正式站驗證通過。\n[result] done (success), 14 turns'
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
  expect(board).toMatch(/最後回報：已部署 1.86.11，正式站驗證通過。/)

  const closed = String(((await $.tool.call({ tool: 'mcp__project-pm__ledger', action: 'update', id: 1, status: 'done' } as never)) as { result?: unknown }).result)
  expect(closed).toMatch(/已更新工作項目 T-01/)
})

test('GitHub decides whether CI the words left running is still running', async ($, on) => {
  const files: Files = new Map()
  const item = { id: 1, text: '訂單總覽頁面', owner: 'local_open', status: 'open', note: '', createdAt: NOW, updatedAt: NOW }
  files.set(PROJECT_FILE, JSON.stringify({ key: projectKey(PROJECT), name: 'Acme 商店後台', path: PROJECT, pmId: 'local_pm', isDismissed: false, ledger: [item], nextId: 2 }))
  const at = Date.parse('2026-10-17T11:50:00.000Z')
  files.set(
    `${DIR}/sessions/local_open.json`,
    JSON.stringify(track('local_open', { lastAnswer: '已推上 main（`4dca77c`），CI 還在跑，通過後才會打標籤和部署。', turnAt: at, planAt: at })),
  )
  const FULL = '4dca77ca10fda0b742c442bc2623c01c470259d3'
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
  expect(asked).toContain(`gh run list --commit ${FULL} --limit 20 --json status,conclusion @ ${PROJECT}`)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」CI 尚未跑完/)

  // GitHub can't be asked: the words alone decide, as before.
  runs = null
  await clock.advance(61_000)
  expect(await board()).toMatch(/\[等待 CI・未完成\] 「商品列表頁」/)

  // Failed: something to handle, not something to wait on.
  runs = [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }]
  await clock.advance(61_000)
  const failed = await board()
  expect(failed).toMatch(/\[CI 失敗・需處理\] 「商品列表頁」\(local_open\) GitHub 上的 CI（commit 4dca77c）失敗/)
  expect(failed).not.toMatch(/等待 CI・未完成\] 「商品列表頁」/)
  expect(await close()).toMatch(/無法將 T-01 標記為完成：負責的 Session「商品列表頁」GitHub 上的 CI 失敗/)

  // Re-run and passed: done, and not asked again after that.
  runs = [{ status: 'completed', conclusion: 'success' }]
  await clock.advance(5 * 60_000 + 1000)
  const passed = await board()
  expect(passed).not.toMatch(/「商品列表頁」\(local_open\) (最後回報 CI|GitHub)/)
  expect(passed).toMatch(/### \[已結束\] 商品列表頁/)
  const before = asked.length
  await clock.advance(10 * 60_000)
  await board()
  expect(asked.length).toBe(before)
  expect(await close()).toMatch(/已更新工作項目 T-01/)
})

test('a recap that says nothing is left is not a caveat', () => {
  const recap = (text: string) => caveatOf(track('x', { recap: text }) as never)
  expect(recap('之後版號和發布接力都由 PM 管，我這邊沒有任何未提交的修改。')).toBe(null)
  expect(recap('交接完成，沒有未推送的 commit。')).toBe(null)
  expect(recap('欄位已移除，還沒部署。')).not.toBe(null)
  expect(recap('改好了，但沒有提交。')).not.toBe(null)
})

test('the CI a session names: a run id, else a commit', () => {
  expect(ciTarget('CI 還在跑：https://github.com/o/r/actions/runs/39031560867')).toEqual({ run: '39031560867' })
  expect(ciTarget('1.86.11 已推上 main（`4dca77c`），CI 還在跑，1918 項全過')).toEqual({ sha: '4dca77c' })
  expect(ciTarget('1.86.11 已推上 main，CI 還在跑')).toBe(null)
})

test('an owner working from another project is not lost; only one gone from the list is', async ($, on) => {
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

test('after /reload-plugins the PM gets its tools back on its next turn', async ($, on) => {
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
