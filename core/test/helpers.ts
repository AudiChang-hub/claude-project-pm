/**
 * A fake world for the core's tests: a home folder in the system's temp folder (the core's data and the mod's both
 * live under it), and the Acme demo shop as a git repository. Nothing touches the real ~/.project-pm or ~/.claude.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { setLang } from '../../hooks/messages'
import type { Lang } from '../../hooks/messages'
import type { Ctx } from '../src/context'
import { newCtx } from '../src/context'
import type { Run } from '../src/host'
import { run as hostRun } from '../src/host'
import { forgetLogin } from '../src/identity'

export const LANGS: Lang[] = ['zh-TW', 'en']

export const NOW = Date.parse('2026-11-19T12:00:00.000Z')

/** git and gh, with gh answering nothing (no network in tests) unless `gh` is given. */
export function hostWith(gh: (argv: string[]) => string | null = () => null): Run {
  return async (argv, cwd, timeoutMs) => (argv[0] === 'gh' ? gh(argv) : hostRun(argv, cwd, timeoutMs))
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

export type World = {
  root: string
  home: string
  repo: string
  env: NodeJS.ProcessEnv
  ctx: (actor?: string, extra?: Partial<Ctx>) => Ctx
  commit: (file: string, text: string, message: string) => string
  /** Moves the tools' clock on. */
  advance: (ms: number) => void
  done: () => void
}

/** A fresh world: `lang` is the language the tools answer in. With `legacy`, the mod's folder exists (it is installed). */
export function world(lang: Lang, { legacy = false } = {}): World {
  // The folder as git and the program spell it: the native realpath expands Windows' 8.3 names (C:\Users\RUNNER~1 on
  // GitHub's runners), which the JavaScript one keeps.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pm-core-')))
  const home = join(root, 'home')
  const repo = join(root, 'acme-shop')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  if (legacy) mkdirSync(join(home, '.claude', 'project-pm', 'projects'), { recursive: true })
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.HOME = home
  process.env.USERPROFILE = home
  const env: NodeJS.ProcessEnv = { ...process.env, PROJECT_PM_HOME: join(home, '.project-pm'), PROJECT_PM_NO_GH: '1' }
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'Acme Dev')
  git(repo, 'config', 'user.email', 'dev@acme.example')
  git(repo, 'config', 'commit.gpgsign', 'false')
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(repo, file), text)
    git(repo, 'add', file)
    git(repo, 'commit', '-q', '-m', message)

    return git(repo, 'rev-parse', 'HEAD')
  }
  commit('README.md', '# Acme Shop\n', 'Start the Acme shop')
  setLang(lang)
  forgetLogin()
  let clock = NOW

  return {
    root,
    home,
    repo,
    env,
    ctx: (actor = 'claude-code:pm1', extra = {}) => {
      const ctx = newCtx({ actor, tool: 'claude-code', cwd: repo, env, run: hostWith(), now: () => clock, ...extra })
      // newCtx reads the language from the environment: the test's own stands.
      setLang(lang)

      return ctx
    },
    commit,
    advance: ms => {
      clock += ms
    },
    done: () => {
      process.env.HOME = saved.HOME
      process.env.USERPROFILE = saved.USERPROFILE
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * How to start the program: the source through tsx, or the built executable or bundle named by PROJECT_PM_BIN
 * (the build's tests run the same suites against what ships).
 */
export function serverCommand(...args: string[]): { command: string; args: string[] } {
  const bin = process.env.PROJECT_PM_BIN
  if (bin) return bin.endsWith('.cjs') || bin.endsWith('.js') ? { command: process.execPath, args: [bin, ...args] } : { command: bin, args }
  const tsx = import.meta.resolve('tsx')
  const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))

  return { command: process.execPath, args: ['--import', tsx, main, ...args] }
}

/**
 * Claude Code's command line as init uses it (`--version`, `mcp get|add|remove|list`), without Claude Code: the
 * user-scope MCP servers live in `<home>/.claude.json` as Claude Code keeps them, so a test sees what init left.
 */
export function fakeClaude(home: string, rest: Run = hostWith(), { installed = true } = {}): Run {
  const file = join(home, '.claude.json')
  const read = (): { mcpServers?: Record<string, { command: string; args: string[] }> } & Record<string, unknown> => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})
  const write = (data: Record<string, unknown>) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)

  return async (argv, cwd, timeoutMs) => {
    if (argv[0] !== 'claude') return rest(argv, cwd, timeoutMs)
    if (!installed) return null
    const [, a, b, ...more] = argv
    if (a === '--version') return '2.1.326 (Claude Code)'
    if (a !== 'mcp') return null
    const data = read()
    const servers = data.mcpServers ?? {}
    if (b === 'list') return Object.entries(servers).map(([name, s]) => `${name}: ${[s.command, ...s.args].join(' ')} - ✓ Connected`).join('\n')
    if (b === 'get') return servers['project-pm'] ? `project-pm:\n  Scope: User config\n  Command: ${servers['project-pm'].command}` : null
    if (b === 'remove') {
      if (!servers['project-pm']) return null
      delete servers['project-pm']
      if (Object.keys(servers).length) data.mcpServers = servers
      else delete data.mcpServers
      write(data)

      return 'Removed MCP server project-pm'
    }
    if (b === 'add') {
      const at = more.indexOf('--')
      const [command, ...args] = more.slice(at + 1)
      data.mcpServers = { ...servers, 'project-pm': { command: command!, args } }
      write(data)

      return 'Added stdio MCP server project-pm'
    }

    return null
  }
}

