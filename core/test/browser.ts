/**
 * A headless Edge or Chrome for the web board's tests, driven over the DevTools protocol (as docs/demo/webboard.mts
 * does): the page runs its own script and fetches the board, and the test reads what it drew. Started by its full
 * path; on Windows the process tree is ended with System32's taskkill (host.ts systemProgram), never one found by name.
 * Each browser has its own temporary profile (--user-data-dir), which its every process carries on its command line:
 * close() and a failed start wait until none of those runs (ending the ones left, T-55), then remove the profile.
 */
import type { ChildProcess } from 'node:child_process'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { systemProgram } from '../src/host'

/**
 * Windows PowerShell: the ids of the processes whose command line holds $env:PM_PROFILE. From PM_GRACE_MS on it ends
 * those still running, each round, and it waits up to PM_LIMIT_MS for none to be left.
 */
const SWEEP_PS = [
  '$path = $env:PM_PROFILE; $grace = [int64]$env:PM_GRACE_MS; $limit = [int64]$env:PM_LIMIT_MS',
  '$watch = [Diagnostics.Stopwatch]::StartNew()',
  'while ($true) {',
  '  $left = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($path, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { $_.ProcessId })',
  '  if ($left.Count -eq 0 -or $watch.ElapsedMilliseconds -ge $limit) { break }',
  '  if ($watch.ElapsedMilliseconds -ge $grace) { foreach ($id in $left) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }',
  '  Start-Sleep -Milliseconds 250',
  '}',
  '$left -join " "',
].join('\n')

const ids = (out: string) => out.split(/\s+/).filter(Boolean).map(Number)

/** The ids of the processes whose command line holds `profile` (ps on macOS and Linux). */
async function posixUsing(profile: string): Promise<number[]> {
  const out = await new Promise<string | null>(resolve => execFile('ps', ['-A', '-ww', '-o', 'pid=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout)))
  if (out === null) throw new Error('could not list the processes (ps)')

  return out
    .split('\n')
    .filter(line => line.includes(profile))
    .map(line => Number(line.trim().split(/\s+/)[0]))
    .filter(pid => pid !== process.pid)
}

/**
 * Waits up to `limitMs` until no process has `profile` (a browser's own --user-data-dir) on its command line, ending
 * the ones still running from `graceMs` on, and gives the ids of those left. Only processes started with that profile
 * are touched: it is a folder this file made for one browser, so no one else's browser holds it.
 */
async function sweep(profile: string, { graceMs, limitMs }: { graceMs: number; limitMs: number }): Promise<number[]> {
  if (process.platform === 'win32') {
    const out = await new Promise<string>(resolve =>
      execFile(
        systemProgram(join('WindowsPowerShell', 'v1.0', 'powershell.exe')),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SWEEP_PS, 'utf16le').toString('base64')],
        { env: { ...REAL_ENV, PM_PROFILE: profile, PM_GRACE_MS: String(graceMs), PM_LIMIT_MS: String(limitMs) }, encoding: 'utf8', windowsHide: true, timeout: limitMs + 60_000 },
        (err, stdout) => resolve(err ? 'unknown' : stdout),
      ),
    )
    if (out === 'unknown') throw new Error('could not list the processes (PowerShell)')

    return ids(out)
  }
  const started = Date.now()
  for (;;) {
    const left = await posixUsing(profile)
    if (!left.length || Date.now() - started >= limitMs) return left
    if (Date.now() - started >= graceMs)
      for (const pid of left)
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
    await sleep(250)
  }
}

/** The ids of the processes running now with `profile` on their command line. */
export function processesUsing(profile: string): Promise<number[]> {
  return sweep(profile, { graceMs: Number.MAX_SAFE_INTEGER, limitMs: 0 })
}

/** A browser that can run headless (PROJECT_PM_BROWSER, else Edge or Chrome where they install), or null. */
export function browserPath(): string | null {
  const named = process.env.PROJECT_PM_BROWSER
  if (named) return existsSync(named) ? named : null

  return (
    [
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].find(path => existsSync(path)) ?? null
  )
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** The environment as it was when the tests began: the browser needs the person's real home folder to start (a test's world() points HOME and USERPROFILE at a temporary one). */
const REAL_ENV = { ...process.env }

/** Takes the browser's temporary profile out, once none of its processes runs; a file something else still holds (EPERM) leaves it in the temporary folder. */
function removeProfile(profile: string) {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch {
    // Windows: a file still open elsewhere (EPERM). It is in the temporary folder.
  }
}

/** Ends the browser and the processes it started, and waits for it: on Windows the tree under its id, elsewhere its process group (it is started as one). */
function endNow(child: ChildProcess) {
  if (process.platform === 'win32') spawnSync(systemProgram('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 30_000 })
  else
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      // already gone
    }
}

/** Browsers not closed yet. Ended as the test process ends, whatever ends it first (a test that failed before close(), an uncaught error). */
const OPEN = new Set<ChildProcess>()
process.on('exit', () => {
  for (const child of OPEN) endNow(child)
})

/** Asks the browser to close itself (DevTools Browser.close), so it ends its own processes and lets go of its profile. Whatever fails here, the sweep after it ends them. */
async function askToClose(port: number) {
  try {
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5_000) })).json()) as { webSocketDebuggerUrl: string }
    const ws = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((ok, fail) => {
      ws.onopen = ok
      ws.onerror = fail
      setTimeout(fail, 5_000).unref()
    })
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  } catch {
    // the sweep ends it
  }
}

