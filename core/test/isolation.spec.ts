/**
 * Demo and test data stay in the folders they were given (T-53). A demo seeded with PROJECT_PM_HOME once wrote its
 * project into the mod's folder of the person's real home. The mod's folder is found as the mod finds it
 * (hooks/actions.ts dataDir: USERPROFILE, else HOME, then .claude/project-pm), from the env the core is given, so a
 * demo isolates itself with a temporary USERPROFILE and HOME next to PROJECT_PM_HOME (docs/design/v1.1-plan.md).
 * Here the person's "real" home is a temporary one too: world() points the process's HOME and USERPROFILE at it,
 * which is what os.homedir() reads.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { serve } from '../src/http'
import type { ProjectRef } from '../src/project'
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

/** A project only the mod has (v1.0, the desktop app), in the mod's file. */
function modProject(file: string, ref: ProjectRef) {
  writeFileSync(file, JSON.stringify({ key: ref.key, name: ref.name, path: ref.path, pmId: 'local_pm', isDismissed: false, nextId: 2, ledger: [
    { id: 1, text: 'Acme coupon field', owner: null, status: 'open', note: '', createdAt: NOW, updatedAt: NOW },
  ] }))
}

/** The board lists the project with one open item, and its ledger shows the mod's item; then a core write reaches the mod's file. */
async function boardShowsAndWritesBack(w: World, env: NodeJS.ProcessEnv, ref: ProjectRef, modFile: string) {
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
}

describe('the mod\'s folder is found as the mod finds it (T-53)', () => {
  let w: World
  let modDir: string
  beforeEach(() => {
    // The mod is installed in this (temporary) home: its folder ~/.claude/project-pm exists, as on the person's machine.
    w = world('en', { legacy: true })
    modDir = join(w.home, '.claude', 'project-pm')
    assert.equal(homedir(), w.home)
  })
  afterEach(() => w.done())

  test('a demo seeded with a temporary home in its env writes nothing into the real ~/.claude/project-pm or ~/.project-pm', async () => {
    const coreDir = join(w.home, '.project-pm')
    mkdirSync(join(modDir, 'sessions'), { recursive: true })
    writeFileSync(join(modDir, 'sessions', 'local_existing.json'), '{"id":"local_existing"}')
    const before = { mod: snapshot(modDir), core: snapshot(coreDir) }
    // As a seed script would: its data home and a home folder of its own next to the demo repo, in the core's env.
    const demo = join(w.root, 'demo')
    const demoHome = join(demo, 'home')
    mkdirSync(join(demoHome, '.claude', 'project-pm'), { recursive: true })
    const env = { ...w.env, PROJECT_PM_HOME: join(demo, 'pmhome'), USERPROFILE: demoHome, HOME: demoHome }
    const ctx = (actor: string) => w.ctx(actor, { env })
    await pmTool(ctx('claude-code:pm-acme'), { action: 'claim' })
    await ledgerTool(ctx('claude-code:pm-acme'), { action: 'add', text: 'Add a coupon field to checkout', owner: 'claude-code:dev-coupon' })
    await ledgerTool(ctx('claude-code:pm-acme'), { action: 'update', id: 1, note: 'Acme copy' })
    await changeActor('claude-code:dev-coupon', () => ({ id: 'claude-code:dev-coupon', tool: 'claude-code', title: 'Coupon field', cwd: w.repo, lastSeenAt: NOW, state: 'idle' }), env)
    await reportTool(ctx('claude-code:dev-coupon'), { status: 'in_progress', summary: 'Coupon field wired in.' })

    assert.deepEqual([...snapshot(modDir)], [...before.mod])
    assert.deepEqual([...snapshot(coreDir)], [...before.core])
    // The demo's data is all in its own folders: the data home, and the mod's folder of its own home.
    const ref = (await resolveProject(w.repo))!
    assert.equal(paths(env).legacyProject(ref), join(demoHome, '.claude', 'project-pm', 'projects', `${ref.file}.json`))
    for (const file of [paths(env).project(ref), paths(env).legacyProject(ref)]) {
      const kept = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(kept.pmId, 'claude-code:pm-acme')
      assert.equal(kept.ledger[0].text, 'Add a coupon field to checkout')
    }
  })

  test('with no PROJECT_PM_HOME, a project only the mod has shows on the board and is written back as before', async () => {
    const env = { ...w.env }
    delete env.PROJECT_PM_HOME
    const ref = (await resolveProject(w.repo))!
    const modFile = join(modDir, 'projects', `${ref.file}.json`)
    assert.equal(paths(env).legacyProject(ref), modFile)
    assert.equal(paths(env).project(ref), join(w.home, '.project-pm', 'projects', `${ref.file}.json`))
    modProject(modFile, ref)
    await boardShowsAndWritesBack(w, env, ref, modFile)
  })

  test('PROJECT_PM_HOME set elsewhere still reads and writes the real ~/.claude/project-pm', async () => {
    const env = { ...w.env, PROJECT_PM_HOME: join(w.root, 'elsewhere', 'pm') }
    const ref = (await resolveProject(w.repo))!
    const modFile = join(modDir, 'projects', `${ref.file}.json`)
    assert.equal(paths(env).legacyProject(ref), modFile)
    modProject(modFile, ref)
    await boardShowsAndWritesBack(w, env, ref, modFile)
    assert.ok(existsSync(join(w.root, 'elsewhere', 'pm', 'projects', `${ref.file}.json`)))
  })

  test('CLAUDE_CONFIG_DIR does not move it: the mod keeps its data under the home folder whatever Claude\'s folder is', async () => {
    const config = join(w.root, 'claude-config')
    mkdirSync(join(config, 'project-pm', 'projects'), { recursive: true })
    const env = { ...w.env, CLAUDE_CONFIG_DIR: config }
    const ref = (await resolveProject(w.repo))!
    const modFile = join(modDir, 'projects', `${ref.file}.json`)
    assert.equal(paths(env).legacyProject(ref), modFile)
    modProject(modFile, ref)
    await boardShowsAndWritesBack(w, env, ref, modFile)
    assert.deepEqual(readdirSync(join(config, 'project-pm', 'projects')), [])
  })

  test('USERPROFILE comes first and HOME second, as in the mod', () => {
    const a = join(w.root, 'a')
    const b = join(w.root, 'b')
    assert.equal(paths({ USERPROFILE: a, HOME: b }).legacy, join(a, '.claude', 'project-pm'))
    assert.equal(paths({ HOME: b }).legacy, join(b, '.claude', 'project-pm'))
    assert.equal(paths({}).legacy, join(w.home, '.claude', 'project-pm'))
  })
})
