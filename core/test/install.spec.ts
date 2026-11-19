/**
 * init and uninstall (docs/design/v1-core.md 5): init changes nothing without --yes, and init → uninstall leaves
 * every file exactly as it was. Claude Code's settings are written to a fake home folder, and Claude Code's own
 * command line is stood in for (fakeClaude), so nothing touches the person's real settings.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import type { InstallEnv } from '../src/install'
import { AGENTS_LIMIT, END, binPath, mcpLauncher, SECTION_LIMIT, START, agentsSection, init, readLog, shCommand, skillText, uninstall, withBlock, withoutBlock } from '../src/install'
import { ct } from '../src/messages'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import type { World } from './helpers'
import { LANGS, fakeClaude, git, hostWith, world } from './helpers'

/** Every file under `dir` (but the core's own data folder and git's objects), with its bytes and, off Windows, its mode. */
function snapshot(...dirs: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (root: string, dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (name === '.project-pm' || name === 'objects' || name === 'logs') continue
      const stat = statSync(full)
      if (stat.isDirectory()) {
        out[`${relative(root, full)}/`] = ''
        walk(root, full)
      } else out[relative(root, full)] = `${process.platform === 'win32' ? '' : (stat.mode & 0o777).toString(8)}:${readFileSync(full).toString('base64')}`
    }
  }
  for (const dir of dirs) walk(join(dir, '..'), dir)

  return out
}

