/**
 * Screenshots of the real web board (`project-pm serve`, core/src/http.ts) for the README and docs/how-it-works*.md.
 *
 * It writes made-up "acme-storefront" data into a temporary data home (PROJECT_PM_HOME, and a temporary home folder so
 * nothing of ~/.claude/project-pm is read), starts the core's own server on it, and captures the page with headless
 * Edge (or Chrome) over the DevTools protocol. Only git and gh are answered by this script instead of the real
 * programs, so the board can show a failed CI run without a GitHub repository. Every word on the page comes from the
 * core itself (hooks/messages.ts, core/src/messages.ts, core/src/web/app.js).
 *
 * Run from core/ (it needs the core's dev dependencies):
 *   npm ci && node scripts/web-assets.mjs && node --import tsx ../docs/demo/webboard.mts
 * Then crop and compress as docs/demo/README.md says.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const work = join(tmpdir(), 'project-pm-webboard')
const fakeHome = join(work, 'home')
// The legacy folder (~/.claude/project-pm) is found through the home folder: point it at an empty one first.
// The browser keeps the real one (it does not start without it).
const realEnv = { ...process.env }
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const { serve, boardAddress } = await import('../../core/src/http')
const { setLang } = await import('../../hooks/messages')
const { keyFile, projectKey } = await import('../../hooks/sessions')

type Lang = 'en' | 'zh-TW'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const images = join(root, 'docs/images')

// ── The made-up project ──

const PATH = '~/code/acme-storefront'
const KEY = projectKey(PATH)
const PM = 'claude-code:6f1d3b2a-8c4e-4f7a-9b21-0d5e7c3a1f48'
const ID = {
  coupon: 'claude-code:1c7e9a40-5b2d-4e8f-a316-27d0b9e4c5f1',
  tax: 'claude-code:8a2f6c13-d9e4-4b71-8f05-6e3a1c7b2d90',
  search: 'claude-code:3e5b7d21-0a6c-4f98-b2e4-9c1d8f7a6b03',
  banner: 'claude-code:b4d81e6a-2f3c-47a5-9e10-5a7c3b9d2e64',
  payouts: 'claude-code:5f9a2c7e-6b1d-4e03-8c4f-1d2e7a9b3c85',
  emails: 'claude-code:9d3c5e1b-7a2f-4c86-b0d9-3e6f1a8c4b27',
}
const C = 'completed'
const P = 'in_progress'
const _ = 'pending'
const steps = (texts: string[], states: string[]) => texts.map((content, i) => ({ content, status: states[i] }))

const WORDS = {
  en: {
    items: {
      1: 'Product list page with filters', 2: 'Cart keeps items after sign-in', 3: 'Order confirmation email', 4: 'Stripe test-mode checkout',
      5: 'Coupon code field at checkout', 6: 'Fix tax rounding at checkout', 7: 'Retire the v1 coupon fields', 8: 'Search ranking: in-stock items first',
      9: 'Sitemap for product pages', 10: 'Reconcile October payouts', 11: 'Holiday banner on the home page', 12: 'Fix the typo in order emails',
    },
    criteria: {
      6: 'Totals of 0.005 round half up; the rounding test passes on CI.',
      8: 'In-stock items rank above sold-out ones for the same query, typos included.',
      12: '"recieve" is gone from every email template; the email tests pass.',
    },
    titles: {
      coupon: 'Retire v1 coupon fields', tax: 'Fix tax rounding at checkout', search: 'Search ranking for in-stock items',
      banner: 'Holiday banner on the home page', payouts: 'Monthly payouts reconciliation', emails: 'Fix the typo in order emails',
    },
    ask: 'Drop the coupon_v1 columns in this release, or keep them read-only until 0.9?',
    tax: 'Pushed 8c41d2e; CI run 18240211 is running the rounding test.',
    searchSteps: ['Read the ranker', 'Index stock per warehouse', 'Add the stock signal', 'Boost in-stock items in the ranker', 'Typo queries', 'Ranking tests', 'Push and check CI'],
    search: 'Indexed stock levels per warehouse; the ranker change is next.',
    banner: 'Merged locally as a3f9c21; not pushed yet, waiting for your go-ahead to deploy.',
    payoutsSteps: ['Export October payouts', 'Export October orders', 'Match payouts to orders by reference', 'Flag mismatches', 'Write the summary'],
    payouts: 'Reconcile October payouts against orders and flag mismatches',
    emails: 'Fixed "recieve" in 3 email templates; email tests pass.',
    qaFail: 'A sold-out item still ranks first for "blu jeans" (typo query); case 3 in the detail file.',
    guidelinesBy: 'claude-code:2b7e4f19-c3a8-4d65-9f12-8e0b6d3a5c71',
  },
  'zh-TW': {
    items: {
      1: '商品列表頁與篩選', 2: '登入後保留購物車', 3: '訂單確認信', 4: 'Stripe 測試模式結帳',
      5: '結帳頁的優惠碼欄位', 6: '修正結帳稅額四捨五入', 7: '停用 v1 優惠券欄位', 8: '搜尋排序：有庫存的商品優先',
      9: '商品頁的 sitemap', 10: '10 月撥款對帳', 11: '首頁節慶橫幅', 12: '修正訂單通知信的錯字',
    },
    criteria: {
      6: '0.005 的金額四捨五入進位；CI 上的四捨五入測試通過。',
      8: '同一個搜尋字，有庫存的商品排在缺貨商品前面，打錯字也一樣。',
      12: '所有通知信範本都沒有錯字；通知信的測試通過。',
    },
    titles: {
      coupon: '停用 v1 優惠券欄位', tax: '修正結帳稅額四捨五入', search: '搜尋排序：有庫存的商品優先',
      banner: '首頁節慶橫幅', payouts: '每月撥款對帳', emails: '修正訂單通知信的錯字',
    },
    ask: '這次發布就刪掉 coupon_v1 欄位，還是保留唯讀到 0.9 版？',
    tax: '已 push 8c41d2e，CI run 18240211 正在跑四捨五入的測試。',
    searchSteps: ['讀懂排序器', '建立各倉庫的庫存索引', '加入庫存訊號', '在排序器中提高有庫存商品的權重', '處理打錯字的搜尋', '排序測試', 'Push 並確認 CI'],
    search: '已建立各倉庫的庫存量索引，接下來改排序器。',
    banner: '已在本機合併為 a3f9c21，尚未 push，等你放行再部署。',
    payoutsSteps: ['匯出 10 月撥款', '匯出 10 月訂單', '依參考編號比對撥款與訂單', '標出不一致', '寫摘要'],
    payouts: '核對 10 月撥款與訂單，標出不一致的地方',
    emails: '修正 3 份通知信範本裡的錯字，通知信測試通過。',
    qaFail: '搜尋「牛仔褲」打錯字時，缺貨商品仍排第一；詳細檔的第 3 個案例。',
    guidelinesBy: 'claude-code:2b7e4f19-c3a8-4d65-9f12-8e0b6d3a5c71',
  },
}

type Scene = 'board' | 'qa' | 'guidelines'

async function seed(home: string, lang: Lang, scene: Scene, now: number) {
  const w = WORDS[lang]
  const min = (n: number) => now - n * 60_000
  const actor = (key: keyof typeof ID, at: number, extra: Record<string, unknown>) => ({
    id: ID[key], tool: 'claude-code', title: w.titles[key], cwd: PATH, projectKey: KEY, lastSeenAt: at, turnAt: at, ...extra,
  })
  const report = (at: number, r: Record<string, unknown>) => ({ report: r, reportAt: at })
  const all = {
    coupon: actor('coupon', min(12), { state: 'idle', ask: w.ask, plan: steps(['a', 'b', 'c', 'd', 'e'], [C, C, C, C, C]), ...report(min(12), { status: 'waiting_user', summary: w.ask }) }),
    tax: actor('tax', min(26), { state: 'idle', plan: steps(['a', 'b', 'c', 'd'], [C, C, C, C]), ...report(min(26), { status: 'waiting_ci', ci: 'run 18240211', commit: '8c41d2e', summary: w.tax }) }),
    search: actor('search', min(41), { state: 'idle', plan: steps(w.searchSteps, [C, C, C, P, _, _, _]), planAt: min(41), lastAnswer: w.search }),
    banner: actor('banner', min(17), { state: 'idle', plan: steps(['a', 'b', 'c', 'd', 'e'], [C, C, C, C, C]), ...report(min(17), { status: 'waiting_release', delivery: 'pending', commit: 'a3f9c21', summary: w.banner }) }),
    payouts: actor('payouts', min(0), { state: 'running', plan: steps(w.payoutsSteps, [C, C, P, _, _]), planAt: min(1), lastPrompt: w.payouts }),
    emails: actor('emails', min(35), { state: 'idle', plan: steps(['a', 'b', 'c'], [C, C, C]), ...report(min(35), { status: 'done', delivery: 'released', commit: '5e2b9c1', summary: w.emails }) }),
  }
  const item = (id: number, owner: string | null, status: 'open' | 'done', extra: Record<string, unknown> = {}) => ({
    id, text: w.items[id as keyof typeof w.items], owner, status, note: '', createdAt: min(600 - id * 30), updatedAt: min(300 - id * 10),
    ...(w.criteria[id as keyof typeof w.criteria] ? { criteria: w.criteria[id as keyof typeof w.criteria] } : {}), ...extra,
  })
  const passed = (at: number) => ({ qa: { result: 'pass', by: 'agent:a91c0f2e7b', at, note: '' } })
  let actors: Record<string, unknown>[]
  let ledger: Record<string, unknown>[]
  if (scene === 'board') {
    actors = Object.values(all)
    ledger = [
      ...[1, 2, 3, 4, 5, 9].map(id => item(id, null, 'done', passed(min(400 - id * 20)))),
      item(6, ID.tax, 'open'), item(7, ID.coupon, 'open'), item(8, ID.search, 'open'),
      item(10, ID.payouts, 'open'), item(11, ID.banner, 'open', passed(min(19))), item(12, ID.emails, 'open'),
    ]
  } else if (scene === 'qa') {
    const done = (key: 'search', at: number) => ({ ...all[key], plan: steps(w.searchSteps, w.searchSteps.map(() => C)), lastAnswer: '', ...report(at, { status: 'done', delivery: 'released', commit: '7b3e9d4', summary: w.search }) })
    actors = [all.emails, done('search', min(50))]
    ledger = [
      ...[1, 2, 3, 4, 9].map(id => item(id, null, 'done', passed(min(400 - id * 20)))),
      item(5, ID.emails, 'open', { qa: { result: 'pass', by: 'agent:4c8d1e6f2a', at: min(8), note: '', commit: 'e1f04b7' } }),
      item(8, ID.search, 'open', { qa: { result: 'fail', by: 'agent:d27a5c9e13', at: min(20), note: w.qaFail, commit: '7b3e9d4' } }),
      item(12, ID.emails, 'open'),
    ]
  } else {
    actors = [all.payouts]
    ledger = [item(10, ID.payouts, 'open')]
    const alert = {
      at: min(20), by: w.guidelinesBy, repo: PATH, change: 'changed', file: `${PATH}/docs/GUIDELINES.md`, from: 'project',
      copy: '~/.project-pm/guidelines/copies/9c1e5a7d3b.md', since: 'start',
    }
    await write(join(home, 'guidelines', `${keyFile(KEY)}.json`), { alerts: [alert] })
  }
  const project = { key: KEY, name: 'acme-storefront', path: PATH, pmId: PM, isDismissed: false, ledger, nextId: 13, schema: 2, revision: 42 }
  await write(join(home, 'projects', `${keyFile(KEY)}.json`), project)
  for (const one of actors) await write(join(home, 'actors', `${encodeURIComponent(String(one.id))}.json`), one)
}

async function write(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2))
}

/** git and gh as the board asks them: gh reports the run as failed (without its commit, which git could not find); git knows nothing (the folder is made up). */
const run = async (argv: string[]) => {
  if (argv[0] === 'gh' && argv[1] === 'run' && argv[2] === 'view') return JSON.stringify({ status: 'completed', conclusion: 'failure', workflowName: 'CI' })
  if (argv[0] === 'gh' && argv[1] === 'run' && argv[2] === 'list') return JSON.stringify([{ status: 'completed', conclusion: 'failure', workflowName: 'CI' }])

  return null
}

