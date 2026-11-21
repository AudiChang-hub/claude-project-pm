/**
 * A headless Edge or Chrome for the web board's tests, driven over the DevTools protocol (as docs/demo/webboard.mts
 * does): the page runs its own script and fetches the board, and the test reads what it drew. Started by its full
 * path; on Windows the process tree is ended with System32's taskkill (host.ts systemProgram), never one found by name.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { systemProgram } from '../src/host'

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

/** Takes the browser's temporary profile out; one the browser still holds as it ends is left for the system to clear. */
function removeProfile(profile: string) {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch {
    // Windows: a file the ending browser still has open (EPERM). It is in the temporary folder.
  }
}

/** Ends the browser and every process it started. */
function end(child: ChildProcess) {
  if (process.platform === 'win32') spawn(systemProgram('taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else child.kill()
}

export type Browser = {
  /** Opens `url` at `width`, waits until `ready` (a JS expression) holds, and evaluates `expression` there. */
  evaluate: <T>(url: string, ready: string, expression: string, options?: { width?: number; scheme?: 'light' | 'dark' }) => Promise<T>
  close: () => Promise<void>
}

export async function openBrowser(exe: string): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'pm-browser-'))
  const child: ChildProcess = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env: REAL_ENV,
  })
  const port = await new Promise<number>((ok, fail) => {
    let said = ''
    child.stderr!.on('data', chunk => {
      said += String(chunk)
      const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(said)
      if (m) ok(Number(m[1]))
    })
    child.on('exit', code => fail(new Error(`the browser ended (${code}) before it listened`)))
    setTimeout(() => fail(new Error('the browser did not say where it listens')), 30_000).unref()
  }).catch(async err => {
    end(child)
    await sleep(500)
    removeProfile(profile)
    throw err
  })
  child.stderr!.resume()

  const evaluate = async <T>(url: string, ready: string, expression: string, options: { width?: number; scheme?: 'light' | 'dark' } = {}): Promise<T> => {
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
      if (options.scheme) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: options.scheme }] })
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
    close: async () => {
      end(child)
      await sleep(800)
      removeProfile(profile)
    },
  }
}
