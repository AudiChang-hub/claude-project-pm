/**
 * The core in the desktop app (E2, docs/design/v1-core.md 2.4, 3.2, 3.7): the desktop session's own id (local_…) is the
 * core's actor id there, the board reads the desktop app's session list as the PM's mod last kept it (its round), and
 * the core's hooks stand aside where the mod keeps each session's record. Acme data in a temporary home only.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
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
import { resolveProject } from '../src/project'
import { changeActor, loadProject, paths } from '../src/store'
import { boardOf, ledgerTool } from '../src/tools'
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
