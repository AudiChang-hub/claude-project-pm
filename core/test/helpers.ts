/**
 * A fake world for the core's tests: a home folder in the system's temp folder (the core's data and the mod's both
 * live under it), and the Acme demo shop as a git repository. Nothing touches the real ~/.project-pm or ~/.claude.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pm-core-')))
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
