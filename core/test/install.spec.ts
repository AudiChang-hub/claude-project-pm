/**
 * init and uninstall (docs/design/v1-core.md 5): init changes nothing without --yes, and init → uninstall leaves
 * every file exactly as it was. Claude Code's settings are written to a fake home folder, and Claude Code's own
 * command line is stood in for (fakeClaude), so nothing touches the person's real settings.
 */
import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import type { InstallEnv } from '../src/install'
import type { Done } from '../src/install'
import { END, apply, binPath, claudeSection, deleteAfterExit, mcpLauncher, SECTION_LIMIT, START, init, readLog, shCommand, skillText, uninstall, withBlock, withoutBlock, writeLog } from '../src/install'
import { NotPlainPathError } from '../src/localpath'
import { ct } from '../src/messages'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import { paths } from '../src/store'
import type { World } from './helpers'
import { LANGS, PROBE_HOST, fakeClaude, git, hostWith, watchFs, world } from './helpers'

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
      assert.ok(text.includes(join(w.repo, 'CLAUDE.md')))
      assert.ok(!text.includes('AGENTS.md'))
      assert.ok(text.includes('claude mcp add --scope user project-pm -- "C:/Program Files/Acme Tools/project-pm.exe" mcp'))
      assert.ok(text.includes('project-pm-qa.yml'))
    })

    test('no CLAUDE.md, no AGENTS.md: init writes every piece, uninstall leaves the very same files', async () => {
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      assert.equal(readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8'), `${claudeSection()}\n`)
      assert.ok(Buffer.byteLength(claudeSection()) <= SECTION_LIMIT)
      assert.ok(!existsSync(join(w.repo, 'AGENTS.md')))
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
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      assert.equal(readFileSync(join(w.repo, 'AGENTS.md'), 'utf8'), '# Acme agents\nUse pnpm.')
      assert.equal(readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8'), `# Acme\n\n@AGENTS.md\n\n${claudeSection()}\n`)
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
      assert.equal(readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8'), '# Acme\n\n@AGENTS.md\n')
    })

    test('a CLAUDE.md (CRLF) gets the section after its own text, and loses it again', async () => {
      write(join(w.repo, 'CLAUDE.md'), '# Acme\r\nShip on Fridays.\r\n')
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      assert.equal(readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8'), `# Acme\r\nShip on Fridays.\r\n\n${claudeSection()}\n`)
      assert.ok(!readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8').startsWith(`${START}\n@AGENTS.md\n${END}`))
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
      write(join(w.repo, 'CLAUDE.md'), '# Acme\n')
      const before = snapshot(w.home, w.repo)
      await init(ref, ie(), { yes: true, ci: false }, say)
      const once = snapshot(w.home, w.repo)
      await init(ref, ie({ now: Date.now() + 1000 }), { yes: true, ci: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), once)
      await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
      assert.deepEqual(snapshot(w.home, w.repo), before)
    })

    test('a file changed after init loses only what init put in', async () => {
      write(join(w.repo, 'CLAUDE.md'), '# Acme agents\n')
      await init(ref, ie(), { yes: true, ci: false }, say)
      const agents = join(w.repo, 'CLAUDE.md')
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

    test('without Claude Code, init says so and still sets up git and CLAUDE.md', async () => {
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

    test('the AGENTS.md files a project has of its own are left as they are (T-40)', async () => {
      write(join(w.repo, 'AGENTS.md'), '# Acme agents\nUse pnpm.\n')
      write(join(w.repo, 'AGENTS.override.md'), `# Acme override\n${'Acme rule.\n'.repeat(3000)}`)
      const out = await roundTrip()
      assert.ok(!out.applied.some(d => 'file' in d && d.file.includes('AGENTS')))
      assert.equal(readFileSync(join(w.repo, 'AGENTS.md'), 'utf8'), '# Acme agents\nUse pnpm.\n')
    })

    /** What v1.0's init wrote for this project's instructions: its AGENTS.md section, and @AGENTS.md atop a CLAUDE.md there was. */
    const v1Install = async () => {
      const v1Section = `${START}\n## Project PM\n\nProject PM keeps this project's work list and its QA. Every AI tool working in this project: …\n${END}`
      const done: Done[] = []
      const keep = async (change: Parameters<typeof apply>[0]) => {
        const { prior: _, ...one } = await apply(change, ie(), ref)
        done.push(one)
      }
      const hadClaudeMd = existsSync(join(w.repo, 'CLAUDE.md'))
      await keep({ kind: 'text', file: join(w.repo, 'AGENTS.md'), block: v1Section })
      if (hadClaudeMd) await keep({ kind: 'text', file: join(w.repo, 'CLAUDE.md'), block: `${START}\n@AGENTS.md\n${END}`, atTop: true })
      await writeLog(w.env, { version: '1.0.0', entries: done })
    }

    for (const [name, files] of [
      ['no CLAUDE.md, no AGENTS.md', {}],
      ['its own CLAUDE.md (CRLF) and AGENTS.md', { 'CLAUDE.md': '# Acme\r\nShip on Fridays.\r\n', 'AGENTS.md': '# Acme agents\nUse pnpm.' }],
    ] as const) {
      test(`a v1.0 install (${name}): uninstall puts AGENTS.md and CLAUDE.md back as they were`, async () => {
        for (const [file, text] of Object.entries(files)) write(join(w.repo, file), text)
        const before = snapshot(w.home, w.repo)
        await v1Install()
        assert.ok(readFileSync(join(w.repo, 'AGENTS.md'), 'utf8').includes(START))
        await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
        assert.deepEqual(snapshot(w.home, w.repo), before)
      })

      test(`a v1.0 install (${name}): init moves the section into CLAUDE.md, and uninstall still puts everything back`, async () => {
        for (const [file, text] of Object.entries(files)) write(join(w.repo, file), text)
        const before = snapshot(w.home, w.repo)
        await v1Install()
        const out = await init(ref, ie({ now: Date.now() + 1000 }), { yes: true, ci: false }, say)
        assert.deepEqual(out.failed, [])
        assert.ok(said.join('\n').includes(ct('init.retire', { file: join(w.repo, 'AGENTS.md') })))
        // AGENTS.md as it was before v1.0 (none, or the project's own); CLAUDE.md with the section, not @AGENTS.md.
        const own = (files as Record<string, string>)['AGENTS.md']
        if (own !== undefined) assert.equal(readFileSync(join(w.repo, 'AGENTS.md'), 'utf8'), own)
        else assert.ok(!existsSync(join(w.repo, 'AGENTS.md')))
        const claudeMd = readFileSync(join(w.repo, 'CLAUDE.md'), 'utf8')
        assert.ok(claudeMd.includes(claudeSection()))
        assert.ok(!claudeMd.includes('@AGENTS.md'))
        assert.ok(!(await readLog(w.env)).entries.some(e => 'file' in e && e.file.endsWith('AGENTS.md')))
        await uninstall(ref, ie(), { yes: true, hooksOnly: false }, say)
        assert.deepEqual(snapshot(w.home, w.repo), before)
      })
    }

    test('a v1.0 AGENTS.md that now leads to a network share stops init before anything is changed (T-39, T-40)', async t => {
      if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
      await v1Install()
      const before = snapshot(w.home, w.repo)
      const fs = watchFs({ [join(w.repo, 'AGENTS.md')]: `\\\\${PROBE_HOST}\\share\\AGENTS.md` })
      try {
        await assert.rejects(init(ref, ie(), { yes: true, ci: false }, say), NotPlainPathError)
        assert.deepEqual(fs.remote, [])
      } finally {
        fs.restore()
      }
      assert.deepEqual(snapshot(w.home, w.repo), before)
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
      assert.ok(existsSync(join(w.repo, 'CLAUDE.md')))
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

    test('a .project-pm/ folder in the project that git would commit gets a reminder, and .gitignore is left alone (2.1)', async () => {
      write(join(w.repo, '.project-pm', 'notes.json'), '{"acme":"draft"}')
      let out = await init(ref, ie(), { yes: false, ci: false }, say)
      assert.ok(out.notes.includes(ct('init.gitignoreHint')), out.notes.join('\n'))
      assert.ok(!existsSync(join(w.repo, '.gitignore')))
      write(join(w.repo, '.gitignore'), 'node_modules/\n.project-pm/\n')
      out = await init(ref, ie(), { yes: false, ci: false }, say)
      assert.ok(!out.notes.includes(ct('init.gitignoreHint')))
      assert.equal(readFileSync(join(w.repo, '.gitignore'), 'utf8'), 'node_modules/\n.project-pm/\n')
    })

    test('a committed CLAUDE.md or .project-pm that leads to a network share stops init before anything is read or written there (T-39)', async t => {
      if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
      // AGENTS.md files are never read since v1.1 (T-40): one that leads to a share is never connected to either.
      for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
        const before = snapshot(w.home, w.repo)
        const fs = watchFs({ [join(w.repo, name)]: `\\\\${PROBE_HOST}\\share\\${name}` })
        try {
          await init(ref, ie(), { yes: false, ci: false }, say)
          assert.deepEqual(fs.remote, [], name)
        } finally {
          fs.restore()
        }
        assert.deepEqual(snapshot(w.home, w.repo), before, name)
      }
      for (const name of ['CLAUDE.md']) {
        const before = snapshot(w.home, w.repo)
        const fs = watchFs({ [join(w.repo, name)]: `\\\\${PROBE_HOST}\\share\\${name}` })
        try {
          await assert.rejects(init(ref, ie(), { yes: true, ci: false }, say), NotPlainPathError, name)
          assert.deepEqual(fs.remote, [], name)
        } finally {
          fs.restore()
        }
        assert.deepEqual(snapshot(w.home, w.repo), before, name)
      }
      const fs = watchFs({ [join(w.repo, '.project-pm')]: `\\\\?\\UNC\\${PROBE_HOST}\\share` })
      try {
        await assert.rejects(init(ref, ie(), { yes: false, ci: false }, say), NotPlainPathError)
        assert.deepEqual(fs.remote, [])
      } finally {
        fs.restore()
      }
    })

    test('no .project-pm/ folder in the project: no reminder', async () => {
      const out = await init(ref, ie(), { yes: false, ci: false }, say)
      assert.ok(!out.notes.some(note => note.includes('.gitignore')))
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
    assert.deepEqual(mcpLauncher(['C:\\Acme\\project-pm-1.0.0.exe'], 'win32'), ['C:\\Acme\\project-pm-1.0.0.exe'])
  })
})

describe('deleting the running program once it ends (T-37 QA2 2)', () => {
  const onWindows = { skip: process.platform !== 'win32' && 'Windows only: elsewhere a running program can be deleted', timeout: 90_000 }
  let w: World
  let running: ChildProcess | null = null
  beforeEach(() => {
    w = world('en')
  })
  afterEach(() => {
    running?.kill()
    running = null
    w.done()
  })
  /** A program in the bin folder, kept running for `seconds` (a copy of Windows' ping, which holds its own file). */
  const runFromBin = (seconds: number) => {
    const bin = paths(w.env).bin
    mkdirSync(bin, { recursive: true })
    const file = join(bin, 'project-pm-1.0.0.exe')
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE'), file)
    running = spawn(file, ['-n', String(seconds + 1), '127.0.0.1'], { stdio: 'ignore', windowsHide: true })

    return { bin, file, ended: new Promise(resolve => running!.on('exit', resolve)) }
  }
  const until = async (done: () => boolean, ms: number) => {
    for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise(resolve => setTimeout(resolve, 200))

    return done()
  }

  test('a file outside the data folder\'s bin is never scheduled, however its path is written', () => {
    const bin = paths(w.env).bin
    mkdirSync(bin, { recursive: true })
    const outside = join(w.repo, 'acme.exe')
    writeFileSync(outside, 'Acme')
    for (const file of [outside, join(bin, '..', 'acme.exe'), bin, w.home]) assert.equal(deleteAfterExit(file, w.env), null, file)
    assert.ok(existsSync(outside))
  })

  test('it waits for the program to end, longer than a few seconds, then deletes it and its empty folder', onWindows, async () => {
    const { bin, file, ended } = runFromBin(6)
    const scheduled = deleteAfterExit(file, w.env, { show: false })
    assert.ok(scheduled)
    await ended
    assert.ok(await until(() => !existsSync(file), 15_000), 'the program is still there')
    assert.ok(await until(() => !existsSync(bin), 5_000), 'its folder is still there')
    assert.ok(await until(() => !existsSync(scheduled.note), 5_000), 'the note for a failure was left behind')
  })

  test('when it never can, it stops trying and says so', onWindows, async () => {
    const { file } = runFromBin(60)
    const scheduled = deleteAfterExit(file, w.env, { tries: 2, show: false })
    assert.ok(scheduled)
    assert.ok(await until(() => !existsSync(scheduled.script), 20_000), 'it is still trying')
    assert.ok(existsSync(file))
    assert.equal(readFileSync(scheduled.note, 'utf8'), ct('uninstall.deleteFailed', { file }))
    rmSync(scheduled.note, { force: true })
  })
})