/** Windows' 8.3 short name for an existing path (C:\Users\RUNNER~1\…), or null where there is none or off Windows. */
export function shortPath(path: string): string | null {
  if (process.platform !== 'win32') return null
  const out = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"for %I in ("${path}") do @echo %~sI"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
  const short = out.status === 0 ? out.stdout.trim() : ''

  return short && !short.includes('"') ? short : null
}

/** The made-up host every network path in the tests names: `.invalid` never resolves, so nothing could answer. */
export const PROBE_HOST = 'pm-unc-probe.invalid'

/** Whether a path, as handed to the file system, names another machine (or a device other than a drive). */
function isRemoteSpelling(value: unknown): boolean {
  const text = value instanceof URL ? value.href : Buffer.isBuffer(value) ? value.toString() : typeof value === 'string' ? value : ''
  const path = text.replace(/\//g, '\\')
  if (path.toLowerCase().includes(PROBE_HOST)) return true
  if (/^\\\\[?.]\\[a-z]:(\\|$)/i.test(path)) return false

  return path.startsWith('\\\\')
}

/**
 * Watches every way the program could look a path up on disk (node:fs and node:fs/promises, sync and async) and
 * records each call that names another machine, failing it at once, so a test proves the program never asks without
 * ever waiting on the network. `links` makes a local path look like a link to the target given (Windows: any link
 * a repository or a person could leave, without Developer Mode). `restore` puts the real functions back.
 */
export function watchFs(links: Record<string, string> = {}): { remote: string[]; restore: () => void } {
  const require = createRequire(import.meta.url)
  const fs = require('node:fs') as Record<string, unknown> & { realpathSync: { native: unknown } }
  const fsp = require('node:fs/promises') as Record<string, unknown>
  const remote: string[] = []
  const undo: (() => void)[] = []
  const fakeLink = { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
  /** The link a path is (`self`) or goes through (`under`), and where the system would really go for it. */
  const through = (value: unknown): { self: boolean; to: string } | null => {
    if (typeof value !== 'string') return null
    const path = value.toLowerCase()
    for (const [link, target] of Object.entries(links)) {
      const name = link.toLowerCase()
      if (path === name) return { self: true, to: target }
      if (path.startsWith(`${name}\\`) || path.startsWith(`${name}/`)) return { self: false, to: target + value.slice(link.length) }
    }

    return null
  }
  const refuse = (path: unknown) => {
    remote.push(String(path))
    return Object.assign(new Error(`test: ${String(path)} names another machine`), { code: 'ENOENT' })
  }
  const swap = (target: Record<string, unknown>, name: string, async: boolean) => {
    const real = target[name] as (...args: unknown[]) => unknown
    if (typeof real !== 'function') return
    const native = (real as unknown as { native?: unknown }).native
    const guard = (name: string, args: unknown[]): { value: unknown } | { err: Error } | null => {
      const [path, dest] = args
      if (isRemoteSpelling(path) || isRemoteSpelling(dest)) return { err: refuse(isRemoteSpelling(path) ? path : dest) }
      const link = through(path) ?? through(dest)
      if (!link) return null
      // A link itself may be looked at (lstat, readlink); anything else goes where it leads, as the system would.
      if (link.self && /^lstat/.test(name)) return { value: fakeLink }
      if (link.self && /^readlink/.test(name)) return { value: link.to }

      return { err: refuse(link.to) }
    }
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const hit = guard(name, args)
      if (!hit) return real.apply(this, args)
      if ('value' in hit) return async ? Promise.resolve(hit.value) : hit.value
      if (async) return Promise.reject(hit.err)
      if (name === 'existsSync') return false
      throw hit.err
    }
    if (native) {
      ;(wrapped as unknown as { native: unknown }).native = function (this: unknown, ...args: unknown[]) {
        const hit = guard(name, args)
        if (!hit) return (native as (...a: unknown[]) => unknown).apply(this, args)
        if ('value' in hit) return hit.value
        throw hit.err
      }
    }
    target[name] = wrapped
    undo.push(() => {
      target[name] = real
    })
  }
  for (const name of ['realpath', 'lstat', 'stat', 'readlink', 'access', 'open', 'opendir', 'readdir', 'readFile', 'writeFile', 'appendFile', 'copyFile', 'cp', 'mkdir', 'rename', 'rm', 'unlink', 'statfs']) swap(fsp, name, true)
  for (const name of ['realpathSync', 'lstatSync', 'statSync', 'readlinkSync', 'accessSync', 'existsSync', 'openSync', 'opendirSync', 'readdirSync', 'readFileSync', 'writeFileSync', 'copyFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'statfsSync']) swap(fs, name, false)
  syncBuiltinESMExports()

  return {
    remote,
    restore: () => {
      for (const step of undo.reverse()) step()
      syncBuiltinESMExports()
    },
  }
}
