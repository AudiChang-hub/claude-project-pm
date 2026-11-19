/**
 * A fake world for the core's tests: a home folder in the system's temp folder (the core's data and the mod's both
 * live under it), and the Acme demo shop as a git repository. Nothing touches the real ~/.project-pm or ~/.claude.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
