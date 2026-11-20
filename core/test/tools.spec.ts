import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import { ct } from '../src/messages'
import { resolveProject } from '../src/project'
import { changeActor, loadProject, paths } from '../src/store'
import { boardTool, ledgerTool, pmTool, reportTool } from '../src/tools'
import type { CoreProject } from '../src/types'
import type { World } from './helpers'
import { LANGS, PROBE_HOST, hostWith, watchFs, world } from './helpers'

/** Words each language must say, written out, so a test fails when a message loses its meaning, not only its key. */
const SAYS = {
  'zh-TW': { added: '已新增工作項目 T-01', noQa: '還沒有驗收紀錄', updated: '已更新工作項目 T-01', claimed: '已擔任', role: '你是「acme-shop」專案的 PM', board: '# 專案狀態報告：acme-shop', notGit: '不在 git repo 裡', noPm: '還沒有 PM', reported: '已回報給 PM：done' },
  en: { added: 'Added work item T-01', noQa: 'no QA record', updated: 'Updated work item T-01', claimed: 'is now the PM', role: 'You are the PM of the "acme-shop" project', board: '# Project status: acme-shop', notGit: 'not in a git repository', noPm: 'no PM yet', reported: 'Reported to the PM: done' },
} as const

for (const lang of LANGS) {
  describe(`tools (${lang})`, () => {
    let w: World
    const says = SAYS[lang]
    beforeEach(() => {
      w = world(lang)
    })
    afterEach(() => w.done())

    const items = async () => (await loadProject((await resolveProject(w.repo))!, w.env)).ledger

    test('ledger add keeps the item with a uid, its author and rev 1', async () => {
      const out = await ledgerTool(w.ctx(), { action: 'add', text: 'Add a coupon field to checkout', criteria: 'The field takes ACME10 and rejects bogus codes' })
      assert.ok(!out.isError)
      assert.ok(out.text.includes(says.added), out.text)
      const [item] = await items()
      assert.match(item!.uid!, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      assert.deepEqual(item!.createdBy, { actor: 'claude-code:pm1' })
      assert.deepEqual(item!.updatedBy, { actor: 'claude-code:pm1' })
      assert.equal(item!.rev, 1)
      assert.equal((out.structured.item as { code: string }).code, 'T-01')
    })

    test('two items added at the same moment get different uids', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'One' })
      await ledgerTool(w.ctx(), { action: 'add', text: 'Two' })
      const [a, b] = await items()
      assert.notEqual(a!.uid, b!.uid)
    })

    test('closing without QA is refused, and nothing changes', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, status: 'done' })
      assert.ok(!out.isError)
      assert.ok(out.text.includes(says.noQa), out.text)
      const [item] = await items()
      assert.equal(item!.status, 'open')
      assert.equal(item!.rev, 1)
    })

    test('the owner may not check its own work', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field', owner: 'claude-code:dev1' })
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'claude-code:dev1' })
      assert.ok(out.text.includes(t('ledger.qaByOwner', { code: 'T-01', owner: 'claude-code:dev1' })), out.text)
      assert.equal((await items())[0]!.qa, undefined)
    })

    test('skipping QA needs a reason', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Fix a typo in the README' })
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, qa: 'skip' })
      assert.ok(out.text.startsWith(t('ledger.qaNeedsNote')), out.text)
    })

    test('a QA pass by someone else closes the item and keeps the HEAD it checked', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      const head = w.commit('coupon.js', 'export const code = "ACME10"\n', 'Add the coupon field')
      w.advance(60_000)
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'agent:qa1' })
      assert.ok(out.text.includes(says.updated), out.text)
      const [item] = await items()
      assert.equal(item!.status, 'done')
      assert.equal(item!.qa!.commit, head)
      assert.equal(item!.qa!.by, 'agent:qa1')
      assert.equal(item!.rev, 2)
      assert.equal(item!.updatedAt, Date.parse('2026-11-19T12:01:00.000Z'))
    })

    test('qa_sha names the commit checked, and commit is recorded on the item', async () => {
      const first = w.commit('a.js', '1\n', 'First')
      w.commit('b.js', '2\n', 'Second')
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      await ledgerTool(w.ctx(), { action: 'update', id: 1, qa: 'pass', qa_by: 'user', qa_sha: first.slice(0, 7), commit: first.slice(0, 7) })
      const [item] = await items()
      assert.equal(item!.qa!.commit, first)
      assert.deepEqual(item!.commits, [first])
    })

    test('force with a note closes without QA', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, status: 'done', force: true, note: 'The user confirmed it in chat' })
      assert.ok(out.text.includes(says.updated), out.text)
      assert.equal((await items())[0]!.status, 'done')
    })

    test('an owner with steps left holds the close; the verdict given with it is kept', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field', owner: 'claude-code:dev1' })
      await changeActor('claude-code:dev1', () => ({ id: 'claude-code:dev1', tool: 'claude-code', title: 'Coupon work', cwd: w.repo, lastSeenAt: Date.now(), turnAt: Date.now(), plan: [{ content: 'Write the tests', status: 'in_progress' }] }), w.env)
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'agent:qa1' })
      assert.ok(out.text.includes(t('blocker.why.open')), out.text)
      assert.ok(out.text.startsWith(t('ledger.qaKept', { reason: '' }).trim().slice(0, 4)), out.text)
      const [item] = await items()
      assert.equal(item!.status, 'open')
      assert.equal(item!.qa!.result, 'pass')
    })

    test('an item written before v1 is not given the new fields until it is changed', async () => {
      const ref = (await resolveProject(w.repo))!
      const old: CoreProject = { key: ref.key, name: ref.name, path: ref.path, pmId: null, isDismissed: false, nextId: 2, ledger: [{ id: 1, text: 'Old work', owner: null, status: 'open', note: '', createdAt: 1, updatedAt: 1 }] }
      mkdirSync(join(w.env.PROJECT_PM_HOME!, 'projects'), { recursive: true })
      writeFileSync(paths(w.env).project(ref), JSON.stringify(old))
      await ledgerTool(w.ctx(), { action: 'add', text: 'New work' })
      const [kept, added] = await items()
      assert.deepEqual(Object.keys(kept!).sort(), ['createdAt', 'id', 'note', 'owner', 'status', 'text', 'updatedAt'])
      assert.ok(added!.uid)
      await ledgerTool(w.ctx(), { action: 'update', id: 1, note: 'touched' })
      const [changed] = await items()
      assert.equal(changed!.uid, undefined)
      assert.equal(changed!.rev, 1)
      assert.deepEqual(changed!.updatedBy, { actor: 'claude-code:pm1' })
    })

    test('the ledger outside a git repository is an error, not an empty list', async () => {
      const out = await ledgerTool(w.ctx('claude-code:pm1', { cwd: w.home }), { action: 'list' })
      assert.equal(out.isError, true)
      assert.ok(out.text.includes(says.notGit), out.text)
    })

    test('a network folder given as `project` is refused before git or the file system goes there (T-37 QA5)', async t => {
      // The model fills `project`; on Windows git starting in \\host\share connects to it (SMB, the person's NTLM hash).
      if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
      const visited: string[] = []
      const run = hostWith()
      const ctx = w.ctx('claude-code:pm1', { run: async (argv: string[], cwd: string, timeoutMs?: number) => (visited.push(cwd), cwd.startsWith(w.root) ? run(argv, cwd, timeoutMs) : null) })
      const fs = watchFs()
      try {
        for (const project of [`\\\\${PROBE_HOST}\\share\\acme`, `//${PROBE_HOST}/share/acme`, `\\\\?\\UNC\\${PROBE_HOST}\\share\\acme`, `\\\\.\\pipe\\acme`]) {
          for (const call of [() => ledgerTool(ctx, { action: 'list', project }), () => boardTool(ctx, { project }), () => reportTool(ctx, { status: 'done', summary: 'x', project }), () => pmTool(ctx, { action: 'status', project })]) {
            const out = await call()
            assert.deepEqual(visited.filter(cwd => !cwd.startsWith(w.root)), [], `ran a command in ${project}`)
            assert.deepEqual(fs.remote, [], `looked up ${project}`)
            assert.equal(out.isError, true, project)
            assert.equal(out.text, ct('error.remotePath', { path: project }), project)
          }
        }
        assert.deepEqual(visited.filter(cwd => !cwd.startsWith(w.root)), [], 'ran a command in a network folder')
        assert.deepEqual(fs.remote, [], 'looked up a network path')
      } finally {
        fs.restore()
      }
      // The project's own folder, in its long-path spelling, still works.
      const out = await ledgerTool(ctx, { action: 'list', project: `\\\\?\\${w.repo}` })
      assert.notEqual(out.isError, true, out.text)
    })

    test('a data file that is not JSON is the core failing, and it is left as it was', async () => {
      const ref = (await resolveProject(w.repo))!
      mkdirSync(join(w.env.PROJECT_PM_HOME!, 'projects'), { recursive: true })
      writeFileSync(paths(w.env).project(ref), '{ not json')
      const out = await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      assert.equal(out.isError, true)
      assert.equal(readFileSync(paths(w.env).project(ref), 'utf8'), '{ not json')
    })

    test('report keeps the actor and the detail file, and says there is no PM yet', async () => {
      const out = await reportTool(w.ctx('claude-code:dev1'), { status: 'done', summary: 'Coupon field added', detail: '## How\nTests pass.', title: 'Coupon work' })
      assert.ok(!out.isError)
      assert.ok(out.text.includes(says.noPm), out.text)
      const actor = JSON.parse(readFileSync(paths(w.env).actor('claude-code:dev1'), 'utf8'))
      assert.equal(actor.report.status, 'done')
      assert.equal(actor.title, 'Coupon work')
      assert.equal(readFileSync(actor.report.detail, 'utf8'), '## How\nTests pass.\n')
    })

    test('report says reported once the project has a PM, and records its commit on the item', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      const sha = w.commit('coupon.js', 'x\n', 'Coupon')
      const out = await reportTool(w.ctx('claude-code:dev1'), { status: 'done', summary: 'Coupon field added', commit: sha.slice(0, 7), item: 1 })
      assert.ok(out.text.startsWith(says.reported), out.text)
      assert.deepEqual((await items())[0]!.commits, [sha])
    })

    test('report outside a git repository says it saved nothing', async () => {
      const out = await reportTool(w.ctx('claude-code:dev1', { cwd: w.home }), { status: 'done', summary: 'x' })
      assert.equal(out.isError, true)
      assert.ok(!existsSync(paths(w.env).actor('claude-code:dev1')))
    })

    test('report with a bad status changes nothing', async () => {
      const out = await reportTool(w.ctx('claude-code:dev1'), { status: 'finished', summary: 'x' })
      assert.equal(out.text, t('report.badStatus'))
    })

    test('pm claim hands over the instructions; release and status follow', async () => {
      const claimed = await pmTool(w.ctx(), { action: 'claim' })
      assert.ok(claimed.text.includes(says.claimed), claimed.text)
      assert.ok(claimed.text.includes(says.role), claimed.text)
      const other = await pmTool(w.ctx('codex:other'), { action: 'release' })
      assert.ok(other.text.includes('claude-code:pm1'), other.text)
      const status = await pmTool(w.ctx(), { action: 'status' })
      assert.equal(status.structured.pmId, 'claude-code:pm1')
      assert.equal(status.structured.boardUrl, null)
      const released = await pmTool(w.ctx(), { action: 'release' })
      assert.equal(released.structured.pmId, null)
      assert.equal((await loadProject((await resolveProject(w.repo))!, w.env)).pmId, null)
    })

    test('board lists the ledger, the sessions that reported, and what needs attention', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field', owner: 'claude-code:dev1' })
      await ledgerTool(w.ctx(), { action: 'add', text: 'Shipping rates' })
      await reportTool(w.ctx('claude-code:dev1'), { status: 'done', summary: 'Coupon field added', delivery: 'not_needed', title: 'Coupon work' })
      const out = await boardTool(w.ctx(), {})
      assert.ok(out.text.startsWith(says.board), out.text)
      const json = out.structured as { progress: { done: number; total: number }; actors: { id: string; status: string }[]; attention: { text: string; item?: number }[]; items: { code: string; qaShown: string | null }[] }
      assert.deepEqual(json.progress, { done: 0, total: 2 })
      assert.deepEqual(json.actors.map(a => [a.id, a.status]), [['claude-code:dev1', 'done']])
      // The owner delivered and there is no QA yet: the item awaits QA; the other has no owner.
      assert.equal(json.items[0]!.qaShown, 'awaiting')
      const awaiting = t('board.attention.qaAwaiting', { code: 'T-01', text: 'Coupon field', owner: '' }).split('T-01')[0]!
      assert.ok(json.attention.some(a => a.item === 1 && a.text.startsWith(awaiting)), JSON.stringify(json.attention))
      assert.ok(json.attention.some(a => a.item === 2), JSON.stringify(json.attention))
    })

    test('board answers with the ledger when the session records cannot be read', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      mkdirSync(paths(w.env).actors, { recursive: true })
      writeFileSync(join(paths(w.env).actors, 'broken.json'), '{')
      const out = await boardTool(w.ctx(), {})
      assert.ok(!out.isError)
      assert.ok(out.text.includes('Coupon field'))
      assert.ok(out.text.includes(ct('board.noSessionsRead', { error: '' }).slice(0, 6)), out.text)
    })
  })
}
