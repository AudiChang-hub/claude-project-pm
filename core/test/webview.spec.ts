/**
 * The web board in a real browser (T-43): titles, reports and work items that hold HTML or script are shown as the
 * very text they are, never run, and no full session id reaches the page. Runs headless Edge or Chrome (or the one
 * PROJECT_PM_BROWSER names); without one the test is skipped and says so. Acme data in a temporary home only.
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Served } from '../src/http'
import { boardAddress, serve } from '../src/http'
import { resolveProject } from '../src/project'
import { ledgerTool, pmTool, reportTool } from '../src/tools'
import { browserPath, openBrowser } from './browser'
import type { World } from './helpers'
import { git, hostWith, world } from './helpers'

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

  test('the project picker and its open list read at WCAG AA in dark, light and system themes (T-56)', async t => {
    const exe = browserPath()
    if (!exe) return t.skip('no Edge or Chrome here: set PROJECT_PM_BROWSER to run it')
    // A second project, so the picker is shown.
    const admin = join(w.root, 'acme-admin')
    mkdirSync(admin)
    git(admin, 'init', '-q', '-b', 'main')
    await pmTool(w.ctx('claude-code:pm2', { cwd: admin }), { action: 'claim' })
    const ref = (await resolveProject(w.repo))!
    const url = boardAddress(served.info, ref.key)
    const ready = `!!document.getElementById('board') && !document.getElementById('board').hidden && document.getElementById('project').options.length === 2`
    // The open list is the browser's own window, out of the page's reach: Chromium (Chrome, Edge) paints it with each option's
    // background, or where that is transparent with the select's, flattened onto white. Colors are read back from a
    // canvas, composited the same way, so any color syntax the browser computes is measured as painted.
    const measure = (theme: string) => `(() => {
      const button = document.getElementById('theme')
      for (let i = 0; i < 3 && (document.documentElement.dataset.theme ?? 'auto') !== '${theme}'; i++) button.click()
      const select = document.getElementById('project')
      const pen = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
      const paint = (...layers) => { pen.clearRect(0, 0, 1, 1); for (const c of layers) { pen.fillStyle = c; pen.fillRect(0, 0, 1, 1) } return [...pen.getImageData(0, 0, 1, 1).data].slice(0, 3) }
      const lum = rgb => { const [r, g, b] = rgb.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
      const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
      const s = getComputedStyle(select)
      const bar = getComputedStyle(select.closest('.top')).backgroundColor
      return {
        shown: !select.closest('.picker').hidden,
        scheme: s.colorScheme,
        closed: contrast(paint('white', bar, s.color), paint('white', bar, s.backgroundColor)),
        list: Math.min(...[...select.options].map(o => { const c = getComputedStyle(o); return contrast(paint('white', c.color), paint('white', s.backgroundColor, c.backgroundColor)) })),
      }
    })()`
    const page = await openBrowser(exe)
    try {
      for (const [system, theme, looks] of [
        ['dark', 'auto', 'dark'],
        ['light', 'auto', 'light'],
        ['light', 'dark', 'dark'],
        ['dark', 'light', 'light'],
      ] as const) {
        const seen = await page.evaluate<{ shown: boolean; scheme: string; closed: number; list: number }>(url, ready, measure(theme), { scheme: system })
        const label = `system ${system}, theme ${theme}: ${JSON.stringify(seen)}`
        assert.equal(seen.shown, true, label)
        assert.equal(seen.scheme, looks, label)
        assert.ok(seen.closed >= 4.5, label)
        assert.ok(seen.list >= 4.5, label)
      }
    } finally {
      await page.close()
    }
  })

  test('the page sets every word as text: no innerHTML, outerHTML, insertAdjacentHTML or document.write', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/web/app.js', import.meta.url)), 'utf8')
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!source.includes(sink), sink)
  })
})
