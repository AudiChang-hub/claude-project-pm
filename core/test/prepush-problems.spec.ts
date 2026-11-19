/**
 * When the pre-push check cannot check (git cannot answer, the data file cannot be read), the push goes through, as
 * a broken PM must not stop work, but never in silence: the person is told on the spot, and the board lists it under
 * Needs attention until it is a week old (6.2).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import type { Run } from '../src/host'
import { ct } from '../src/messages'
import { prePushHook, pushProblems } from '../src/prepush'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import { paths } from '../src/store'
import { boardTool, ledgerTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, git, hostWith, serverCommand, world } from './helpers'

const DAY = 24 * 60 * 60 * 1000

for (const lang of LANGS) {
  describe(`a push the check could not check (${lang})`, () => {
    let w: World
    let ref: ProjectRef
    let input: string
    beforeEach(async () => {
      w = world(lang)
      ref = (await resolveProject(w.repo))!
      await ledgerTool(w.ctx(), { action: 'add', text: 'Add the Acme coupon field' })
      const sha = w.commit('coupon.js', 'export const ACME10 = 0.1\n', 'Add the coupon field')
      input = `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`
      git(w.repo, 'rev-parse', 'HEAD')
    })
    afterEach(() => w.done())
    /** git as it is, but rev-list fails (a shallow clone, a missing object). */
    const brokenRevList: Run = async (argv, cwd, timeoutMs) => (argv[1] === 'rev-list' ? null : hostWith()(argv, cwd, timeoutMs))

    test('git cannot list the commits: the push goes through, and is said and listed on the board', async () => {
      const out = await prePushHook(ref, input, brokenRevList, w.env, w.ctx().now())
      assert.equal(out.code, 0)
      const reason = ct('push.gitFailed', { ref: 'refs/heads/main' })
      assert.ok(out.stderr.includes(ct('push.notChecked', { reason })), out.stderr)
      const problems = await pushProblems(ref, w.env, w.ctx().now())
      assert.equal(problems.length, 1)
      assert.equal(problems[0]!.reason, reason)
      const board = await boardTool(w.ctx(), {})
      const line = (board.structured.attention as { text: string }[]).find(a => a.text.includes(reason))
      assert.ok(line, board.text)
      assert.ok(board.text.split(t('board.section.attention'))[1]!.includes(reason))
    })

    test('the data file cannot be read: the push goes through, said and recorded, and the board shows it once the file is fixed', async () => {
      const file = paths(w.env).project(ref)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, '{ not json')
      const out = await prePushHook(ref, input, hostWith(), w.env, w.ctx().now())
      assert.equal(out.code, 0)
      assert.ok(out.stderr.length > 0 && out.stderr.includes(file), out.stderr)
      assert.equal((await pushProblems(ref, w.env, w.ctx().now())).length, 1)
      writeFileSync(file, JSON.stringify({ key: ref.key, name: ref.name, path: ref.path, pmId: null, isDismissed: false, ledger: [], nextId: 1 }))
      const board = await boardTool(w.ctx(), {})
      assert.ok((board.structured.attention as { text: string }[]).some(a => a.text.includes(file)), board.text)
    })

    test('a problem a week old leaves the board', async () => {
      await prePushHook(ref, input, brokenRevList, w.env, w.ctx().now())
      assert.equal((await pushProblems(ref, w.env, w.ctx().now() + 6 * DAY)).length, 1)
      assert.equal((await pushProblems(ref, w.env, w.ctx().now() + 8 * DAY)).length, 0)
    })

    test('a check that worked records nothing', async () => {
      const out = await prePushHook(ref, input, hostWith(), w.env, w.ctx().now())
      assert.equal(out.code, 1)
      assert.deepEqual(await pushProblems(ref, w.env, w.ctx().now()), [])
    })

    test('the program cannot tell which project it is in: the push goes through, but says so (T-37 QA2 5)', { timeout: 60_000 }, () => {
      // Run where git finds no repository, as when git rev-parse does not answer in time.
      const { command, args } = serverCommand('check', 'pre-push')
      const out = spawnSync(command, args, { cwd: w.home, env: { ...w.env, PROJECT_PM_LANG: lang }, input, encoding: 'utf8', windowsHide: true })
      assert.equal(out.status, 0, out.stderr)
      assert.equal(out.stdout, '')
      assert.ok(out.stderr.includes(ct('push.noProject')), out.stderr)
    })
  })
}
