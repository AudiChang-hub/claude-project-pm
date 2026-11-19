/**
 * The hard gate in git (docs/design/v1-core.md 6.2), run as git runs it: init puts the pre-push hook and the alias
 * in the Acme repository, a bare repository stands in for GitHub, and every case pushes for real. The six cases of
 * 6.3's check list, plus a project that does not use the PM.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import type { InstallEnv } from '../src/install'
import { init } from '../src/install'
import { ct } from '../src/messages'
import { skipPush, withAttention } from '../src/prepush'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import { loadProject } from '../src/store'
import { boardTool, ledgerTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, fakeClaude, git, hostWith, serverCommand, world } from './helpers'

for (const lang of LANGS) {
  describe(`pre-push and git pm skip (${lang})`, () => {
    let w: World
    let ref: ProjectRef
    let env: NodeJS.ProcessEnv
    // The real clock: git dates the commits with it, and the board compares the two.
    const ctx = () => w.ctx('claude-code:pm1', { now: () => Date.now() - 60_000 })
    const push = (...args: string[]) => spawnSync('git', ['push', 'origin', 'main', ...args], { cwd: w.repo, env, encoding: 'utf8', windowsHide: true })
    const hooks = () => join(w.repo, '.git', 'hooks')

    beforeEach(async () => {
      w = world(lang)
      env = { ...w.env, PROJECT_PM_LANG: lang }
      const remote = join(w.root, 'acme-remote.git')
      git(w.root, 'init', '-q', '--bare', '-b', 'main', remote)
      git(w.repo, 'remote', 'add', 'origin', remote)
      git(w.repo, 'push', '-q', 'origin', 'main')
      ref = (await resolveProject(w.repo))!
    })
    afterEach(() => w.done())

    const install = async () => {
      const { command, args } = serverCommand()
      const ie: InstallEnv = { env: w.env, run: fakeClaude(w.home, hostWith()), home: w.home, self: [command, ...args], exe: null, now: Date.now() - 60_000 }
      const out = await init(ref, ie, { yes: true, ci: false }, () => {})
      assert.deepEqual(out.failed, [])
    }
    const addItem = async () => {
      await ledgerTool(ctx(), { action: 'add', text: 'Add the Acme coupon field', criteria: 'ACME10 takes 10% off' })
      const sha = w.commit('coupon.js', 'export const ACME10 = 0.1\n', 'Add the coupon field')
      await ledgerTool(ctx(), { action: 'update', id: 1, commit: sha })

      return sha
    }

    test('a project without a ledger is not stopped', { timeout: 60_000 }, async () => {
      await install()
      w.commit('notes.md', 'Acme notes\n', 'Add notes')
      const out = push()
      assert.equal(out.status, 0, out.stderr)
    })

    test('no QA: the push is held, naming the work item and the way on', { timeout: 60_000 }, async () => {
      await install()
      const sha = await addItem()
      const out = push()
      assert.notEqual(out.status, 0)
      assert.ok(out.stderr.includes(ct('push.lineItem', { code: 'T-01', text: 'Add the Acme coupon field', n: 1, sha: sha.slice(0, 7) })), out.stderr)
      assert.ok(out.stderr.includes('git pm skip'), out.stderr)
      assert.ok(out.stderr.includes(ct('push.askItem', { code: 'T-01' })), out.stderr)
      assert.equal(git(w.root, '--git-dir', join(w.root, 'acme-remote.git'), 'rev-parse', 'main') === sha, false)
    })

    test('QA passed at HEAD: the push goes through', { timeout: 60_000 }, async () => {
      await install()
      await addItem()
      const passed = await ledgerTool(ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'agent:qa1', qa_note: 'ACME10 checked' })
      assert.equal(passed.isError, undefined)
      const out = push()
      assert.equal(out.status, 0, out.stderr)
    })

    test('a commit after the QA is held again', { timeout: 60_000 }, async () => {
      await install()
      await addItem()
      await ledgerTool(ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'agent:qa1' })
      const later = w.commit('coupon.js', 'export const ACME10 = 0.15\n', 'Change the discount')
      const out = push()
      assert.notEqual(out.status, 0)
      assert.ok(out.stderr.includes(ct('push.lineNone', { n: 1, sha: later.slice(0, 7) })), out.stderr)
      assert.ok(out.stderr.includes(ct('push.askNone')), out.stderr)
    })

    test('git pm skip records the reason on the item, and the push goes through', { timeout: 60_000 }, async () => {
      await install()
      const sha = await addItem()
      assert.notEqual(push().status, 0)
      const reason = lang === 'en' ? 'docs only' : '只改說明文字'
      const skipped = spawnSync('git', ['pm', 'skip', reason], { cwd: w.repo, env, encoding: 'utf8', windowsHide: true })
      assert.equal(skipped.status, 0, skipped.stderr)
      assert.ok(skipped.stdout.includes(ct('skip.recorded', { code: 'T-01', sha: sha.slice(0, 7), reason })), skipped.stdout)
      const item = (await loadProject(ref, w.env)).ledger[0]!
      assert.equal(item.qa?.result, 'skipped')
      assert.equal(item.qa?.note, reason)
      assert.equal(item.qa?.commit, sha)
      const out = push()
      assert.equal(out.status, 0, out.stderr)
    })

    test('git pm skip with no reason asks for one', { timeout: 60_000 }, async () => {
      await install()
      const out = spawnSync('git', ['pm', 'skip'], { cwd: w.repo, env, encoding: 'utf8', windowsHide: true })
      assert.equal(out.status, 2)
      assert.ok(out.stderr.includes(ct('cli.skipNeedsReason')), out.stderr)
    })

    test('--no-verify gets past the hook, and the board names the push afterwards', { timeout: 60_000 }, async () => {
      await install()
      const sha = await addItem()
      const out = push('--no-verify')
      assert.equal(out.status, 0, out.stderr)
      const board = await boardTool(ctx(), {})
      const line = ct('board.noPush', { branch: 'origin/main', n: 1, sha: sha.slice(0, 7) })
      assert.ok(board.text.includes(line), board.text)
      assert.deepEqual((board.structured.noPush as { commits: string[] }).commits, [sha])
      assert.ok((board.structured.attention as { text: string }[]).some(a => a.text === line))
    })

    test('a pre-push hook already there runs first, and still holds the push when it fails', { timeout: 60_000 }, async () => {
      const own = join(hooks(), 'pre-push')
      writeFileSync(own, '#!/bin/sh\necho "acme lint" >> "$(git rev-parse --git-dir)/acme-lint.txt"\nexit 0\n')
      chmodSync(own, 0o755)
      await install()
      assert.ok(existsSync(join(hooks(), 'pre-push.local')))
      await addItem()
      await ledgerTool(ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'agent:qa1' })
      const out = push()
      assert.equal(out.status, 0, out.stderr)
      assert.ok(existsSync(join(w.repo, '.git', 'acme-lint.txt')))
      writeFileSync(join(hooks(), 'pre-push.local'), '#!/bin/sh\necho "acme lint failed" >&2\nexit 1\n')
      w.commit('coupon.js', 'export const ACME10 = 0.1 // checked\n', 'Comment the discount')
      await ledgerTool(ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'agent:qa1' })
      const held = push()
      assert.notEqual(held.status, 0)
      assert.ok(held.stderr.includes('acme lint failed'), held.stderr)
    })

    test('a pre-push hook already there in another language runs as git ran it, by its own #! line', { timeout: 60_000 }, async () => {
      const own = join(hooks(), 'pre-push')
      writeFileSync(own, '#!/usr/bin/env node\nrequire("fs").appendFileSync(require("path").join(process.env.GIT_DIR || ".git", "acme-node.txt"), "ran\\n")\n')
      chmodSync(own, 0o755)
      await install()
      await addItem()
      await ledgerTool(ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'agent:qa1' })
      const out = push()
      assert.equal(out.status, 0, out.stderr)
      assert.ok(existsSync(join(w.repo, '.git', 'acme-node.txt')), out.stderr)
    })

    test('skip with no work item for the commits adds an unregistered push', async () => {
      await ledgerTool(ctx(), { action: 'add', text: 'Something else at Acme' })
      const sha = w.commit('banner.txt', 'Acme sale\n', 'Add a banner')
      const done = await skipPush(ref, 'banner text only', hostWith(), w.env, Date.now())
      assert.deepEqual(done, { code: 'T-02', sha, isNew: true })
      const item = (await loadProject(ref, w.env)).ledger[1]!
      assert.equal(item.text, ct('push.unregistered', { branch: 'main', sha: sha.slice(0, 7) }))
      assert.deepEqual(item.commits, [sha])
      assert.equal(item.qa?.result, 'skipped')
    })
  })
}

describe('the board line for unchecked pushes', () => {
  test('takes the place of "none", or goes first in the section', () => {
    const heading = t('board.section.attention')
    const none = t('board.none')
    assert.equal(withAttention(`# Acme\n\n${heading}\n${none}\n\n## B`, 'X', heading, none), `# Acme\n\n${heading}\nX\n\n## B`)
    assert.equal(withAttention(`# Acme\n\n${heading}\nY\n\n## B`, 'X', heading, none), `# Acme\n\n${heading}\nX\nY\n\n## B`)
  })
})
