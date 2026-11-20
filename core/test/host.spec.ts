/**
 * The commands the core runs (host.ts run), on Windows: a command npm installs is a .cmd file (claude.cmd), which a
 * program started without a shell is never found as. CI run 44723838413: `init` said Claude Code was not found though
 * `npm install --global @anthropic-ai/claude-code` had put claude.cmd on PATH, and set up no MCP server.
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { run } from '../src/host'
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

  test('git, gh and claude.exe by name are never taken from the working folder (T-39 QA8)', async () => {
    // Any program that is not git, under git's name: what a repository could leave in its folder.
    const repo = join(root, 'acme-shop')
    mkdirSync(repo, { recursive: true })
    copyFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'hostname.exe'), join(repo, 'git.exe'))
    assert.match((await run(['git', '--version'], repo)) ?? '', /^git version /)
  })
})
