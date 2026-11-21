import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { isSameId } from '../../hooks/qa'
import { isHandedOff } from '../../hooks/sessions'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import { loadProject, mergeLegacy, paths } from '../src/store'
import { ledgerTool } from '../src/tools'
import type { CoreItem, CoreProject } from '../src/types'
import type { World } from './helpers'
import { LANGS, world } from './helpers'

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

for (const lang of LANGS) {
  describe(`formerOwners, as v0.9.1's mod keeps them, in the core too (${lang})`, () => {
    let w: World
    let ref: ProjectRef
    beforeEach(async () => {
      w = world(lang, { legacy: true })
      ref = (await resolveProject(w.repo))!
    })
    afterEach(() => w.done())

    const coreFile = () => JSON.parse(readFileSync(paths(w.env).project(ref), 'utf8')) as CoreProject
    const modFile = () => JSON.parse(readFileSync(paths(w.env).legacyProject(ref), 'utf8')) as CoreProject
    const both = () => [coreFile().ledger[0]!, modFile().ledger[0]!]
    /** The core writes, on its clock, after whatever the mod wrote. */
    const core = async (input: Record<string, unknown>) => {
      w.advance(10_000)
      const out = await ledgerTool(w.ctx(), { action: 'update', id: 1, ...input })
      assert.ok(!('error' in out.structured), out.text)
    }
    /**
     * The desktop mod (v0.9.1) changes the item in its own file, later than the core: its ledger update, line for line
     * (hooks/actions.ts, ledger 'update'), with `extra` for fields of a mod newer than this core.
     */
    const mod = async (change: { owner?: string | null; note?: string }, extra: Record<string, unknown> = {}) => {
      await new Promise(resolve => setTimeout(resolve, 30))
      const file = modFile()
      const item = file.ledger[0]!
      const owner = change.owner === undefined ? item.owner : change.owner
      const changed: CoreItem & Record<string, unknown> = { ...item, owner, note: change.note ?? item.note, updatedAt: item.updatedAt + 1_000, ...extra }
      if (item.owner && !isSameId(item.owner, owner)) changed.formerOwners = [...(item.formerOwners ?? []).filter(o => !isSameId(o, item.owner!)), item.owner.trim()]
      file.ledger = file.ledger.map(i => (i.id === 1 ? changed : i))
      writeFileSync(paths(w.env).legacyProject(ref), JSON.stringify(file, null, 2))
    }

    test('a core write keeps the formerOwners the mod wrote, and any field the core does not know', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Add the Acme coupon field', owner: 'local_acme_a' })
      await mod({ owner: 'local_acme_b' }, { acmeLater: { kept: true } })
      await core({ note: 'ACME10 takes 10% off' })
      for (const one of both() as (CoreItem & { acmeLater?: unknown })[]) {
        assert.equal(one.note, 'ACME10 takes 10% off')
        assert.deepEqual(one.formerOwners, ['local_acme_a'])
        assert.deepEqual(one.acmeLater, { kept: true })
      }
    })

    test('the core records the owner an item leaves, as the mod does: once each, and only when it really changes', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Add the Acme coupon field', owner: 'claude-code:acme-a' })
      // The same owner, spaced and cased otherwise, is no change.
      await core({ owner: ' Claude-Code:ACME-A ' })
      assert.equal(coreFile().ledger[0]!.formerOwners, undefined)
      await core({ note: 'no owner given: no change' })
      assert.equal(coreFile().ledger[0]!.formerOwners, undefined)
      await core({ owner: 'claude-code:acme-b' })
      assert.deepEqual(coreFile().ledger[0]!.formerOwners, ['Claude-Code:ACME-A'])
      // A → B → A → B: each owner once, the latest to leave last.
      await core({ owner: 'claude-code:acme-a' })
      await core({ owner: 'claude-code:acme-b' })
      for (const one of both()) assert.deepEqual(one.formerOwners, ['claude-code:acme-b', 'claude-code:acme-a'])
      // Left with no owner: the one it leaves is kept; from no owner, nothing is.
      await core({ owner: '' })
      await core({ owner: 'claude-code:acme-c' })
      for (const one of both()) assert.deepEqual(one.formerOwners, ['claude-code:acme-a', 'claude-code:acme-b'])
    })

    test('the mod and the core taking turns on one item lose nothing', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Add the Acme coupon field', owner: 'local_acme_a' })
      await mod({ owner: 'local_acme_b' }, { acmeLater: 1 })
      await core({ owner: 'claude-code:acme-c' })
      await mod({ note: 'Acme review on Friday' })
      await core({ criteria: 'ACME10 takes 10% off' })
      await mod({ owner: 'local_acme_a' })
      await core({ owner: 'local_acme_b' })
      const loaded = (await loadProject(ref, w.env)).ledger[0]! as CoreItem & { acmeLater?: unknown }
      for (const one of [...both(), loaded] as (CoreItem & { acmeLater?: unknown })[]) {
        assert.equal(one.owner, 'local_acme_b')
        // A → B (mod), B → C (core), C → A (mod), A → B (core): each once, the latest to leave last.
        assert.deepEqual(one.formerOwners, ['local_acme_b', 'claude-code:acme-c', 'local_acme_a'])
        assert.equal(one.note, 'Acme review on Friday')
        assert.equal(one.criteria, 'ACME10 takes 10% off')
        assert.equal(one.acmeLater, 1)
        assert.ok(one.uid)
      }
      // The shared board (hooks/sessions isHandedOff) reads it: C handed it over; B, its owner again, still holds it.
      const ledger = [loaded]
      assert.equal(isHandedOff('claude-code:acme-c', ledger), true)
      assert.equal(isHandedOff('local_acme_b', ledger), false)
    })
  })
}

