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

import { projectSessions } from '../src/actors'
import { guidelinesSetting, readGuidelines } from '../src/hook'
import { dataHome } from '../src/host'
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

/** A desktop PM's round in the mod's folder of `home`: the desktop app's list, one session in the Acme repo. */
function modRound(home: string, pmId: string, sessionId: string, cwd: string) {
  const file = join(home, '.claude', 'project-pm', 'rounds', `${pmId}.json`)
  mkdirSync(join(file, '..'), { recursive: true })
  const session = { id: sessionId, title: 'Acme coupon field', cwd, isRunning: true, lastActivityAt: new Date(NOW).toISOString(), isPinned: false, hasOpenPr: false }
  writeFileSync(file, JSON.stringify({ sessions: { list: [session], fetchedAt: NOW, error: null }, lastWords: {}, ciChecks: {}, pushChecks: {} }))
}

describe('the desktop round and the data home come from the env\'s home folder too (T-54)', () => {
  let w: World
  let demoHome: string
  beforeEach(() => {
    // The person's "real" home is w.home (os.homedir() reads it); the demo has a home of its own next to its repo.
    w = world('en', { legacy: true })
    demoHome = join(w.root, 'demo', 'home')
    mkdirSync(join(demoHome, '.claude', 'project-pm'), { recursive: true })
    assert.equal(homedir(), w.home)
  })
  afterEach(() => w.done())

  test('a desktop PM\'s round is read from the mod\'s folder of the env\'s home, not the real one', async () => {
    modRound(w.home, 'local_pm', 'local_real', w.repo)
    modRound(demoHome, 'local_pm', 'local_demo', w.repo)
    const ref = (await resolveProject(w.repo))!
    const env = { ...w.env, USERPROFILE: demoHome, HOME: demoHome }
    const found = await projectSessions(ref, [], env, 'local_pm', Date.now())
    assert.deepEqual(found.sessions.map(s => s.id), ['local_demo'])
    // HOME alone, as on macOS and Linux.
    const onlyHome: NodeJS.ProcessEnv = { ...w.env, HOME: demoHome }
    delete onlyHome.USERPROFILE
    assert.deepEqual((await projectSessions(ref, [], onlyHome, 'local_pm', Date.now())).sessions.map(s => s.id), ['local_demo'])
  })

  test('with no PROJECT_PM_HOME, the core keeps its data in .project-pm of the env\'s home, and none in the real one', async () => {
    const realCore = join(w.home, '.project-pm')
    const realMod = join(w.home, '.claude', 'project-pm')
    const before = { core: snapshot(realCore), mod: snapshot(realMod) }
    const env: NodeJS.ProcessEnv = { ...w.env, USERPROFILE: demoHome, HOME: demoHome }
    delete env.PROJECT_PM_HOME
    assert.equal(dataHome(env), join(demoHome, '.project-pm'))
    const ref = (await resolveProject(w.repo))!
    assert.equal(paths(env).project(ref), join(demoHome, '.project-pm', 'projects', `${ref.file}.json`))
    await pmTool(w.ctx('claude-code:pm-acme', { env }), { action: 'claim' })
    await ledgerTool(w.ctx('claude-code:pm-acme', { env }), { action: 'add', text: 'Add a coupon field to checkout' })
    const kept = JSON.parse(readFileSync(paths(env).project(ref), 'utf8')) as { ledger: { text: string }[] }
    assert.deepEqual(kept.ledger.map(i => i.text), ['Add a coupon field to checkout'])
    assert.deepEqual([...snapshot(realCore)], [...before.core])
    assert.deepEqual([...snapshot(realMod)], [...before.mod])
    // USERPROFILE first, HOME second, as legacyHome.
    const a = join(w.root, 'a')
    const b = join(w.root, 'b')
    assert.equal(dataHome({ USERPROFILE: a, HOME: b }), join(a, '.project-pm'))
    assert.equal(dataHome({ HOME: b }), join(b, '.project-pm'))
    assert.equal(dataHome({ USERPROFILE: a, HOME: b, PROJECT_PM_HOME: join(w.root, 'pm') }), join(w.root, 'pm'))
  })

  test('nothing set: the data stays in ~/.project-pm and ~/.claude/project-pm, and the round is read there, as before', async () => {
    // The env of a person's Claude Code: its home is the one os.homedir() gives; or no home in it at all.
    const asBefore = { ...w.env }
    delete asBefore.PROJECT_PM_HOME
    const bare: NodeJS.ProcessEnv = {}
    for (const env of [asBefore, bare]) {
      assert.equal(dataHome(env), join(w.home, '.project-pm'))
      assert.equal(paths(env).legacy, join(w.home, '.claude', 'project-pm'))
    }
    modRound(w.home, 'local_pm', 'local_real', w.repo)
    const ref = (await resolveProject(w.repo))!
    for (const env of [asBefore, bare]) assert.deepEqual((await projectSessions(ref, [], env, 'local_pm', Date.now())).sessions.map(s => s.id), ['local_real'])
  })

  test('~ in the person\'s config.json guidelines is the env\'s home, as the mod reads it (hooks/guidelines.ts)', async () => {
    writeFileSync(join(w.home, 'acme-rules.md'), 'Acme real rule.\n')
    writeFileSync(join(demoHome, 'acme-rules.md'), 'Acme demo rule.\n')
    const ref = (await resolveProject(w.repo))!
    const config = (env: NodeJS.ProcessEnv) => {
      mkdirSync(dataHome(env), { recursive: true })
      writeFileSync(join(dataHome(env), 'config.json'), JSON.stringify({ guidelines: '~/acme-rules.md' }))
    }
    const slash = (path: string) => path.replace(/\\/g, '/')
    // A demo with a home of its own: its own file, never the real one.
    const demo: NodeJS.ProcessEnv = { ...w.env, PROJECT_PM_HOME: join(w.root, 'demo', 'pmhome'), USERPROFILE: demoHome, HOME: demoHome }
    config(demo)
    const found = await readGuidelines(ref, demo)
    assert.ok(found && 'text' in found, JSON.stringify(found))
    assert.equal(found.text, 'Acme demo rule.')
    assert.equal(slash(found.file), slash(join(demoHome, 'acme-rules.md')))
    assert.deepEqual(await guidelinesSetting(ref, demo), { from: 'user', file: slash(join(demoHome, 'acme-rules.md')) })
    // Nothing set: ~ is the home os.homedir() gives, as before.
    const asBefore: NodeJS.ProcessEnv = { ...w.env }
    delete asBefore.PROJECT_PM_HOME
    for (const env of [asBefore, {}]) {
      config(env)
      const mine = await readGuidelines(ref, env)
      assert.ok(mine && 'text' in mine && mine.text === 'Acme real rule.', JSON.stringify(mine))
    }
  })
})