for (const lang of LANGS) {
  describe(`init and uninstall (${lang})`, () => {
    let w: World
    let ref: ProjectRef
    let said: string[]
    const say = (text: string) => said.push(text)
    const ie = (extra: Partial<InstallEnv> = {}): InstallEnv => ({ env: w.env, run: fakeClaude(w.home, hostWith()), home: w.home, self: ['C:\\Program Files\\Acme Tools\\project-pm.exe'], exe: null, now: Date.now(), ...extra })
    const claude = () => join(w.home, '.claude')
    const write = (file: string, text: string) => {
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, text)
    }
    const roundTrip = async (extra: Partial<InstallEnv> = {}) => {
      const before = snapshot(w.home, w.repo)
      const out = await init(ref, ie(extra), { yes: true, ci: false }, say)
      assert.deepEqual(out.failed, [])
      assert.notDeepEqual(snapshot(w.home, w.repo), before)
      const undone = await uninstall(ref, ie(extra), { yes: true, hooksOnly: false }, say)
      assert.ok(undone > 0)
      assert.deepEqual(snapshot(w.home, w.repo), before)
      assert.deepEqual((await readLog(w.env)).entries, [])

      return out
    }

    beforeEach(async () => {
      w = world(lang)
      said = []
      ref = (await resolveProject(w.repo))!
      // Someone who already uses Claude Code: its config and settings with their own hook.
      write(join(w.home, '.claude.json'), `${JSON.stringify({ numStartups: 3 }, null, 2)}\n`)
      write(join(claude(), 'settings.json'), `${JSON.stringify({ model: 'opus', hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'acme-notify' }] }] } }, null, 2)}\n`)
    })
    afterEach(() => w.done())

    test('init without --yes only lists the changes, in words, and changes nothing', async () => {
      const before = snapshot(w.home, w.repo)
      const out = await init(ref, ie(), { yes: false, ci: true }, say)
      assert.deepEqual(out.applied, [])
      assert.deepEqual(snapshot(w.home, w.repo), before)
      assert.ok(!existsSync(join(w.env.PROJECT_PM_HOME!, 'install-log.json')))
      const text = said.join('\n')
      assert.ok(text.includes(ct('init.heading', { project: 'acme-shop', path: ref.path })))
      assert.ok(text.includes(ct('init.dryRun')))
      assert.ok(text.includes(join(w.repo, 'AGENTS.md')))
      assert.ok(text.includes('claude mcp add --scope user project-pm -- "C:/Program Files/Acme Tools/project-pm.exe" mcp'))
      assert.ok(text.includes('project-pm-qa.yml'))
    })

    test('no CLAUDE.md, no AGENTS.md: init writes every piece, uninstall leaves the very same files', async () => {
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      const agents = readFileSync(join(w.repo, 'AGENTS.md'), 'utf8')
      assert.equal(agents, `${agentsSection(false)}\n`)
      assert.ok(Buffer.byteLength(agentsSection(false)) <= SECTION_LIMIT)
      assert.ok(!existsSync(join(w.repo, 'CLAUDE.md')))
      assert.equal(readFileSync(join(claude(), 'skills', 'project-pm', 'SKILL.md'), 'utf8'), skillText())
      const settings = JSON.parse(readFileSync(join(claude(), 'settings.json'), 'utf8'))
      assert.equal(settings.model, 'opus')
      assert.deepEqual(settings.hooks.Stop.map((g: { hooks: { command: string }[] }) => g.hooks[0]!.command), ['acme-notify', '"C:/Program Files/Acme Tools/project-pm.exe" hook claude-code Stop'])
      assert.deepEqual(Object.keys(settings.hooks).sort(), ['PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit'])
      assert.deepEqual(JSON.parse(readFileSync(join(w.home, '.claude.json'), 'utf8')).mcpServers['project-pm'], { command: 'C:\\Program Files\\Acme Tools\\project-pm.exe', args: ['mcp'] })
      assert.ok(readFileSync(join(w.repo, '.git', 'hooks', 'pre-push'), 'utf8').includes('"C:/Program Files/Acme Tools/project-pm.exe" check pre-push'))
      assert.equal(git(w.repo, 'config', '--local', '--get', 'alias.pm'), '!"C:/Program Files/Acme Tools/project-pm.exe"')
      assert.ok(said.join('\n').includes(ct('init.done', { n: 6 })))
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
    })

    test('a CLAUDE.md that already reads @AGENTS.md, and an AGENTS.md without a last newline, come back byte for byte', async () => {
      write(join(w.repo, 'CLAUDE.md'), '# Acme\n\n@AGENTS.md\n')
      write(join(w.repo, 'AGENTS.md'), '# Acme agents\nUse pnpm.')
      await roundTrip()
      assert.equal(readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8'), '# Acme\n\n@AGENTS.md\n')
    })

    test('a CLAUDE.md without @AGENTS.md (CRLF) gets the line at its top, and loses it again', async () => {
      write(join(w.repo, 'CLAUDE.md'), '# Acme\r\nShip on Fridays.\r\n')
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      assert.ok(readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8').startsWith(`${START}\n@AGENTS.md\n${END}\n# Acme\r\n`))
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
    })

    test('a pre-push hook already there becomes pre-push.local, and goes back', async () => {
      const own = join(w.repo, '.git', 'hooks', 'pre-push')
      write(own, '#!/bin/sh\nnpm run lint\n')
      chmodSync(own, 0o755)
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      assert.equal(readFileSync(join(w.repo, '.git', 'hooks', 'pre-push.local'), 'utf8'), '#!/bin/sh\nnpm run lint\n')
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
    })

    test('another git alias pm is left alone, and the note gives the full command instead', async () => {
      git(w.repo, 'config', '--local', 'alias.pm', 'push origin main')
      const out = await roundTrip()
      assert.ok(out.notes.includes(ct('init.aliasTaken', { value: 'push origin main', command: '"C:/Program Files/Acme Tools/project-pm.exe" skip "…"' })))
      assert.equal(git(w.repo, 'config', '--local', '--get', 'alias.pm'), 'push origin main')
    })

    test('init run twice adds nothing twice, and uninstall still gives back the first state', async () => {
      write(join(w.repo, 'AGENTS.md'), '# Acme agents\n')
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      const once = snapshot(w.home, w.repo)
      await init(ref, ie({ now: Date.now() + 1000 }), { yes: true, ci: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), once)
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
    })

    test('a file changed after init loses only what init put in', async () => {
      write(join(w.repo, 'AGENTS.md'), '# Acme agents\n')
      await init(ref, ie(), { yes: true, ci: false }, say)
      const agents = join(w.repo, 'AGENTS.md')
      writeFileSync(agents, `${readFileSync(agents, 'utf8')}\nRun the Acme tests first.\n`)
      const settings = join(claude(), 'settings.json')
      writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), theme: 'dark' }))
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.equal(readFileSync(agents, 'utf8'), '# Acme agents\n\nRun the Acme tests first.\n')
      const left = JSON.parse(readFileSync(settings, 'utf8'))
      assert.equal(left.theme, 'dark')
      assert.deepEqual(left.hooks, { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'acme-notify' }] }] })
    })

    test('with the desktop mod installed, neither the MCP server nor the hooks go in (3.7)', async () => {
      write(join(claude(), 'local-mods', 'project-pm', '.claude-plugin', 'plugin.json'), '{"name":"project-pm"}\n')
      const out = await roundTrip()
      assert.ok(out.notes.includes(ct('init.modInstalled')))
      assert.ok(!out.applied.some(d => d.kind === 'mcp' || d.kind === 'hooks'))
    })

    test('without Claude Code, init says so and still sets up git and AGENTS.md', async () => {
      const out = await roundTrip({ run: fakeClaude(w.home, hostWith(), { installed: false }) })
      assert.ok(out.notes.includes(ct('init.noClaude')))
      assert.ok(!out.applied.some(d => d.kind === 'mcp'))
      assert.ok(out.applied.some(d => d.kind === 'prepush'))
    })

    test('a project-pm MCP server init did not add is left alone', async () => {
      writeFileSync(join(w.home, '.claude.json'), `${JSON.stringify({ numStartups: 3, mcpServers: { 'project-pm': { command: 'npx', args: ['-y', 'project-pm@0.9.0', 'mcp'] } } }, null, 2)}\n`)
      const out = await roundTrip()
      assert.ok(out.notes.includes(ct('init.mcpTaken')))
    })

    test('--ci adds the QA workflow, and uninstall takes it and its folders out', async () => {
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: true }, say)
      assert.ok(readFileSync(join(w.repo, '.github', 'workflows', 'project-pm-qa.yml'), 'utf8').startsWith('# project-pm:start v1'))
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
    })

    test('a long AGENTS.md chain gets the one-line section', async () => {
      write(join(w.repo, 'AGENTS.md'), `# Acme\n${'Acme rule.\n'.repeat(Math.ceil(AGENTS_LIMIT / 11))}`)
      const out = await roundTrip()
      assert.ok(out.notes.includes(ct('init.agentsLong')))
      assert.ok(said.join('\n').includes(agentsSection(true).split('\n')[1]!))
    })

    test('uninstall in one project keeps what another project still uses', async () => {
      const other = join(w.root, 'acme-admin')
      mkdirSync(other)
      git(other, 'init', '-q', '-b', 'main')
      const otherRef = (await resolveProject(other))!
      const before = snapshot(w.home, w.repo, other)
      await init(ref, ie(), { yes: true, ci: false }, say)
      await init(otherRef, ie(), { yes: true, ci: false }, say)
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.ok(existsSync(join(claude(), 'skills', 'project-pm', 'SKILL.md')))
      assert.ok(existsSync(join(other, '.git', 'hooks', 'pre-push')))
      assert.ok(!existsSync(join(w.repo, '.git', 'hooks', 'pre-push')))
      await uninstall(otherRef, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo, other), before)
    })

    test('uninstall --hooks takes out the git hook and the alias alone', async () => {
      await init(ref, ie(), { yes: true, ci: false }, say)
      await uninstall(ref, ie(), { yes: true, hooksOnly: true }, say)
      assert.ok(!existsSync(join(w.repo, '.git', 'hooks', 'pre-push')))
      assert.ok(existsSync(join(w.repo, 'AGENTS.md')))
      assert.deepEqual((await readLog(w.env)).entries.map(e => e.kind).sort(), ['hooks', 'mcp', 'text', 'whole'])
    })

    test('the single executable is copied into ~/.project-pm/bin, every setting points at the copy, and uninstall takes it out', async () => {
      const exe = join(w.root, 'Downloads', 'project-pm.exe')
      write(exe, 'MZ acme stand-in for the program')
      // Written with forward slashes, as a person may set it on Windows.
      const env = { ...w.env, PROJECT_PM_HOME: w.env.PROJECT_PM_HOME!.replace(/\\/g, '/') }
      const out = await init(ref, ie({ env, exe }), { yes: true, ci: false }, say)
      const copy = binPath(env)
      assert.equal(readFileSync(copy, 'utf8'), 'MZ acme stand-in for the program')
      assert.deepEqual(out.applied.find(d => d.kind === 'mcp')?.command, [copy, 'mcp'])
      assert.equal(git(w.repo, 'config', '--local', '--get', 'alias.pm'), `!${shCommand([copy])}`)
      await uninstall(ref, ie({ env, exe }), { yes: true, hooksOnly: false }, say)
      assert.ok(!existsSync(copy))
      assert.ok(!existsSync(join(copy, '..')))
    })

    test('a copy that cannot be deleted (Windows: the program running) leaves a sound log, the rest undone, and the way on', async () => {
      const before = snapshot(w.home, w.repo)
      const exe = join(w.root, 'Downloads', 'project-pm.exe')
      write(exe, 'MZ acme stand-in for the program')
      await init(ref, ie({ exe }), { yes: true, ci: false }, say)
      const copy = binPath(w.env)
      // A folder with a file in it stands for a file the system will not delete: rm fails the same way.
      rmSync(copy)
      write(join(copy, 'busy'), 'in use')
      said = []
      const undone = await uninstall(ref, ie({ exe }), { yes: true, hooksOnly: false }, say)
      assert.ok(undone > 0)
      assert.deepEqual(snapshot(w.home, w.repo), before)
      const left = (await readLog(w.env)).entries
      assert.deepEqual(left.map(e => e.kind), ['copy'])
      assert.ok(said.join('\n').includes(copy))
      // Once the file is free, uninstall finishes the job.
      rmSync(copy, { recursive: true })
      write(copy, 'MZ')
      await uninstall(ref, ie({ exe }), { yes: true, hooksOnly: false }, say)
      assert.deepEqual((await readLog(w.env)).entries, [])
      assert.ok(!existsSync(copy))
    })

    test('uninstall without --yes only lists', async () => {
      await init(ref, ie(), { yes: true, ci: false }, say)
      const after = snapshot(w.home, w.repo)
      said = []
      assert.equal(await uninstall(ref, ie(), { yes: false, hooksOnly: false }, say), 0)
      assert.deepEqual(snapshot(w.home, w.repo), after)
      assert.ok(said.join('\n').includes(ct('uninstall.dryRun')))
    })
  })
}

