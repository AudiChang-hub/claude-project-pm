/**
 * The guidelines snapshot (guard.ts) on its own: what it will not write through, and how long the board lists a
 * restore (T-39 QA).
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { RESTORE_SHOWN_MS, checkGuidelines, guidelinesRestores, keepGuidelines } from '../src/guard'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import type { World } from './helpers'
import { NOW, world } from './helpers'

describe('the guidelines snapshot', () => {
  let w: World
  let ref: ProjectRef
  beforeEach(async () => {
    w = world('en')
    ref = (await resolveProject(w.repo))!
  })
  afterEach(() => w.done())

  test('a folder swapped for a link since the snapshot is not written through: the change is reported, not undone', async () => {
    const rules = join(w.root, 'rules')
    mkdirSync(rules)
    const file = join(rules, 'acme.md')
    writeFileSync(file, '1. Tests first.\n')
    await keepGuidelines(file, w.env, NOW)
    // The folder becomes a link to another folder whose file of the same name must not be overwritten.
    renameSync(rules, join(w.root, 'rules-before'))
    mkdirSync(join(w.root, 'other'))
    writeFileSync(join(w.root, 'other', 'acme.md'), 'someone else\'s file\n')
    symlinkSync(join(w.root, 'other'), rules, process.platform === 'win32' ? 'junction' : 'dir')
    const restore = await checkGuidelines(ref, file, 'claude-code:s1', false, NOW, w.env, NOW + 1000)
    assert.equal(restore?.isRestored, false)
    assert.equal(readFileSync(join(w.root, 'other', 'acme.md'), 'utf8'), 'someone else\'s file\n')
    assert.equal(readFileSync(restore!.backup!, 'utf8'), 'someone else\'s file\n')
    assert.equal((await guidelinesRestores(ref, w.env, NOW + 1000)).length, 1)
  })

  test('the board lists a restore for a week, then no more', async () => {
    const file = join(w.root, 'acme.md')
    writeFileSync(file, '1. Tests first.\n')
    await keepGuidelines(file, w.env, NOW)
    writeFileSync(file, 'changed\n')
    const restore = await checkGuidelines(ref, file, 'claude-code:s1', false, NOW, w.env, NOW + 1000)
    assert.equal(restore?.isRestored, true)
    assert.equal(readFileSync(file, 'utf8'), '1. Tests first.\n')
    assert.equal((await guidelinesRestores(ref, w.env, NOW + 1000 + RESTORE_SHOWN_MS - 1)).length, 1)
    assert.equal((await guidelinesRestores(ref, w.env, NOW + 1000 + RESTORE_SHOWN_MS)).length, 0)
  })

  test('a snapshot from before the person last spoke judges nothing: it is only taken again', async () => {
    const file = join(w.root, 'acme.md')
    writeFileSync(file, '1. Tests first.\n')
    await keepGuidelines(file, w.env, NOW)
    writeFileSync(file, 'changed\n')
    assert.equal(await checkGuidelines(ref, file, 'claude-code:s1', false, NOW + 1, w.env, NOW + 1000), null)
    assert.equal(readFileSync(file, 'utf8'), 'changed\n')
    // Taken again: from now on that is what is checked against.
    writeFileSync(file, 'changed again\n')
    assert.equal((await checkGuidelines(ref, file, 'claude-code:s1', false, NOW + 1, w.env, NOW + 2000))?.isRestored, true)
    assert.equal(readFileSync(file, 'utf8'), 'changed\n')
  })
})
