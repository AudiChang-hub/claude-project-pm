/**
 * The test browser leaves nothing behind (T-55): every process that carries a test's own profile (--user-data-dir) on
 * its command line has ended, and the profile folder is gone, once close() returns or openBrowser() fails, whether the
 * browser started, ended before it listened, or never said where it listens; and a test process that ends without
 * close() ends and takes its browser with it. A stand-in browser (Node) plays the failures; the real one, when there
 * is one, plays a normal close and a start stopped halfway. Only processes with this test's own profile are counted or ended.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { browserPath, endNow, openBrowser, processesUsing } from './browser'

/**
 * Plays a browser: `ends` starts a helper that outlives it and ends (0) before it listens (as Edge did here: "the
 * browser ended (0) before it listened"), out of reach of taskkill /T once its parent id is gone; `silent` keeps
 * running with a helper and never says where it listens; `listens` says it listens and keeps running with a helper. Each helper carries the profile on its command line, as a browser's do. The
 * profile is written to `record` so the test can look for it.
 */
const STAND_IN = `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [mode, record] = process.argv.slice(2)
const profileArg = process.argv.find(arg => arg.startsWith('--user-data-dir='))
writeFileSync(record, profileArg.slice('--user-data-dir='.length))
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', profileArg], { detached: mode === 'ends', stdio: 'ignore', windowsHide: true })
if (mode === 'ends') {
  helper.unref()
  process.exit(0)
}
if (mode === 'listens') process.stderr.write('\\nDevTools listening on ws://127.0.0.1:9/devtools/browser/stand-in\\n')
setInterval(() => {}, 1000)
`

describe('the test browser leaves nothing behind (T-55)', () => {
  let dir: string
  let standIn: string
  let n = 0
  const record = () => join(dir, `profile-${++n}.txt`)

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'pm-stand-in-'))
    standIn = join(dir, 'stand-in.mjs')
    writeFileSync(standIn, STAND_IN)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('a browser that ends before it listens: its helper is ended and its profile removed', async () => {
    const file = record()
    await assert.rejects(openBrowser(process.execPath, { before: [standIn, 'ends', file] }), /ended \(0\) before it listened/)
    const profile = readFileSync(file, 'utf8')
    assert.deepEqual(await processesUsing(profile), [], 'a process with the test profile is still running')
    assert.equal(existsSync(profile), false, 'the profile folder is still there')
  })

  test('a browser that never says where it listens: it and its helper are ended and its profile removed', async () => {
    const file = record()
    await assert.rejects(openBrowser(process.execPath, { before: [standIn, 'silent', file], startTimeoutMs: 3_000 }), /did not say where it listens/)
    const profile = readFileSync(file, 'utf8')
    assert.deepEqual(await processesUsing(profile), [], 'a process with the test profile is still running')
    assert.equal(existsSync(profile), false, 'the profile folder is still there')
  })

  // On Windows Node's own job object also ends a non-detached browser as the test process ends, so "throws" fails
  // without the exit hook only on macOS and Linux; "finishes" hangs without it everywhere. "is sent SIGTERM" is the
  // signal handler's case (macOS and Linux: Windows has no such signal to send itself).
  for (const [how, end] of [
    ['throws', `throw new Error('the test failed before close()')`],
    ['finishes', `console.log('the test finished without close()')`],
    ['is sent SIGTERM', `console.log('the test was stopped before close()')\nsetInterval(() => {}, 1000)\nprocess.kill(process.pid, 'SIGTERM')`],
  ] as const)
    test(`a test process that ${how} without close() ends, ends its browser and the browser helper, and removes the profile`, async t => {
      if (how === 'is sent SIGTERM' && process.platform === 'win32') return t.skip('no SIGTERM to send itself on Windows')
      const file = record()
      const script = join(dir, `abandon-${how}.mts`)
      const helper = pathToFileURL(fileURLToPath(new URL('./browser.ts', import.meta.url))).href
      writeFileSync(script, `import { openBrowser } from ${JSON.stringify(helper)}\nawait openBrowser(process.execPath, { before: [${JSON.stringify(standIn)}, 'listens', ${JSON.stringify(file)}] })\n${end}\n`)
      // A browser left open must not keep the test process running (it would never end): 60 s is the limit here.
      const ran = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 60_000, windowsHide: true })
      assert.equal(ran.error, undefined, 'the test process did not end')
      assert.match(ran.stdout + ran.stderr, /the test (failed before|finished without|was stopped before) close\(\)/)
      // the signal is raised again once the browser is ended, so the process still ends as SIGTERM says
      if (how === 'is sent SIGTERM') assert.equal(ran.signal, 'SIGTERM', ran.stderr)
      const profile = readFileSync(file, 'utf8')
      let left = await processesUsing(profile)
      for (let i = 0; i < 40 && left.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        left = await processesUsing(profile)
      }
      assert.deepEqual(left, [], 'a process with the test profile is still running')
      assert.equal(existsSync(profile), false, 'the profile folder is still there')
    })

  test('a browser that has ended is not ended again by its id, which may be another process now', async () => {
    // A process of this test's own plays the one that got the ended browser's id.
    const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' })
    try {
      endNow({ pid: other.pid, exitCode: 0, signalCode: null })
      endNow({ pid: other.pid, exitCode: null, signalCode: 'SIGKILL' })
      await new Promise(resolve => setTimeout(resolve, 500))
      assert.equal(other.exitCode, null, 'the process with the id was ended')
      assert.equal(other.signalCode, null, 'the process with the id was ended')
      // and one that still runs is ended
      const gone = new Promise(resolve => other.once('exit', resolve))
      endNow(other)
      await gone
    } finally {
      other.kill('SIGKILL')
    }
  })

  test('an empty profile is refused, not looked for on every command line', async () => {
    for (const profile of ['', '   ']) await assert.rejects(processesUsing(profile), /no profile to look for/)
  })

  test('a real browser: after close() no process with its profile runs and the profile is gone', async t => {
    const exe = browserPath()
    if (!exe) return t.skip('no Edge or Chrome here: set PROJECT_PM_BROWSER to run it')
    const page = await openBrowser(exe)
    try {
      assert.equal(await page.evaluate<number>('about:blank', 'true', '6 * 7'), 42)
      assert.notDeepEqual(await processesUsing(page.profile), [], 'the browser is not found by its profile')
    } finally {
      await page.close()
    }
    assert.deepEqual(await processesUsing(page.profile), [], 'a process with the test profile is still running')
    assert.equal(existsSync(page.profile), false, 'the profile folder is still there')
  })

  test('a real browser stopped while it starts: none of its processes runs and its profile is gone', async t => {
    const exe = browserPath()
    if (!exe) return t.skip('no Edge or Chrome here: set PROJECT_PM_BROWSER to run it')
    const err = await openBrowser(exe, { startTimeoutMs: 1 }).then(
      async page => {
        await page.close()
        assert.fail('the browser said where it listens within 1 ms')
      },
      (e: Error & { profile?: string }) => e,
    )
    assert.match(err.message, /did not say where it listens/)
    assert.ok(err.profile)
    assert.deepEqual(await processesUsing(err.profile), [], 'a process with the test profile is still running')
    assert.equal(existsSync(err.profile), false, 'the profile folder is still there')
  })
})