describe('the pieces of a section', () => {
  test('withBlock and withoutBlock undo each other, after any ending', () => {
    const block = `${START}\nAcme\n${END}`
    for (const text of ['', '# A', '# A\n', '# A\n\n', '# A\r\n']) {
      const sep = text.length && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : ''
      assert.equal(withoutBlock(withBlock(text, block), sep), text)
      assert.equal(withoutBlock(withBlock(text, block, true)), text)
    }
    assert.equal(withBlock(withBlock('# A\n', block), `${START}\nNew\n${END}`), `# A\n\n${START}\nNew\n${END}\n`)
  })

  test('shCommand quotes what sh would split, with slashes forward', () => {
    assert.equal(shCommand(['C:\\Users\\Acme Dev\\pm.exe', 'mcp']), '"C:/Users/Acme Dev/pm.exe" mcp')
    assert.equal(shCommand(['/usr/local/bin/project-pm']), '/usr/local/bin/project-pm')
    assert.equal(shCommand(['npx', '-y', 'project-pm@1.0.0']), 'npx -y project-pm@1.0.0')
    assert.equal(shCommand(['/opt/a$b']), '"/opt/a\\$b"')
  })
})

describe('how Claude Code starts the server from npm', () => {
  test('npx goes through cmd /c on Windows only; the single executable as it is', () => {
    assert.deepEqual(mcpLauncher(['npx', '-y', 'project-pm@1.0.0'], 'win32'), ['cmd', '/c', 'npx', '-y', 'project-pm@1.0.0'])
    assert.deepEqual(mcpLauncher(['npx', '-y', 'project-pm@1.0.0'], 'linux'), ['npx', '-y', 'project-pm@1.0.0'])
    assert.deepEqual(mcpLauncher(['C:\Acme\project-pm-1.0.0.exe'], 'win32'), ['C:\Acme\project-pm-1.0.0.exe'])
  })
})
