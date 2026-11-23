/**
 * The commands the core runs (host.ts run), on Windows: a command npm installs is a .cmd file (claude.cmd), which a
 * program started without a shell is never found as. CI run 44723838413: `init` said Claude Code was not found though
 * `npm install --global @anthropic-ai/claude-code` had put claude.cmd on PATH, and set up no MCP server.
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { desktopClaude, run, systemProgram } from '../src/host'
import { PROBE_HOST, watchFs } from './helpers'

describe('a command installed as a .cmd file, on Windows (CI run 44723838413)', { skip: process.platform === 'win32' ? false : 'a .cmd file is Windows\'' }, () => {
  let root: string
  let bin: string
  let path: string | undefined
  let noCwd: string | undefined
  beforeEach(() => {
    // As on a machine that has not set it (Claude Code's own shell does, which hid T-39 QA8 here): cmd.exe then looks
    // for a command by name in its current folder first.
    noCwd = process.env.NoDefaultCurrentDirectoryInExePath
    delete process.env.NoDefaultCurrentDirectoryInExePath
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pm-host-')))
    bin = join(root, 'npm bin (x86) & co')
    mkdirSync(bin)
    // As npm writes one: the command line it was given goes on to node as %*.
    writeFileSync(join(bin, 'acme-cli.cmd'), `@ECHO off\r\n"${process.execPath}" "${join(bin, 'cli.js')}" %*\r\n`)
    writeFileSync(join(bin, 'cli.js'), `require('fs').writeFileSync(${JSON.stringify(join(root, 'ran'))}, 'yes'); console.log(JSON.stringify(process.argv.slice(2)))\n`)
    path = process.env.PATH
    process.env.PATH = `${bin}${delimiter}${path}`
  })
  afterEach(() => {
    process.env.PATH = path
    if (noCwd === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath
    else process.env.NoDefaultCurrentDirectoryInExePath = noCwd
    rmSync(root, { recursive: true, force: true })
  })

  test('is found on PATH and run, every argument reaching it as it was given', async () => {
    const args = ['mcp', 'add', '--scope', 'user', 'project-pm', '--', 'C:\\Users\\Acme Dev (Work)\\.project-pm\\bin\\project-pm-1.0.0.exe', 'mcp', 'a&b', 'x|y', '<in>', '^caret', "it's", 'C:\\Program Files\\x y\\p.exe']
    const out = await run(['acme-cli', ...args], root)
    assert.notEqual(out, null)
    assert.deepEqual(JSON.parse(out!), args)
  })

  test('an argument cmd.exe would read as its own (% " ! or a line break) is refused, and nothing runs', async () => {
    for (const arg of ['%PATH%', 'say "hi"', 'wow!', 'two\nlines', 'C:\\ends\\with\\']) {
      assert.equal(await run(['acme-cli', 'mcp', arg], root), null, arg)
      assert.equal(existsSync(join(root, 'ran')), false, arg)
    }
  })

  test('a .cmd file in the working folder but not on PATH is not run, and a network folder on PATH is not looked in', async () => {
    const here = join(root, 'repo')
    mkdirSync(here)
    writeFileSync(join(here, 'acme-here.cmd'), '@ECHO off\r\necho ran> ran\r\n')
    process.env.PATH = `\\\\${PROBE_HOST}\\share\\bin${delimiter}${process.env.PATH}`
    const fs = watchFs()
    try {
      assert.equal(await run(['acme-here'], here), null)
      assert.equal(existsSync(join(here, 'ran')), false)
      assert.deepEqual(fs.remote, [])
      // Still found where it should be.
      assert.deepEqual(JSON.parse((await run(['acme-cli', 'list'], here))!), ['list'])
      assert.deepEqual(fs.remote, [])
    } finally {
      fs.restore()
    }
  })

  test('a program that is an .exe runs as before', async () => {
    assert.match((await run(['git', '--version'], root)) ?? '', /^git version /)
  })

  /** A repository folder holding a program of the name a command would run, which leaves a mark when it runs. */
  const trap = (name: string) => {
    const repo = join(root, 'acme-shop')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, name), `@ECHO off\r\necho pwned> "${join(root, 'pwned')}"\r\n`)

    return repo
  }

  test('a .cmd file that runs a bare `node`, as npm\'s does, never runs a node.cmd from the repository it is run in (T-39 QA8)', async () => {
    // npm's shim, when no node.exe lies beside it: "node" by name alone, which cmd.exe looks for in its current folder
    // first unless NoDefaultCurrentDirectoryInExePath is set.
    writeFileSync(join(bin, 'acme-bare.cmd'), `@ECHO off\r\n"node" "${join(bin, 'cli.js')}" %*\r\n`)
    const repo = trap('node.cmd')
    writeFileSync(join(repo, 'node.bat'), `@ECHO off\r\necho pwned> "${join(root, 'pwned')}"\r\n`)
    const out = await run(['acme-bare', 'mcp', 'list'], repo)
    assert.equal(existsSync(join(root, 'pwned')), false, 'ran the repository\'s node.cmd')
    assert.deepEqual(JSON.parse(out!), ['mcp', 'list'])
  })

  test('the batch file runs in its own folder, not the repository, through cmd.exe from System32 whatever ComSpec says (T-39 QA8)', async () => {
    // Quoted: the folder's name holds & and ( ), which echo would otherwise read as commands.
    writeFileSync(join(bin, 'acme-where.cmd'), '@ECHO off\r\necho "%CD%"\r\n')
    const repo = trap('cmd.cmd')
    const comspec = process.env.ComSpec
    process.env.ComSpec = join(repo, 'cmd.cmd')
    try {
      assert.equal((await run(['acme-where'], repo))?.replace(/^"|"$/g, '').toLowerCase(), bin.toLowerCase())
      assert.equal(existsSync(join(root, 'pwned')), false, 'ran the ComSpec the environment named')
    } finally {
      process.env.ComSpec = comspec
    }
  })

  /**
   * A repository folder holding git.exe, gh.exe and claude.exe that are node (a hard link, or a copy), so that run with
   * `-e <script>` each leaves a mark: what a repository could leave in its folder, under those names.
   */
  const fakes = (folder: string) => {
    mkdirSync(folder, { recursive: true })
    for (const name of ['git', 'gh', 'claude']) {
      const to = join(folder, `${name}.exe`)
      try {
        linkSync(process.execPath, to)
      } catch {
        copyFileSync(process.execPath, to)
      }
    }
  }
  const mark = (name: string) => `require('fs').writeFileSync(${JSON.stringify(join(root, `pwned-${name}`))}, 'x')`

  test('git, gh and claude by name are never taken from the working folder (T-39 QA8)', async () => {
    const repo = join(root, 'acme-shop')
    fakes(repo)
    for (const name of ['git', 'gh', 'claude']) {
      await run([name, '-e', mark(name)], repo)
      assert.equal(existsSync(join(root, `pwned-${name}`)), false, `ran the repository's ${name}.exe`)
    }
    assert.match((await run(['git', '--version'], repo)) ?? '', /^git version /)
  })

  test('nor through a ".", relative or empty entry on PATH (T-39 QA9)', async () => {
    const repo = join(root, 'acme-shop')
    fakes(repo)
    fakes(join(repo, 'tools'))
    for (const first of ['.', '.\\', 'tools', '.\\tools', '', ' ', '"."']) {
      process.env.PATH = `${first};${bin};${path}`
      for (const name of ['git', 'gh', 'claude']) {
        await run([name, '-e', mark(name)], repo)
        assert.equal(existsSync(join(root, `pwned-${name}`)), false, `PATH starting ${JSON.stringify(first)} ran the repository's ${name}.exe`)
      }
      // What PATH names on this machine's own disks is still found: git, and the npm-style acme-cli.cmd.
      assert.match((await run(['git', '--version'], repo)) ?? '', /^git version /, JSON.stringify(first))
      assert.deepEqual(JSON.parse((await run(['acme-cli', 'list'], repo))!), ['list'], JSON.stringify(first))
    }
  })

  test('the program a found .exe starts gets a PATH with only those folders: none it could read as the repository (T-39 QA9)', async () => {
    const repo = join(root, 'acme-shop')
    mkdirSync(repo, { recursive: true })
    process.env.PATH = `.;tools;;${bin};${path}`
    // node.exe (from the PATH Node itself is on), asked what PATH it was given.
    const said = await run(['node', '-e', 'console.log(process.env.PATH)'], repo)
    assert.ok(said, 'node was not found')
    const parts = said!.split(';')
    assert.ok(parts.every(part => /^[A-Za-z]:\\/.test(part)), said!)
    assert.ok(parts.some(part => part.toLowerCase() === bin.toLowerCase()), said!)
  })
})