describe('E2: the v1.1 mod and the core take turns on one project', () => {
  let w: World
  let ref: ProjectRef
  beforeEach(async () => {
    w = world('en', { legacy: true })
    ref = (await resolveProject(w.repo))!
  })
  afterEach(() => w.done())

  const read = (file: string) => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as CoreProject) : null)
  /**
   * The v1.1 mod (hooks/actions.ts): reads both copies merged as the core does (hooks/core.ts mergedProject, which is
   * mergeLegacy), changes what the mod changes, and writes its own copy whole (it never writes the core's: E2).
   */
  const mod = async (id: number, change: Partial<CoreItem>) => {
    await new Promise(resolve => setTimeout(resolve, 20))
    const legacyFile = paths(w.env).legacyProject(ref)
    const coreFile = paths(w.env).project(ref)
    const legacy = read(legacyFile)
    const core = read(coreFile)
    const isLegacyNewer = !!legacy && !!core && statSync(legacyFile).mtimeMs > statSync(coreFile).mtimeMs
    const both = core && legacy ? mergeLegacy(core, legacy, isLegacyNewer) : (core ?? legacy)!
    w.advance(1_000)
    const now = w.ctx().now()
    both.ledger = both.ledger.map(i => (i.id === id ? { ...i, ...change, updatedAt: now } : i))
    writeFileSync(legacyFile, JSON.stringify(both, null, 2))
  }
  test('20 turns each way lose no field, and the mod\'s copy alone still reads as v1.0 reads it', async () => {
    for (const text of ['Acme coupon field', 'Acme tax rounding']) await ledgerTool(w.ctx('local_pm'), { action: 'add', text, owner: 'local_dev', criteria: 'Acme tests pass' })
    const sha = w.commit('coupon.txt', 'ACME10\n', 'Add the coupon field')
    for (let turn = 0; turn < 20; turn++) {
      const id = (turn % 2) + 1
      await mod(id, { note: `Acme note ${turn}` })
      w.advance(10_000)
      const out = await ledgerTool(w.ctx('local_pm'), { action: 'update', id, commit: sha, ...(turn === 10 ? { qa: 'pass', qa_by: 'local_qa', qa_note: 'Acme checks pass' } : {}) })
      assert.ok(!('error' in out.structured), out.text)
    }
    const core = read(paths(w.env).project(ref))!
    const legacy = read(paths(w.env).legacyProject(ref))!
    for (const copy of [core, legacy, await loadProject(ref, w.env)]) {
      assert.equal(copy.ledger.length, 2)
      for (const one of copy.ledger) {
        // The core's fields…
        assert.ok(one.uid)
        assert.equal(one.createdBy?.actor, 'local_pm')
        assert.ok((one.rev ?? 0) >= 11, String(one.rev))
        assert.deepEqual(one.commits, [sha])
        // …and the mod's, the last of each kept.
        assert.equal(one.owner, 'local_dev')
        assert.equal(one.criteria, 'Acme tests pass')
        assert.equal(one.note, `Acme note ${one.id === 1 ? 18 : 19}`)
      }
      assert.equal(copy.ledger.find(i => i.id === 1)!.qa?.result, 'pass')
    }
    // Back to v1.0 (the core removed): its folder alone holds every item with every field v1.0 reads.
    for (const one of legacy.ledger) for (const field of ['id', 'text', 'owner', 'status', 'note', 'createdAt', 'updatedAt', 'criteria']) assert.ok(field in one, field)
  })
})

describe('E1 merge: no field is lost, whichever copy stands', () => {
  test('the mod\'s copy stands: every field the mod does not know comes back from the core\'s, and formerOwners from both', () => {
    const ours = { ...item(1, { updatedAt: 10, uid: 'u1', formerOwners: ['local_acme_a'] }), acmeCoreLater: 'x' } as CoreItem
    const theirs = item(1, { updatedAt: 20, owner: 'local_acme_c', formerOwners: ['local_acme_b'] })
    const [one] = mergeLegacy(project([ours]), project([theirs]), true).ledger as (CoreItem & { acmeCoreLater?: string })[]
    assert.equal(one!.owner, 'local_acme_c')
    assert.equal(one!.acmeCoreLater, 'x')
    assert.deepEqual(one!.formerOwners, ['local_acme_b', 'local_acme_a'])
  })

  test('the core\'s copy stands: a field only a newer mod knows, and its formerOwners, are kept', () => {
    const ours = item(1, { updatedAt: 20, owner: 'local_acme_c', formerOwners: ['local_acme_a'] })
    const theirs = { ...item(1, { updatedAt: 10, formerOwners: ['local_acme_b'] }), acmeModLater: 2 } as CoreItem
    const [one] = mergeLegacy(project([ours]), project([theirs]), false).ledger as (CoreItem & { acmeModLater?: number })[]
    assert.equal(one!.owner, 'local_acme_c')
    assert.equal(one!.acmeModLater, 2)
    assert.deepEqual(one!.formerOwners, ['local_acme_a', 'local_acme_b'])
  })

  test('what the core cleared on purpose is not brought back from the mod\'s older copy', () => {
    const ours = item(1, { updatedAt: 20 })
    const theirs = item(1, { updatedAt: 10, criteria: 'old', qa: { result: 'pass', by: 'agent:q', at: 5, note: '' } })
    const [one] = mergeLegacy(project([ours]), project([theirs]), false).ledger
    assert.equal(one!.criteria, undefined)
    assert.equal(one!.qa, undefined)
  })
})
