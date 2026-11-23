/**
 * Demo and test data stay in the data home they were given (T-53). A demo seeded with PROJECT_PM_HOME alone once
 * wrote its project into the mod's folder of the person's real home: the core found that folder through the home
 * folder, not through the data home it had been given. Here the "real" home is a temporary one too (world()).
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { serve } from '../src/http'
import { resolveProject } from '../src/project'
import { changeActor, paths } from '../src/store'
import { ledgerTool, pmTool, reportTool } from '../src/tools'
import type { World } from './helpers'
import { NOW, hostWith, world } from './helpers'

/** Every file under `dir` (relative path → size and mtime), so a new or changed file shows. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (at: string, rel: string) => {
    if (!existsSync(at)) return
    for (const name of readdirSync(at)) {
      const full = join(at, name)
      const s = statSync(full)
      if (s.isDirectory()) walk(full, `${rel}${name}/`)
      else out.set(`${rel}${name}`, `${s.size}:${s.mtimeMs}`)
    }
  }
  walk(dir, '')

  return out
}

function get(port: number, path: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}` } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve(text))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('a demo seeded with its own data home (T-53)', () => {
  let w: World
  beforeEach(() => {
    // The mod is installed in this (temporary) home: its folder ~/.claude/project-pm exists, as on the person's machine.
    w = world('en', { legacy: true })
  })
  afterEach(() => w.done())

  test('writes nothing into the home folder\'s ~/.claude/project-pm or ~/.project-pm', async () => {
    const modDir = join(w.home, '.claude', 'project-pm')
    const coreDir = join(w.home, '.project-pm')
    mkdirSync(join(modDir, 'sessions'), { recursive: true })
    writeFileSync(join(modDir, 'sessions', 'local_existing.json'), '{"id":"local_existing"}')
    const before = { mod: snapshot(modDir), core: snapshot(coreDir) }
    // As the screenshot session's seed did: PROJECT_PM_HOME next to the demo repo, the home folder left as it is.
    const pmhome = join(w.root, 'demo', 'pmhome')
    const env = { ...w.env, PROJECT_PM_HOME: pmhome }
    const ctx = (actor: string) => w.ctx(actor, { env })
    await pmTool(ctx('claude-code:pm-acme'), { action: 'claim' })
    await ledgerTool(ctx('claude-code:pm-acme'), { action: 'add', text: 'Add a coupon field to checkout', owner: 'claude-code:dev-coupon' })
    await ledgerTool(ctx('claude-code:pm-acme'), { action: 'update', id: 1, note: 'Acme copy' })
    await changeActor('claude-code:dev-coupon', () => ({ id: 'claude-code:dev-coupon', tool: 'claude-code', title: 'Coupon field', cwd: w.repo, lastSeenAt: NOW, state: 'idle' }), env)
    await reportTool(ctx('claude-code:dev-coupon'), { status: 'in_progress', summary: 'Coupon field wired in.' })

    assert.deepEqual([...snapshot(modDir)], [...before.mod])
    assert.deepEqual([...snapshot(coreDir)], [...before.core])
    // The demo's data is all in its own data home.
    const ref = (await resolveProject(w.repo))!
    const kept = JSON.parse(readFileSync(paths(env).project(ref), 'utf8'))
    assert.equal(kept.pmId, 'claude-code:pm-acme')
    assert.equal(kept.ledger[0].text, 'Add a coupon field to checkout')
  })
})

describe('the person\'s own data, with no PROJECT_PM_HOME (T-53)', () => {
  let w: World
  beforeEach(() => {
    w = world('en', { legacy: true })
  })
  afterEach(() => w.done())

  test('a project only the mod has still shows on the board, and the core still writes it back to the mod\'s folder', async () => {
    const env = { ...w.env }
    delete env.PROJECT_PM_HOME
    const ref = (await resolveProject(w.repo))!
    const modFile = join(w.home, '.claude', 'project-pm', 'projects', `${ref.file}.json`)
    assert.equal(paths(env).legacyProject(ref), modFile)
    assert.equal(paths(env).project(ref), join(w.home, '.project-pm', 'projects', `${ref.file}.json`))
    writeFileSync(modFile, JSON.stringify({ key: ref.key, name: ref.name, path: ref.path, pmId: 'local_pm', isDismissed: false, nextId: 2, ledger: [
      { id: 1, text: 'Acme coupon field', owner: null, status: 'open', note: '', createdAt: NOW, updatedAt: NOW },
    ] }))
    const served = await serve({ port: 0, env, ctx: { run: hostWith(), cwd: w.repo, now: () => NOW } })
    try {
      const listed = JSON.parse(await get(served.info.port, '/api/projects', served.info.token)) as { projects: { key: string; open: number }[] }
      assert.deepEqual(listed.projects.map(p => [p.key, p.open]), [[ref.key, 1]])
      const board = JSON.parse(await get(served.info.port, `/api/board?p=${encodeURIComponent(ref.key)}`, served.info.token)) as { items: { text: string }[] }
      assert.deepEqual(board.items.map(i => i.text), ['Acme coupon field'])
    } finally {
      await served.close()
    }
    await ledgerTool(w.ctx('local_pm', { env }), { action: 'add', text: 'Acme order emails' })
    const back = JSON.parse(readFileSync(modFile, 'utf8')) as { ledger: { text: string }[] }
    assert.deepEqual(back.ledger.map(i => i.text), ['Acme coupon field', 'Acme order emails'])
  })
})
