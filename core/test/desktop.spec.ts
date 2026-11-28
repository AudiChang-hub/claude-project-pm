/**
 * The core in the desktop app (E2, docs/design/v1-core.md 2.4, 3.2, 3.7): the desktop session's own id (local_…) is the
 * core's actor id there, the board reads the desktop app's session list as the PM's mod last kept it (its round), and
 * the core's hooks stand aside where the mod keeps each session's record. Acme data in a temporary home only.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import { STATUS, boardText, keyFile, kpiOf, projectKey } from '../../hooks/sessions'
import type { Session, Track } from '../../types'
import { ROUND_FRESH_MS, projectSessions } from '../src/actors'
import { runHook } from '../src/hook'
import { actorFile } from '../src/host'
import { connectionActor } from '../src/identity'
import { McpSession } from '../src/mcp'
import type { ProjectRef } from '../src/project'
import { projectRefOf, resolveProject } from '../src/project'
import { changeActor, loadProject, paths } from '../src/store'
import { boardOf, ledgerTool, reportTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, NOW, hostWith, world } from './helpers'

const write = (file: string, data: unknown) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2))
}

const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

const track = (id: string, cwd: string, extra: Partial<Track>): Track => ({
  id,
  title: id,
  cwd,
  plan: [],
  recap: null,
  ask: null,
  lastPrompt: '',
  lastAnswer: '',
  turnAt: NOW - 10 * 60_000,
  planAt: NOW - 10 * 60_000,
  ...extra,
})

for (const lang of LANGS) {
  describe(`the core in the desktop app (${lang})`, () => {
    let w: World
    let ref: ProjectRef
    let legacy: string
    let list: Session[]
    const desktopEnv = (id: string) => ({ ...w.env, CLAUDE_CODE_HOST_SESSION_ID: id, CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' })

    beforeEach(async () => {
      w = world(lang, { legacy: true })
      ref = (await resolveProject(w.repo))!
      legacy = join(w.home, '.claude', 'project-pm')
      const session = (id: string, title: string, cwd: string, minutesAgo: number, isRunning = false): Session => ({ id, title, cwd, isRunning, lastActivityAt: at(minutesAgo), isPinned: false, hasOpenPr: false })
      list = [
        session('local_ask', 'Retire v1 coupon fields', w.repo, 12),
        session('local_run', 'Monthly payouts reconciliation', w.repo, 1, true),
        session('local_word', 'Fix the typo in order emails', join(w.repo, '.claude', 'worktrees', 'typo'), 20),
        session('local_other', 'Weather app', join(w.root, 'weather-app'), 5),
      ]
      // The PM's mod: its round (the desktop app's list, last words, CI, push) and each session's track.
      write(join(legacy, 'rounds', 'local_pm.json'), {
        sessions: { list, fetchedAt: NOW, error: null },
        lastWords: { local_word: { said: 'Fixed "recieve" in 3 templates. Ship it now or wait for the release?', isAsking: true, isWaiting: false, activity: at(20), error: null } },
        ciChecks: {},
        pushChecks: {},
      })
      write(join(legacy, 'sessions', 'local_ask.json'), track('local_ask', w.repo, { title: 'Retire v1 coupon fields', ask: 'Drop the coupon_v1 columns in this release, or keep them read-only until 0.9?' }))
      write(join(legacy, 'sessions', 'local_pm.json'), {
        ...track('local_pm', w.repo, { title: 'acme-shop · PM' }),
        agents: [{ id: 'a1b2c3', description: 'T-02 Add alt text to product images', item: 2, type: 'general-purpose', isolated: true, state: 'running', startedAt: NOW - 180_000 }],
      })
      write(join(legacy, 'projects', `${keyFile(projectKey(ref.path))}.json`), {
        key: ref.key,
        name: ref.name,
        path: ref.path,
        pmId: 'local_pm',
        isDismissed: false,
        nextId: 3,
        ledger: [
          { id: 1, text: 'Fix the typo in order emails', owner: 'local_word', status: 'open', note: '', createdAt: NOW - 3_600_000, updatedAt: NOW - 3_600_000 },
          { id: 2, text: 'Add alt text to product images', owner: 'agent:a1b2c3', status: 'open', note: '', createdAt: NOW - 3_600_000, updatedAt: NOW - 3_600_000 },
        ],
      })
    })
    afterEach(() => w.done())

    test('an MCP connection in the desktop app is its session (local_…), as the mod knows it; elsewhere as before', async () => {
      assert.equal(connectionActor('claude-code', desktopEnv('local_pm')), 'local_pm')
      assert.equal(connectionActor('claude-code', { CLAUDE_CODE_SESSION_ID: 'abc123-def' }), 'claude-code:abc123-def')
      // Not a desktop id: never taken.
      assert.equal(connectionActor('claude-code', { CLAUDE_CODE_HOST_SESSION_ID: '../evil', CLAUDE_CODE_SESSION_ID: 'abc123-def' }), 'claude-code:abc123-def')
      const session = new McpSession({ cwd: w.repo, env: desktopEnv('local_new'), run: hostWith(), now: () => NOW })
      await session.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } })
      await session.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pm', arguments: { action: 'claim' } } })
      assert.equal((await loadProject(ref, w.env)).pmId, 'local_new')
    })

    test('the board lists the desktop app\'s sessions from the PM\'s round, as the mod\'s board does', async () => {
      const { text, json } = await boardOf(w.ctx('local_pm'), ref, false)
      const byId = Object.fromEntries(json.actors.map(a => [a.id, a.status]))
      assert.deepEqual(byId, { local_ask: 'asking', local_run: 'running', local_word: 'asking' })
      // The same Sessions section the mod's own board writes from the same list.
      const found = await projectSessions(ref, ['local_word'], w.env, 'local_pm', NOW)
      const mods = boardText({ project: { name: ref.name, path: ref.path }, sessions: found.sessions, everyone: found.everyone, tracks: found.tracks, words: found.words, ledger: (await loadProject(ref, w.env)).ledger, agents: found.agents, now: NOW, isIncludingDone: false })
      const section = (board: string) => board.slice(board.indexOf('## Sessions'))
      assert.equal(section(text), section(mods))
      assert.ok(text.includes('Retire v1 coupon fields'))
      assert.ok(!text.includes('Weather app'))
      // The PM's agents, from its track.
      assert.deepEqual(json.agents.map(a => (a as { id: string }).id), ['a1b2c3'])
      // The pane's figures and looks, for the web board to draw alike (T-44): kpiOf over the same statuses, STATUS colors.
      assert.deepEqual(json.pane.kpi, kpiOf(json.actors.map(a => a.status), found.agents))
      assert.deepEqual(json.pane.kpi, { running: 2, runningAgents: 1, asking: 2, open: 0 })
      assert.equal(json.pane.words.kpiAsking, t('pane.kpiAsking'))
      for (const actor of json.actors) assert.equal(actor.look, STATUS[actor.status].color)
      assert.deepEqual(json.agentCards.map(c => [c.name, c.look, c.isRunning]), [['T-02 Add alt text to product images', STATUS.running.color, true]])
      const ask = json.actors.find(a => a.id === 'local_ask')!
      assert.equal(ask.summary, t('pane.question', { text: 'Drop the coupon_v1 columns in this release, or keep them read-only until 0.9?' }))
    })

    test('an ended QA agent folds away once its own work item is closed after it ended (T-49)', async () => {
      const file = join(legacy, 'sessions', 'local_pm.json')
      const qa = { id: 'q7', description: 'T-01 QA (7th)', item: 1, type: 'Explore', isolated: false, state: 'failed', result: '[fail] no repro test', startedAt: NOW - 7_200_000, endedAt: NOW - 7_000_000 }
      write(file, { ...track('local_pm', w.repo, { title: 'acme-shop · PM' }), agents: [qa] })
      const projectFile = join(legacy, 'projects', `${keyFile(projectKey(ref.path))}.json`)
      const project = (status: string, updatedAt: number) =>
        write(projectFile, { key: ref.key, name: ref.name, path: ref.path, pmId: 'local_pm', isDismissed: false, nextId: 2, ledger: [{ id: 1, text: 'Fix the typo in order emails', owner: 'local_word', status, note: '', createdAt: NOW - 9_000_000, updatedAt }] })
      const failed = t('board.attention.agentFailed', { name: 'T-01 QA (7th)', line: '[fail] no repro test' })
      const listed = async () => (await boardOf(w.ctx('local_pm'), ref, false)).text.includes(failed)
      project('open', NOW - 3_600_000)
      assert.equal(await listed(), true)
      // Closed before it ended: its own end says more.
      project('done', NOW - 8_000_000)
      assert.equal(await listed(), true)
      project('done', NOW - 3_600_000)
      assert.equal(await listed(), false)
      project('dropped', NOW - 3_600_000)
      assert.equal(await listed(), false)
    })

    test('a round older than the desktop app\'s refresh counts nobody as running', async () => {
      const file = join(legacy, 'rounds', 'local_pm.json')
      const old = new Date(Date.now() - ROUND_FRESH_MS - 60_000)
      utimesSync(file, old, old)
      const { json } = await boardOf(w.ctx('local_pm', { now: () => Date.now() }), ref, false)
      assert.notEqual(json.actors.find(a => a.id === 'local_run')?.status, 'running')
    })

    test('a close waits on a desktop owner the round says is asking the person', async () => {
      const out = await ledgerTool(w.ctx('local_pm'), { action: 'update', id: 1, status: 'done', qa: 'skip', qa_note: 'docs only', qa_by: 'local_pm' })
      assert.ok(out.text.includes(t('blocker.why.asking')), out.text)
      assert.equal((await loadProject(ref, w.env)).ledger[0]!.status, 'open')
    })

    test('a report a desktop session made through the core shows on its card, over the mod\'s older track', async () => {
      await changeActor('local_ask', () => ({ id: 'local_ask', tool: 'claude-code', title: '', cwd: w.repo, projectKey: ref.key, lastSeenAt: NOW, report: { status: 'done', summary: 'Dropped the coupon_v1 columns; migrations pass.' }, reportAt: NOW - 60_000 }), w.env)
      const { json } = await boardOf(w.ctx('local_pm'), ref, false)
      const card = json.actors.find(a => a.id === 'local_ask')!
      assert.equal(card.said, 'Dropped the coupon_v1 columns; migrations pass.')
      assert.equal(card.title, 'Retire v1 coupon fields')
    })

    test('without a desktop PM nothing of the mod\'s round is read', async () => {
      const found = await projectSessions(ref, [], w.env, 'claude-code:pm1', NOW)
      assert.deepEqual(found.everyone, [])
    })

    // ── T-59: archived sessions, and work already closed, are not counted ──

    /** The text board's counts line for these statuses, as the board writes it. */
    const countsOf = (statuses: string[]) => {
      const n = (s: string) => statuses.filter(one => one === s).length

      return t('board.counts', { total: statuses.length, asking: n('asking'), failed: n('failed'), limit: n('limit'), ci: n('ci'), unreleased: n('unreleased'), open: n('open'), running: n('running'), waiting: n('waiting'), done: n('done'), stale: n('stale') })
    }
    const projectFile = () => join(legacy, 'projects', `${keyFile(projectKey(ref.path))}.json`)
    const ledgerOf = (ledger: unknown[], nextId = 20) => write(projectFile(), { key: ref.key, name: ref.name, path: ref.path, pmId: 'local_pm', isDismissed: false, nextId, ledger })
    /** A work item, closed (done or dropped) at `updatedAt` unless `closedAt` says otherwise (null: closed before T-59 kept the time). */
    const item = (id: number, owner: string | null, status: string, updatedAt: number, text = `Item ${id}`, closedAt: number | null = updatedAt) => ({
      id,
      text,
      owner,
      status,
      note: '',
      createdAt: NOW - 9_000_000,
      updatedAt,
      ...(status !== 'open' && closedAt !== null ? { closedAt } : {}),
    })
    /** The PM's round with this list instead, its last words and checks kept. */
    const roundOf = (sessions: Session[]) => {
      const file = join(legacy, 'rounds', 'local_pm.json')
      write(file, { ...JSON.parse(readFileSync(file, 'utf8')), sessions: { list: sessions, fetchedAt: NOW, error: null } })
    }
    const listed = (id: string, title: string, minutesAgo: number): Session => ({ id, title, cwd: w.repo, isRunning: false, lastActivityAt: at(minutesAgo), isPinned: false, hasOpenPr: false })
    const reported = (id: string, title: string, status: string, summary: string, when: number) =>
      changeActor(id, () => ({ id, tool: 'claude-code', title, cwd: w.repo, projectKey: ref.key, lastSeenAt: when, report: { status, summary } as never, reportAt: when }), w.env)

    test('a desktop session the app no longer lists (archived) is not counted, on the text board, the web board and its figures (T-59)', async () => {
      // Reported through the core, then archived: the app's list (the PM's round, fetched at NOW) leaves them out.
      await reported('local_gone_ask', 'Old coupon question', 'waiting_user', 'Keep coupon_v1 read-only, or drop it?', NOW - 3 * 3_600_000)
      await reported('local_gone_rel', 'Old payouts release', 'waiting_release', 'Payouts fix committed (3fa1c2e); waiting for the release.', NOW - 2 * 3_600_000)
      await reported('local_gone_wip', 'Old search filters', 'in_progress', 'Half the filters done.', NOW - 3_600_000)
      // One that reported after the list was fetched: the app may not list it yet, so it still counts.
      await reported('local_newer', 'Brand-new invoices session', 'waiting_user', 'PDF or CSV for the invoices export?', NOW + 60_000)
      const { text, peopleText, json } = await boardOf(w.ctx('local_pm'), ref, false)
      const byId = Object.fromEntries(json.actors.map(a => [a.id, a.status]))
      assert.deepEqual(byId, { local_ask: 'asking', local_run: 'running', local_word: 'asking', local_newer: 'asking' })
      assert.deepEqual(json.pane.kpi, { running: 2, runningAgents: 1, asking: 3, open: 0 })
      // The text board counts what the web board and the pane count.
      for (const board of [text, peopleText]) {
        assert.ok(board.includes(countsOf(json.actors.map(a => a.status))), board)
        for (const title of ['Old coupon question', 'Old payouts release', 'Old search filters']) assert.ok(!board.includes(title), `${title} in\n${board}`)
        assert.ok(board.includes('Brand-new invoices session'))
      }
      assert.ok(!json.attention.some(line => /Old (coupon|payouts|search)/.test(line.text)))
    })

    test('a session whose work items were all closed after its last report is not waiting on you nor unfinished; one that spoke after the close is (T-59)', async () => {
      roundOf([...list, listed('local_named', 'Export columns', 30), listed('local_after', 'Refund rules', 30), listed('local_wip', 'Order search', 30), listed('local_mine', 'Gift cards', 30)])
      // local_ask asked (its track, turn 10 minutes ago); its item was closed 1 minute ago.
      // local_named owns nothing: its report names T-04, done (by an agent) after the report.
      await reported('local_named', 'Export columns', 'waiting_user', 'T-04: keep the old CSV columns or rename them?', NOW - 30 * 60_000)
      // local_after asked again after its item was closed: still waiting on you.
      await reported('local_after', 'Refund rules', 'waiting_user', 'T-05 reopened? The refund cap still looks wrong.', NOW - 30 * 60_000)
      // local_wip stopped midway; its work was taken over and dropped since.
      await reported('local_wip', 'Order search', 'in_progress', 'Search by SKU half done (T-06).', NOW - 30 * 60_000)
      // local_mine still owns an open item: still waiting on you.
      await reported('local_mine', 'Gift cards', 'waiting_user', 'T-07: one gift card per order, or many?', NOW - 30 * 60_000)
      const wip = { ...item(6, 'agent:z9', 'dropped', NOW - 5 * 60_000), formerOwners: ['local_wip'] }
      ledgerOf([item(1, 'local_word', 'open', NOW - 3_600_000), item(3, 'local_ask', 'done', NOW - 60_000), item(4, 'agent:z8', 'done', NOW - 5 * 60_000), item(5, 'local_after', 'done', NOW - 2 * 3_600_000), wip, item(7, 'local_mine', 'open', NOW - 3_600_000)])
      const { text, peopleText, json } = await boardOf(w.ctx('local_pm'), ref, false)
      const byId = Object.fromEntries(json.actors.map(a => [a.id, a.status]))
      assert.equal(byId.local_ask, 'done')
      assert.equal(byId.local_named, 'done')
      assert.equal(byId.local_wip, 'done')
      assert.equal(byId.local_after, 'asking')
      assert.equal(byId.local_mine, 'asking')
      assert.equal(byId.local_word, 'asking')
      assert.deepEqual(json.pane.kpi, kpiOf(json.actors.map(a => a.status), json.agents as never))
      assert.equal(json.pane.kpi.asking, 3)
      assert.equal(json.pane.kpi.open, 0)
      for (const board of [text, peopleText]) {
        assert.ok(board.includes(countsOf(json.actors.map(a => a.status))), board)
        const attention = board.slice(board.indexOf(t('board.section.attention')), board.indexOf(t('board.section.items')))
        for (const title of ['Retire v1 coupon fields', 'Export columns', 'Order search']) assert.ok(!attention.includes(title), `${title} in\n${attention}`)
        for (const title of ['Refund rules', 'Gift cards']) assert.ok(attention.includes(title), `${title} not in\n${attention}`)
      }
    })

    test('a hand-over whose new session was started, or whose work items are done, is not one to start; a real one is (T-59)', async () => {
      const handoff = (title: string, prompt = `Hand-over: read the notes at C:/notes/${title}.md and carry on.`) => ({ title, prompt, at: NOW - 2 * 3_600_000 })
      write(join(legacy, 'sessions', 'local_pm.json'), {
        ...track('local_pm', w.repo, { title: 'acme-shop · PM' }),
        pendingHandoffs: [
          handoff('Coupon cleanup, round 2'),
          handoff('T-08 search filters, round 2'),
          handoff('Old reports, round 2'),
          handoff('T-09 invoices, round 2'),
          handoff('Price rules, round 2'),
        ],
      })
      // Started since: listed by the app, or archived already (the core still knows its report).
      roundOf([...list, listed('local_coupon2', 'Coupon cleanup, round 2', 30)])
      await reported('local_reports2', 'Old reports, round 2', 'done', 'Reports moved to the new page.', NOW - 3_600_000)
      ledgerOf([item(1, 'local_word', 'open', NOW - 3_600_000), item(8, 'agent:z8', 'done', NOW - 3_600_000), item(9, null, 'open', NOW - 3_600_000)])
      const { text, peopleText, json } = await boardOf(w.ctx('local_pm'), ref, false)
      const pending = (title: string) => t('board.attention.handoffPending', { title })
      for (const board of [text, peopleText]) {
        for (const title of ['Coupon cleanup, round 2', 'T-08 search filters, round 2', 'Old reports, round 2']) assert.ok(!board.includes(pending(title)), `${title} in\n${board}`)
        for (const title of ['T-09 invoices, round 2', 'Price rules, round 2']) assert.ok(board.includes(pending(title)), `${title} not in\n${board}`)
      }
      assert.deepEqual(json.attention.filter(line => line.text === pending('T-09 invoices, round 2') || line.text === pending('Price rules, round 2')).length, 2)
    })

    test('a question asked after the close stays, however the closed item was edited since; a code the ledger lacks, or open work in another project, keeps it (T-59 QA)', async () => {
      const ids = ['local_p0', 'local_p1', 'local_p2', 'local_p3', 'local_p4', 'local_p6']
      roundOf([...list, ...ids.map(id => listed(id, `Probe ${id}`, 20))])
      // P1: asked, then its item was closed: not waiting on you.
      await reported('local_p1', 'Probe local_p1', 'waiting_user', 'Keep the old banner or drop it?', NOW - 30 * 60_000)
      // P0: its item was closed before closings kept their time: nothing says when, so it still shows.
      await reported('local_p0', 'Probe local_p0', 'waiting_user', 'Keep the old footer or drop it?', NOW - 30 * 60_000)
      // P2: asked 20 minutes ago; its item was closed an hour ago and its note edited 5 minutes ago.
      await reported('local_p2', 'Probe local_p2', 'waiting_user', 'The refund page needs a new rule: cap or no cap?', NOW - 20 * 60_000)
      // P3: names T-13 (closed since) and T-61, which this project's ledger does not hold.
      await reported('local_p3', 'Probe local_p3', 'waiting_user', 'T-13 is done. Shall I start T-61 next?', NOW - 30 * 60_000)
      // P4: its item here was closed since, but it owns an open one in another project.
      await reported('local_p4', 'Probe local_p4', 'waiting_user', 'Shared price helper: round up or down?', NOW - 30 * 60_000)
      const weather = projectRefOf(join(w.root, 'weather-app'))
      write(join(legacy, 'projects', `${keyFile(weather.key)}.json`), { key: weather.key, name: weather.name, path: weather.path, pmId: null, isDismissed: false, nextId: 4, ledger: [item(3, 'local_p4', 'open', NOW - 3_600_000)] })
      ledgerOf([
        item(1, 'local_word', 'open', NOW - 3_600_000),
        item(15, 'local_p1', 'done', NOW - 5 * 60_000),
        item(16, 'local_p0', 'done', NOW - 5 * 60_000, 'Item 16', null),
        { ...item(11, 'local_p2', 'done', NOW - 5 * 60_000, 'Item 11', NOW - 60 * 60_000), note: 'Edited after the close.' },
        item(13, 'agent:z8', 'done', NOW - 5 * 60_000),
        item(14, 'local_p4', 'done', NOW - 5 * 60_000),
        item(12, 'local_p6', 'done', NOW - 60 * 60_000),
      ])
      // P6: reports a new question through the core with a commit of its done item: the item's update is the report's own time.
      const sha = w.commit('banner.txt', 'new banner', 'Swap the banner')
      await reportTool(w.ctx('local_p6'), { status: 'waiting_user', summary: 'The banner is swapped; keep the old one as a fallback?', commit: sha, item: 12, title: 'Probe local_p6' })
      assert.ok((await loadProject(ref, w.env)).ledger.find(i => i.id === 12)!.updatedAt >= NOW, 'the report attached its commit to T-12')
      const { text, peopleText, json } = await boardOf(w.ctx('local_pm'), ref, false)
      const byId = Object.fromEntries(json.actors.map(a => [a.id, a.status]))
      assert.deepEqual(
        ids.map(id => [id, byId[id]]),
        [
          ['local_p0', 'asking'],
          ['local_p1', 'done'],
          ['local_p2', 'asking'],
          ['local_p3', 'asking'],
          ['local_p4', 'asking'],
          ['local_p6', 'asking'],
        ],
      )
      assert.deepEqual(json.pane.kpi, kpiOf(json.actors.map(a => a.status), json.agents as never))
      for (const board of [text, peopleText]) assert.ok(board.includes(countsOf(json.actors.map(a => a.status))), board)
    })

    test('the ledger keeps when an item was closed: set on done or dropped, kept through edits, gone on reopening (T-59 QA)', async () => {
      ledgerOf([item(1, 'local_word', 'open', NOW - 3_600_000), item(17, null, 'open', NOW - 3_600_000)])
      const ctx = w.ctx('local_pm')
      const closedAt = async () => (await loadProject(ref, w.env)).ledger.find(i => i.id === 17)!.closedAt
      await ledgerTool(ctx, { action: 'update', id: 17, status: 'done', qa: 'skip', qa_note: 'docs only', qa_by: 'local_pm' })
      assert.equal(await closedAt(), NOW)
      w.advance(60_000)
      await ledgerTool(w.ctx('local_pm'), { action: 'update', id: 17, note: 'A later note.' })
      assert.equal(await closedAt(), NOW)
      await ledgerTool(w.ctx('local_pm'), { action: 'update', id: 17, status: 'dropped' })
      assert.equal(await closedAt(), NOW + 60_000)
      await ledgerTool(w.ctx('local_pm'), { action: 'update', id: 17, status: 'open' })
      assert.equal(await closedAt(), undefined)
    })

    test('the PM, a list that came back empty, and a session older than a full list are never taken as archived (T-59 QA)', async () => {
      // The PM has a record of its own in the core; the list never holds it. Its open item still names it.
      await changeActor('local_pm', () => ({ id: 'local_pm', tool: 'claude-code', title: 'acme-shop · PM', cwd: w.repo, projectKey: ref.key, lastSeenAt: NOW - 3 * 3_600_000 }), w.env)
      ledgerOf([item(1, 'local_word', 'open', NOW - 3_600_000), item(18, 'local_pm', 'open', NOW - 3_600_000, 'Write the release notes')])
      const lost = t('board.attention.lost', { code: 'T-18', text: 'Write the release notes', owner: 'local_pm' })
      assert.ok(!(await boardOf(w.ctx('local_pm'), ref, false)).text.includes(lost))
      // A list that came back empty says nothing of who was archived.
      await reported('local_quiet', 'Quiet coupon question', 'waiting_user', 'Keep coupon_v1 read-only, or drop it?', NOW - 3 * 3_600_000)
      roundOf([])
      assert.equal((await boardOf(w.ctx('local_pm'), ref, false)).json.actors.find(a => a.id === 'local_quiet')?.status, 'asking')
      // A full list (the newest 100): one older than its oldest may only be past the limit; one newer and missing is archived.
      const elsewhere = join(w.root, 'weather-app')
      roundOf(Array.from({ length: 100 }, (_, i) => ({ ...listed(`local_w${i}`, `Weather ${i}`, i + 1), cwd: elsewhere })))
      await reported('local_newer_gone', 'Archived search question', 'waiting_user', 'Search by SKU or by name?', NOW - 30 * 60_000)
      const byId = Object.fromEntries((await boardOf(w.ctx('local_pm'), ref, false)).json.actors.map(a => [a.id, a.status]))
      assert.equal(byId.local_quiet, 'asking')
      assert.equal(byId.local_newer_gone, undefined)
    })

    test('the hooks stand aside in a desktop session where the mod is installed, and use its id where it is not', async () => {
      const input = { session_id: 'cli-session-1', cwd: w.repo, hook_event_name: 'UserPromptSubmit', prompt: 'Retire the v1 coupon fields' }
      mkdirSync(join(w.home, '.claude', 'local-mods', 'project-pm', '.claude-plugin'), { recursive: true })
      writeFileSync(join(w.home, '.claude', 'local-mods', 'project-pm', '.claude-plugin', 'plugin.json'), '{"name":"project-pm","version":"1.1.0"}')
      assert.equal(await runHook('claude-code', 'UserPromptSubmit', input, desktopEnv('local_ask'), NOW, hostWith()), null)
      assert.ok(!existsSync(paths(w.env).actor('local_ask')))
      assert.ok(!existsSync(paths(w.env).actor('claude-code:cli-session-1')))
      // No mod: the hook keeps the desktop session's record under its own id, and tells the model the PM's words.
      const { rmSync } = await import('node:fs')
      rmSync(join(w.home, '.claude', 'local-mods'), { recursive: true })
      const out = await runHook('claude-code', 'UserPromptSubmit', input, desktopEnv('local_ask'), NOW, hostWith())
      assert.ok(existsSync(join(paths(w.env).actors, `${actorFile('local_ask')}.json`)))
      assert.ok(JSON.stringify(out).includes('local_ask'))
      // In a terminal, as v1.0.
      await runHook('claude-code', 'UserPromptSubmit', input, w.env, NOW, hostWith())
      assert.ok(existsSync(paths(w.env).actor('claude-code:cli-session-1')))
    })
  })
}
