import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { resolveProject } from '../src/project'
import { loadProject, mergeLegacy, paths } from '../src/store'
import { ledgerTool } from '../src/tools'
import type { CoreItem, CoreProject } from '../src/types'
import type { World } from './helpers'
import { world } from './helpers'

const item = (id: number, extra: Partial<CoreItem> = {}): CoreItem => ({ id, text: `Item ${id}`, owner: null, status: 'open', note: '', createdAt: 1, updatedAt: 1, ...extra })
const project = (ledger: CoreItem[], extra: Partial<CoreProject> = {}): CoreProject => ({ key: 'k', name: 'acme-shop', path: '/acme-shop', pmId: null, isDismissed: false, ledger, nextId: ledger.length + 1, ...extra })

describe('E1: the core and the desktop mod share a project', () => {
  test('the later copy of an item stands; the mod\'s copy gets the fields it does not know back', () => {
    const ours = item(1, { updatedAt: 10, uid: 'u1', createdBy: { actor: 'claude-code:pm1' }, commits: ['abc'], rev: 3, qa: { result: 'pass', by: 'agent:q', at: 5, note: '', byPerson: 'acme-dev' } })
    const theirs = item(1, { updatedAt: 20, text: 'Renamed in the desktop app', qa: { result: 'pass', by: 'agent:q', at: 5, note: '' } })
    const merged = mergeLegacy(project([ours]), project([theirs]), true)
    const [one] = merged.ledger
    assert.equal(one!.text, 'Renamed in the desktop app')
    assert.equal(one!.uid, 'u1')
    assert.deepEqual(one!.commits, ['abc'])
    assert.equal(one!.qa!.byPerson, 'acme-dev')
    assert.equal(one!.rev, 4)
    assert.deepEqual(one!.updatedBy, { actor: 'desktop-mod' })
  })

  test('a newer verdict from the mod does not take the old verdict\'s new fields', () => {
    const ours = item(1, { updatedAt: 10, qa: { result: 'pass', by: 'agent:q', at: 5, note: '', byPerson: 'acme-dev' } })
    const theirs = item(1, { updatedAt: 20, qa: { result: 'fail', by: 'agent:r', at: 15, note: 'broken' } })
    const [one] = mergeLegacy(project([ours]), project([theirs]), true).ledger
    assert.equal(one!.qa!.byPerson, undefined)
    assert.equal(one!.qa!.result, 'fail')
  })

  test('items only the mod has are added; the next id clears both', () => {
    const merged = mergeLegacy(project([item(1), item(2)], { nextId: 3 }), project([item(1), item(3)], { nextId: 4 }), false)
    assert.deepEqual(merged.ledger.map(i => i.id), [1, 2, 3])
    assert.equal(merged.nextId, 4)
  })

  test('the PM follows the file written last', () => {
    assert.equal(mergeLegacy(project([], { pmId: 'a' }), project([], { pmId: 'local_b' }), true).pmId, 'local_b')
    assert.equal(mergeLegacy(project([], { pmId: 'a' }), project([], { pmId: 'local_b' }), false).pmId, 'a')
  })
})

describe('E1 on disk', () => {
  let w: World
  beforeEach(() => {
    w = world('en', { legacy: true })
  })
  afterEach(() => w.done())

  test('a project only the mod has is read, and the core writes it back in the format the mod reads', async () => {
    const ref = (await resolveProject(w.repo))!
    const old = { key: ref.key, name: ref.name, path: ref.path, pmId: 'local_pm', isDismissed: false, nextId: 2, ledger: [{ id: 1, text: 'From the desktop', owner: 'local_dev', status: 'open', note: '', createdAt: 1, updatedAt: 1 }] }
    writeFileSync(paths(w.env).legacyProject(ref), JSON.stringify(old))
    const listed = await ledgerTool(w.ctx(), { action: 'list' })
    assert.ok(listed.text.includes('From the desktop'), listed.text)
    await ledgerTool(w.ctx(), { action: 'add', text: 'From the CLI' })
    const back = JSON.parse(readFileSync(paths(w.env).legacyProject(ref), 'utf8'))
    assert.equal(back.pmId, 'local_pm')
    assert.equal(back.nextId, 3)
    assert.deepEqual(back.ledger[0], old.ledger[0])
    assert.equal(back.ledger[1].text, 'From the CLI')
    for (const key of ['key', 'name', 'path', 'pmId', 'isDismissed', 'ledger', 'nextId']) assert.ok(key in back, key)
  })

  test('an item the mod changed after the core is read as the mod left it', async () => {
    const ref = (await resolveProject(w.repo))!
    await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
    const legacy = JSON.parse(readFileSync(paths(w.env).legacyProject(ref), 'utf8'))
    // The mod (v0.9) writes its own copy of the item: without the fields it does not know.
    const { uid, createdBy, updatedBy, rev, ...plain } = legacy.ledger[0]
    void createdBy, void updatedBy, void rev
    legacy.ledger[0] = { ...plain, status: 'dropped', updatedAt: plain.updatedAt + 1000 }
    await new Promise(resolve => setTimeout(resolve, 20))
    writeFileSync(paths(w.env).legacyProject(ref), JSON.stringify(legacy))
    const [one] = (await loadProject(ref, w.env)).ledger
    assert.equal(one!.status, 'dropped')
    assert.equal(one!.uid, uid)
  })

  test('without the mod installed, nothing is written to its folder', async () => {
    const plain = world('en')
    try {
      await ledgerTool(plain.ctx(), { action: 'add', text: 'Coupon field' })
      const ref = (await resolveProject(plain.repo))!
      assert.throws(() => readFileSync(paths(plain.env).legacyProject(ref)))
    } finally {
      plain.done()
    }
  })
})

describe('many processes writing one project', () => {
  let w: World
  beforeEach(() => {
    w = world('en')
  })
  afterEach(() => w.done())

  test('10 processes adding 100 items each lose none', { timeout: 240_000 }, async () => {
    const writer = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'writer.ts')
    const run = promisify(execFile)
    await Promise.all(Array.from({ length: 10 }, (_, n) => run(process.execPath, ['--import', 'tsx', writer, w.repo, String(n), '100'], { env: w.env, cwd: fileURLToPath(new URL('..', import.meta.url)) })))
    const ref = (await resolveProject(w.repo))!
    const done = await loadProject(ref, w.env)
    assert.equal(done.ledger.length, 1000)
    assert.equal(new Set(done.ledger.map(i => i.id)).size, 1000)
    assert.equal(done.nextId, 1001)
    assert.equal(done.revision, 1000)
  })
})
