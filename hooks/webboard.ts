// The pane's "Open in browser" button (T-45): the core's web board, opened with the right address. The core keeps the
// address and its key in server.json (core/src/http.ts); the key opens the board, so it is never logged, never put in
// the pane's words or state, and never shown: it goes only to the browser.

import type { EngineInterface } from 'claude-code'
import { atom, update } from 'claude-code'

import type { Notice, Setup } from '../types'
import { CORE_SERVER, coreHome } from './core'
import { t } from './messages'

const notice = atom({ plugin: 'project-pm', key: 'notice' } as const, null as Notice | null)
/** True while the button works: the pane says so, and a second press waits. */
export const webOpening = atom({ plugin: 'project-pm', key: 'webOpening' } as const, false)
/** True when the core is not installed and the pane shows how to install it. */
export const webHelp = atom({ plugin: 'project-pm', key: 'webHelp' } as const, false)
const setup = atom({ plugin: 'project-pm', key: 'setup' } as const, { phase: 'unknown', project: '', changes: [], notes: [], error: null, failed: [] } as Setup)

/** How long the core's `open` may take: it starts the server and waits up to 5 s for it. */
const OPEN_TIMEOUT_MS = 20_000

/** The three cases the button meets. */
export type WebBoard = { kind: 'running'; url: string } | { kind: 'stopped'; program: string } | { kind: 'none' }

/**
 * A program path the button may start: a full path on this machine's own disks, nothing relative, no network or
 * device path, no control character. Windows: X:\… ; elsewhere: /… (not //…).
 */
export function isPlainProgram(path: string): boolean {
  if (!path || /[\u0000-\u001f<>"|?*]/.test(path.replace(/^[A-Za-z]:/, ''))) return false
  if (/(^|[\\/])\.\.?([\\/]|$)/.test(path)) return false
  if (/^[A-Za-z]:[\\/]/.test(path)) return !path.slice(2).includes(':')

  return path.startsWith('/') && !path.startsWith('//')
}

/**
 * The core's program as Claude Code starts it (`project-pm init` adds `<program> mcp` to ~/.claude.json, for every
 * project or for this one), when that is the single executable at a full path; else null (an npx command is not
 * started from here).
 */
export function coreProgramOf(config: unknown, projectPath: string): string | null {
  if (!config || typeof config !== 'object') return null
  const serverOf = (o: unknown) => {
    const list = o && typeof o === 'object' ? (o as { mcpServers?: unknown }).mcpServers : undefined
    const one = list && typeof list === 'object' ? (list as Record<string, unknown>)[CORE_SERVER] : undefined

    return one && typeof one === 'object' ? (one as { command?: unknown }) : null
  }
  const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const projects = (config as { projects?: unknown }).projects
  const local =
    projects && typeof projects === 'object'
      ? Object.entries(projects as Record<string, unknown>).find(([folder]) => key(folder) === key(projectPath))?.[1]
      : undefined
  for (const server of [serverOf(local), serverOf(config)]) {
    const command = typeof server?.command === 'string' ? server.command : ''
    if (isPlainProgram(command)) return command
  }

  return null
}

/** The web board's address from server.json, when it has one: the key goes in the fragment, which no server sees. */
export function boardAddressOf(info: unknown, projectKey: string | null): { url: string; port: number; token: string } | null {
  if (!info || typeof info !== 'object') return null
  const { port, token } = info as { port?: unknown; token?: unknown }
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,}$/.test(token)) return null
  const project = projectKey ? `&p=${encodeURIComponent(projectKey)}` : ''

  return { url: `http://127.0.0.1:${port}/#t=${token}${project}`, port, token }
}

async function homeOf($: EngineInterface): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
}

/** Which of the three cases holds now: the server answers with its key, the core is installed, or neither. */
export async function webBoardOf($: EngineInterface, projectPath: string, projectKey: string | null): Promise<WebBoard> {
  try {
    const file = `${await coreHome($)}/server.json`
    if (await $.fs.exists(file)) {
      const address = boardAddressOf(JSON.parse(await $.fs.read(file)), projectKey)
      // server.json outlives a server that stopped: the server itself must answer, with this key.
      if (address) {
        const answer = await $.http
          .fetch(`http://127.0.0.1:${address.port}/api/projects`, { headers: { Authorization: `Bearer ${address.token}` } })
          .catch(() => null)
        if (answer?.ok) return { kind: 'running', url: address.url }
      }
    }
  } catch {
    // An unreadable server.json is a server that is not there.
  }
  try {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR'))?.trim()
    for (const file of [...(dir ? [`${dir.replace(/\\/g, '/')}/.claude.json`] : []), `${await homeOf($)}/.claude.json`]) {
      if (!(await $.fs.exists(file))) continue
      const program = coreProgramOf(JSON.parse(await $.fs.read(file)), projectPath)
      if (program && (await $.fs.exists(program))) return { kind: 'stopped', program }
      break
    }
  } catch {
    // Settings that cannot be read: the core is not found.
  }

  return { kind: 'none' }
}

/** The system's own program that opens a URL in the person's browser, by its full path. */
async function opener($: EngineInterface, url: string): Promise<string[]> {
  const root = (await $.env.get('SystemRoot'))?.trim()
  if (root && isPlainProgram(root)) return [`${root.replace(/[\\/]+$/, '')}\\System32\\rundll32.exe`, 'url.dll,FileProtocolHandler', url]
  if (await $.fs.exists('/usr/bin/open')) return ['/usr/bin/open', url]

  return ['/usr/bin/xdg-open', url]
}

/**
 * The button: opens the running board at its address; starts it with the core's own `open` (which prints the address
 * and opens it) when it is installed but not running; points to Set up when it is not. What either program
 * prints is never read into the pane: it holds the key.
 */
export async function openWebBoard($: EngineInterface, projectPath: string, projectKey: string | null): Promise<void> {
  const say = (tone: Notice['tone'], text: string) => update($, notice, () => ({ tone, text }))
  await update($, webOpening, () => true)
  try {
    const board = await webBoardOf($, projectPath, projectKey)
    if (board.kind === 'none') {
      // T-51: never a press that seems to do nothing. The setup card comes back if it was hidden, and a toast says
      // to set up first.
      await update($, webHelp, () => true)
      await update($, setup, s => (s.isHidden ? { ...s, isHidden: false } : s))
      $.ui.toast(t('setup.first'))

      return
    }
    await update($, webHelp, () => false)
    const argv = board.kind === 'running' ? await opener($, board.url) : [board.program, 'open']
    const ran = await $.process.run(argv, { cwd: projectPath, timeoutMs: OPEN_TIMEOUT_MS }).catch(() => null)
    // rundll32 answers 0 or 1 for an opened URL alike; the core's open answers 0 once the browser was asked.
    const isOpened = !!ran && (board.kind === 'running' || ran.exitCode === 0)
    if (isOpened) await say('good', t(board.kind === 'running' ? 'notice.webOpened' : 'notice.webStarted'))
    else await say('bad', t('notice.webFailed'))
  } finally {
    await update($, webOpening, () => false)
  }
}
