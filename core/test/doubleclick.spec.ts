/**
 * A double-click on the program (T-52): Windows opens a console window, runs it with no arguments, and closes the
 * window as soon as it ends. With stdin a terminal it shows what init would change and waits for Enter, sets up on
 * Enter (or opens the board when this is set up already), and waits for Enter again before the window closes. With
 * stdin not a terminal (a script, a pipe, an AI tool's shell) it keeps printing the usage and ends with 1.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { main } from '../src/cli'
import type { ClickConsole } from '../src/commands'
import { doubleClick } from '../src/commands'
import type { InstallEnv } from '../src/install'
import { readLog } from '../src/install'
import { ct } from '../src/messages'
import { resolveProject } from '../src/project'
import type { World } from './helpers'
import { LANGS, fakeClaude, hostWith, serverCommand, world } from './helpers'

/** The console window: what was written, and Enter pressed (true) or the window closed (false), in turn. */
function consoleWith(...presses: boolean[]): ClickConsole & { said: string[]; asked: number } {
  const said: string[] = []
  const out = {
    said,
    asked: 0,
    write: (text: string) => {
      said.push(text)
    },
    enter: async () => {
      out.asked += 1

      return presses.shift() ?? false
    },
  }

  return out
}

describe('the program with no arguments and stdin not a terminal (T-52)', () => {
  test('prints the usage and ends with 1, as before', () => {
    const { command, args } = serverCommand()
    const ran = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, env: { ...process.env, PROJECT_PM_LANG: 'en' }, input: '', timeout: 60_000 })
    assert.equal(ran.status, 1, ran.stderr)
    assert.match(ran.stdout, /^Usage: project-pm <command>/)
  })

  test('main without a terminal never waits for Enter', async () => {
    const written: string[] = []
    const write = process.stdout.write
    process.stdout.write = ((text: string) => written.push(text) > 0) as typeof process.stdout.write
    try {
      assert.equal(await main([], false), 1)
    } finally {
      process.stdout.write = write
    }
    assert.equal(written.join(''), `${ct('cli.usage')}\n`)
  })
})

for (const lang of LANGS) {
  describe(`a double-click on the program (${lang}, T-52)`, () => {
    let w: World
    let ie: InstallEnv
    beforeEach(() => {
      w = world(lang)
      ie = { env: w.env, run: fakeClaude(w.home, hostWith()), home: w.home, self: ['C:\\Program Files\\Acme Tools\\project-pm.exe'], exe: null, now: Date.now() }
    })
    afterEach(() => w.done())
    const opened = () => {
      const calls: number[] = []

      return { calls, open: async () => calls.push(1) && 0 }
    }

    test('not set up: shows what init would change, waits for Enter, sets up, then waits for Enter to close', async () => {
      const c = consoleWith(true, true)
      const board = opened()
      assert.equal(await doubleClick(w.repo, ie, c, board.open), 0)
      const ref = (await resolveProject(w.repo))!
      const heading = ct('init.heading', { project: ref.name, path: ref.path })
      const text = c.said.join('\n')
      assert.ok(text.includes(heading), text)
      assert.ok(text.includes('CLAUDE.md'), text)
      // No command to type: the line that says to run init --yes is left out, and Enter is asked for instead.
      assert.ok(!text.includes(ct('init.dryRun').trim()), text)
      const ask = c.said.indexOf(ct('click.ask'))
      assert.ok(ask > 0, text)
      // The list is shown once: after Enter, only how it went.
      assert.equal(c.said.filter(line => line === heading).length, 1)
      assert.ok((await readLog(w.env)).entries.some(e => e.project === ref.key))
      assert.equal(c.said.at(-1), ct('click.close'))
      assert.equal(c.said.at(-2)!.trim().split('\n')[0], ct('init.done', { n: (await readLog(w.env)).entries.length }).trim().split('\n')[0])
      assert.equal(c.asked, 2)
      assert.deepEqual(board.calls, [])
    })

    test('closing the window instead of Enter changes nothing', async () => {
      const c = consoleWith(false)
      assert.equal(await doubleClick(w.repo, ie, c, opened().open), 1)
      assert.ok(c.said.includes(ct('click.ask')))
      assert.deepEqual((await readLog(w.env)).entries, [])
      assert.equal(existsSync(join(w.repo, 'CLAUDE.md')), false)
    })

    test('set up already: opens the board, then waits for Enter to close', async () => {
      assert.equal(await doubleClick(w.repo, ie, consoleWith(true, true), opened().open), 0)
      const c = consoleWith(true)
      const board = opened()
      assert.equal(await doubleClick(w.repo, ie, c, board.open), 0)
      assert.deepEqual(board.calls, [1])
      assert.deepEqual(c.said, [ct('click.setUp'), ct('click.close')])
      assert.equal(c.asked, 1)
    })

    test('outside a git project, nothing set up: says so and how, then waits for Enter to close', async () => {
      const folder = join(w.root, 'Downloads')
      mkdirSync(folder)
      const c = consoleWith(true)
      const board = opened()
      assert.equal(await doubleClick(folder, ie, c, board.open), 1)
      assert.deepEqual(c.said, [ct('error.notGit', { path: folder }), ct('click.notGit'), ct('click.close')])
      assert.deepEqual(board.calls, [])
      assert.deepEqual((await readLog(w.env)).entries, [])
    })

    test('outside a git project, with a project set up: opens the board', async () => {
      assert.equal(await doubleClick(w.repo, ie, consoleWith(true, true), opened().open), 0)
      const folder = join(w.root, 'Downloads')
      mkdirSync(folder)
      const board = opened()
      assert.equal(await doubleClick(folder, ie, consoleWith(true), board.open), 0)
      assert.deepEqual(board.calls, [1])
    })
  })
}