describe('Windows\' own programs, by their full path (T-39 QA9)', { skip: process.platform === 'win32' ? false : 'Windows\'' }, () => {
  test('cmd.exe and rundll32.exe come from System32 under SystemRoot, and only a plain local SystemRoot is taken', () => {
    const saved = { SystemRoot: process.env.SystemRoot, windir: process.env.windir }
    try {
      process.env.SystemRoot = 'C:\\Windows'
      assert.equal(systemProgram('cmd.exe').toLowerCase(), 'c:\\windows\\system32\\cmd.exe')
      assert.equal(systemProgram('rundll32.exe').toLowerCase(), 'c:\\windows\\system32\\rundll32.exe')
      for (const bad of [`\\\\${PROBE_HOST}\\share\\Windows`, '.', 'Windows', '\\Windows', 'C:Windows', '\\\\?\\C:\\Windows']) {
        process.env.SystemRoot = bad
        process.env.windir = bad
        assert.equal(systemProgram('cmd.exe').toLowerCase(), 'c:\\windows\\system32\\cmd.exe', bad)
      }
    } finally {
      process.env.SystemRoot = saved.SystemRoot
      process.env.windir = saved.windir
    }
  })
})

describe('the Claude Code the desktop app bundles (T-50)', () => {
  let root: string
  const exe = (profile: string, version: string, build: string) => {
    const dir = join(root, 'Claude-Data', profile, 'claude-code', version, build)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'claude.exe'), '')

    return join(dir, 'claude.exe')
  }
  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pm-desktop-')))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test('off Windows there is none to find', () => {
    assert.equal(desktopClaude({ LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' }, 'linux'), null)
  })

  test('a LOCALAPPDATA that is not a plain path on this machine\'s disks is never looked in', () => {
    for (const bad of ['\\\\acme-files\\share\\AppData', '//acme-files/share', 'AppData\\Local', 'C:AppData', '']) {
      assert.equal(desktopClaude({ LOCALAPPDATA: bad }, 'win32'), null, bad)
    }
  })

  describe('on Windows', { skip: process.platform === 'win32' ? false : 'the desktop app\'s folder is Windows\'' }, () => {
    test('the newest version in the app\'s own folder, by its full path', () => {
      exe('claude_acme01', '2.1.9', 'a1b2c3d4e5f6')
      const newest = exe('claude_acme01', '2.1.10', 'f6e5d4c3b2a1')
      assert.equal(desktopClaude({ LOCALAPPDATA: root }, 'win32'), newest)
    })

    test('CLAUDE_CODE_EXECPATH first, but only when it is one in the app\'s folder', () => {
      const older = exe('claude_acme01', '2.1.9', 'a1b2c3d4e5f6')
      const newest = exe('claude_acme01', '2.1.10', 'f6e5d4c3b2a1')
      assert.equal(desktopClaude({ LOCALAPPDATA: root, CLAUDE_CODE_EXECPATH: older }, 'win32'), older)
      const elsewhere = join(root, 'acme-tools', 'claude.exe')
      mkdirSync(join(root, 'acme-tools'))
      writeFileSync(elsewhere, '')
      assert.equal(desktopClaude({ LOCALAPPDATA: root, CLAUDE_CODE_EXECPATH: elsewhere }, 'win32'), newest)
    })

    test('folders of other names, and no claude.exe, are passed over', () => {
      mkdirSync(join(root, 'Claude-Data', 'claude_acme01', 'claude-code', 'latest', 'a1b2c3d4e5f6'), { recursive: true })
      writeFileSync(join(root, 'Claude-Data', 'claude_acme01', 'claude-code', 'latest', 'a1b2c3d4e5f6', 'claude.exe'), '')
      mkdirSync(join(root, 'Claude-Data', 'claude_acme01', 'claude-code', '2.1.10', 'a1b2c3d4e5f6'), { recursive: true })
      assert.equal(desktopClaude({ LOCALAPPDATA: root }, 'win32'), null)
    })
  })
})