/** How long a closing browser may take to end its processes before they are ended for it, and how long they may take to be gone. Slow on a busy Windows machine: a browser told to close, or a process ended by force, took from 15 s to over 80 s to be gone there. */
const CLOSE_GRACE_MS = 20_000
const GONE_LIMIT_MS = 180_000

export type Browser = {
  /** Opens `url` at `width`, waits until `ready` (a JS expression) holds, and evaluates `expression` there. The page sees `scheme` (light unless given) and reduced motion only when `reducedMotion` is true, whatever the system says. */
  evaluate: <T>(url: string, ready: string, expression: string, options?: { width?: number; scheme?: 'light' | 'dark'; reducedMotion?: boolean }) => Promise<T>
  close: () => Promise<void>
  /** The browser's own temporary profile (--user-data-dir). */
  profile: string
}

/** `before`: arguments given ahead of the browser's own (the tests' stand-in browser is a script). `startTimeoutMs`: how long it may take to say where it listens. A failed start throws once none of its processes runs, with the profile it had as `profile`. */
export async function openBrowser(exe: string, { before = [], startTimeoutMs = 30_000 }: { before?: string[]; startTimeoutMs?: number } = {}): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'pm-browser-'))
  const child: ChildProcess = spawn(exe, [...before, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env: REAL_ENV,
    // its own process group on macOS and Linux, so endNow ends its helpers with it
    detached: process.platform !== 'win32',
  })
  OPEN.add(child)
  const port = await new Promise<number>((ok, fail) => {
    let said = ''
    child.stderr!.on('data', chunk => {
      said += String(chunk)
      const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(said)
      if (m) ok(Number(m[1]))
    })
    child.on('exit', code => fail(new Error(`the browser ended (${code}) before it listened`)))
    setTimeout(() => fail(new Error('the browser did not say where it listens')), startTimeoutMs).unref()
  }).catch(async (err: Error) => {
    // A browser that ended before it listened may have handed over to processes it started, whose parent is now
    // gone (taskkill /T finds no tree under an ended id): they are found by the profile on their command line.
    OPEN.delete(child)
    endNow(child)
    const left = await sweep(profile, { graceMs: 0, limitMs: GONE_LIMIT_MS })
    removeProfile(profile)
    throw Object.assign(left.length ? new Error(`${err.message}, and its processes ${left.join(', ')} did not end`) : err, { profile })
  })
  child.stderr!.resume()
  // A browser a test did not close does not keep the test process running: it ends, and the exit hook ends the browser.
  child.unref()
  ;(child.stderr as Socket).unref()

  const evaluate = async <T>(url: string, ready: string, expression: string, options: { width?: number; scheme?: 'light' | 'dark'; reducedMotion?: boolean } = {}): Promise<T> => {
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string }
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((ok, fail) => {
      ws.onopen = ok
      ws.onerror = fail
    })
    let next = 0
    const waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>()
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
      if (message.id && waiting.has(message.id)) waiting.get(message.id)!(message)
    }
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((ok, fail) => {
        const id = ++next
        waiting.set(id, message => (message.error ? fail(new Error(message.error.message)) : ok((message.result ?? {}) as Record<string, unknown>)))
        ws.send(JSON.stringify({ id, method, params }))
      })
    const value = async (expr: string) => ((await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result as { value?: unknown } | undefined)?.value
    try {
      await send('Emulation.setDeviceMetricsOverride', { width: options.width ?? 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      // Both media features are always set, so a page looks the same on every machine: left unset, the browser takes
      // the system's own (the macOS and Windows CI runners say reduce motion), and "motion on" would depend on the host.
      await send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: options.scheme ?? 'light' },
          { name: 'prefers-reduced-motion', value: options.reducedMotion ? 'reduce' : 'no-preference' },
        ],
      })
      await send('Page.navigate', { url })
      for (let i = 0; i < 150 && !(await value(ready)); i++) await sleep(100)
      await sleep(300)

      return (await value(expression)) as T
    } finally {
      ws.close()
    }
  }

  return {
    evaluate,
    profile,
    /** Returns once no process with this browser's profile runs and the profile is removed; throws when some did not end. */
    close: async () => {
      if (!OPEN.delete(child)) return
      await askToClose(port)
      const left = await sweep(profile, { graceMs: CLOSE_GRACE_MS, limitMs: GONE_LIMIT_MS })
      removeProfile(profile)
      if (left.length) throw new Error(`the browser's processes ${left.join(', ')} did not end`)
    },
  }
}