// ── The browser, over the DevTools protocol ──

const browserPath = [
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
].find(p => existsSync(p))
if (!browserPath) throw new Error('Needs Microsoft Edge or Google Chrome.')
let debugPort = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function page() {
  let last: unknown
  for (let i = 0; i < 50; i++) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string }
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)))
      let next = 0
      const waiting = new Map<number, (v: any) => void>()
      ws.onmessage = e => {
        const msg = JSON.parse(String(e.data))
        if (msg.id && waiting.has(msg.id)) waiting.get(msg.id)!(msg.error ? Promise.reject(new Error(msg.error.message)) : msg.result)
      }
      const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>(ok => {
          const id = ++next
          waiting.set(id, ok)
          ws.send(JSON.stringify({ id, method, params }))
        })
      return { send, close: () => ws.close() }
    } catch (err) {
      last = err
      await sleep(200)
    }
  }
  throw new Error(`The browser did not start: ${last}`)
}

/** `selector`: only that element (and `pad` around it); `until`: the page from the top down to that element's end. */
type Shot = { out: string; width: number; scheme: 'light' | 'dark'; selector?: string; until?: string; pad?: number }

async function capture(url: string, shot: Shot) {
  const p = await page()
  await p.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: 900, deviceScaleFactor: 2, mobile: false })
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.scheme }] })
  await p.send('Page.navigate', { url })
  const evaluate = async (expression: string) => (await p.send('Runtime.evaluate', { expression, returnByValue: true })).result.value
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`!!document.getElementById('board') && !document.getElementById('board').hidden && document.fonts.status === 'loaded'`)) break
    await sleep(100)
  }
  await sleep(600)
  const height = await evaluate('document.documentElement.scrollHeight')
  await p.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height, deviceScaleFactor: 2, mobile: false })
  await sleep(300)
  const pad = shot.pad ?? 0
  const box = shot.selector
    ? await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(shot.selector)}).getBoundingClientRect(); return { x: r.x - ${pad}, y: r.y + scrollY - ${pad}, width: r.width + ${pad * 2}, height: r.height + ${pad * 2} } })()`)
    : shot.until
      ? { x: 0, y: 0, width: shot.width, height: await evaluate(`Math.ceil(document.querySelector(${JSON.stringify(shot.until)}).getBoundingClientRect().bottom + scrollY + 32)`) }
      : { x: 0, y: 0, width: shot.width, height }
  const { data } = await p.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, captureBeyondViewport: true })
  await writeFile(join(images, shot.out), Buffer.from(data, 'base64'))
  p.close()
  console.log(`wrote docs/images/${shot.out}`)
}

// ── The shots ──

const only = process.argv.slice(2)
await rm(work, { recursive: true, force: true })
await mkdir(fakeHome, { recursive: true })
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${join(work, 'browser')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: realEnv })
// The browser picks a free port and says which on stderr.
debugPort = await new Promise<number>((ok, fail) => {
  let said = ''
  browser.stderr!.on('data', chunk => {
    said += String(chunk)
    const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(said)
    if (m) ok(Number(m[1]))
  })
  browser.on('exit', code => fail(new Error(`The browser ended (${code}) before it listened.`)))
  setTimeout(() => fail(new Error('The browser did not say where it listens.')), 30_000)
})
browser.stderr!.resume()
try {
  for (const lang of ['en', 'zh-TW'] as Lang[]) {
    setLang(lang)
    const suffix = lang === 'en' ? '' : '-zh-TW'
    const scenes: [Scene, Shot[]][] = [
      ['board', [
        { out: `web-board-light${suffix}.png`, width: 1180, scheme: 'light', until: '.grid__side .block' },
        { out: `web-board-dark${suffix}.png`, width: 1180, scheme: 'dark', until: '.grid__side .block' },
      ]],
      ['qa', [{ out: `how-qa${suffix}.png`, width: 1180, scheme: 'light', selector: '.grid__main', pad: 16 }]],
      ['guidelines', [{ out: `how-guidelines${suffix}.png`, width: 1180, scheme: 'light', selector: '.grid__main .block', pad: 16 }]],
    ]
    for (const [scene, shots] of scenes) {
      const wanted = shots.filter(s => !only.length || only.includes(s.out))
      if (!wanted.length) continue
      const home = join(work, `${scene}-${lang}`)
      await seed(home, lang, scene, Date.now())
      const env = { ...process.env, PROJECT_PM_HOME: home, PROJECT_PM_LANG: lang }
      const served = await serve({ port: 0, env, ctx: { run } })
      setLang(lang)
      const url = boardAddress(served.info)
      for (const shot of wanted) await capture(url, shot)
      await served.close()
    }
  }
} finally {
  // The browser's helper processes outlive the one spawned: end the whole tree.
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
  else browser.kill()
  await sleep(500)
}
process.exit(0)
