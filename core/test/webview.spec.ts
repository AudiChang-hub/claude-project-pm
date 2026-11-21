/**
 * The web board in a real browser (T-43): titles, reports and work items that hold HTML or script are shown as the
 * very text they are, never run, and no full session id reaches the page. Runs headless Edge or Chrome (or the one
 * PROJECT_PM_BROWSER names); without one the test is skipped and says so. Acme data in a temporary home only.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Served } from '../src/http'
import { boardAddress, serve } from '../src/http'
import { resolveProject } from '../src/project'
import { ledgerTool, pmTool, reportTool } from '../src/tools'
import { browserPath, openBrowser } from './browser'
import type { World } from './helpers'
import { hostWith, world } from './helpers'

const HOSTILE = `<img src=x onerror="document.body.setAttribute('data-pwned','img')">`
const BREAKOUT = `</script><script>document.body.setAttribute('data-pwned','script')</script>`
const DEV = 'claude-code:1c7e9a40-5b2d-4e8f-a316-27d0b9e4c5f1'

describe('the web board in a browser (T-43)', () => {
  let w: World
  let served: Served

  beforeEach(async () => {
    w = world('en')
    served = await serve({ port: 0, env: w.env, ctx: { run: hostWith(), cwd: w.repo } })
    await pmTool(w.ctx(), { action: 'claim' })
    await ledgerTool(w.ctx(), { action: 'add', text: `Acme coupon ${HOSTILE} & "quotes" 'too'`, owner: DEV, criteria: BREAKOUT })
    await reportTool(w.ctx(DEV), { status: 'waiting_user', summary: `Ship ${BREAKOUT}?`, title: `Coupon ${HOSTILE}` })
  })
  afterEach(async () => {
    await served.close()
    w.done()
  })

  test('hostile titles, reports and items are shown as text, run nothing, and no session id is shown', async t => {
    const exe = browserPath()
    if (!exe) return t.skip('no Edge or Chrome here: set PROJECT_PM_BROWSER to run it')
    const ref = (await resolveProject(w.repo))!
    const page = await openBrowser(exe)
    let dom: string
    try {
      dom = await page.evaluate<string>(boardAddress(served.info, ref.key), `!!document.getElementById('board') && !document.getElementById('board').hidden`, 'document.documentElement.outerHTML')
    } finally {
      await page.close()
    }
    // The board drew (its project name is there), so the script ran and fetched the board.
    assert.ok(dom.includes('id="board"') && !/<div id="board" hidden/.test(dom), dom.slice(0, 2000))
    assert.ok(dom.includes('Acme coupon'), dom.slice(0, 2000))
    // Nothing the data held became an element or ran.
    assert.ok(!/<body[^>]*data-pwned/i.test(dom), 'a payload ran')
    assert.ok(!/<img\b/i.test(dom), 'an <img> was made from the data')
    assert.equal((dom.match(/<script\b/gi) ?? []).length, 1, 'only the page\'s own script')
    // The payloads are there as text, escaped by the browser when it wrote the DOM out.
    assert.ok(dom.includes('&lt;img src=x onerror="document.body.setAttribute(\'data-pwned\',\'img\')"&gt;'), 'the item text as text')
    assert.ok(dom.includes('&amp; "quotes" \'too\''))
    // No full session id anywhere on the page: the owner and the session by name.
    assert.ok(!dom.includes(DEV), 'a full session id is on the page')
    assert.ok(dom.includes('Coupon &lt;img'), 'the session by its reported title')
  })

  test('an empty project draws its empty states, the pane figures at zero and no horizontal scroll at 375px (T-44)', async t => {
    const exe = browserPath()
    if (!exe) return t.skip('no Edge or Chrome here: set PROJECT_PM_BROWSER to run it')
    const empty = world('en')
    const server = await serve({ port: 0, env: empty.env, ctx: { run: hostWith(), cwd: empty.repo } })
    const page = await openBrowser(exe)
    try {
      await pmTool(empty.ctx(), { action: 'claim' })
      const ref = (await resolveProject(empty.repo))!
      const seen = await page.evaluate<{ empties: string[]; figures: string[]; percent: string; overflow: number }>(
        boardAddress(server.info, ref.key),
        `!!document.getElementById('board') && !document.getElementById('board').hidden`,
        `({ empties: [...document.querySelectorAll('.empty strong')].map(e => e.textContent), figures: [...document.querySelectorAll('.metric dd')].map(e => e.textContent), percent: document.getElementById('percent').textContent, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`,
        { width: 375, scheme: 'dark' },
      )
      assert.deepEqual(seen.empties, ['Nothing needs you right now', 'No work items yet', 'No session has reported yet'])
      assert.deepEqual(seen.figures, ['0', '0', '0'])
      assert.equal(seen.percent, '—')
      assert.equal(seen.overflow, 0)
      // The live mark pulses, unless the person asked for less motion.
      const url = boardAddress(server.info, ref.key)
      const ready = `!!document.getElementById('board') && !document.getElementById('board').hidden`
      const motion = `getComputedStyle(document.querySelector('.live__dot')).animationName`
      assert.notEqual(await page.evaluate<string>(url, ready, motion), 'none')
      assert.equal(await page.evaluate<string>(url, ready, motion, { reducedMotion: true }), 'none')
    } finally {
      await page.close()
      await server.close()
      empty.done()
    }
  })

  test('the page sets every word as text: no innerHTML, outerHTML, insertAdjacentHTML or document.write', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/web/app.js', import.meta.url)), 'utf8')
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!source.includes(sink), sink)
  })
})
