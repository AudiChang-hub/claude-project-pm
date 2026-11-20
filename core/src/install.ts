/**
 * `project-pm init` and `project-pm uninstall` for Claude Code (docs/design/v1-core.md 5). init lists every file it
 * would change and changes nothing without --yes (D13). Each change is recorded in install-log.json with what it
 * replaced, so uninstall puts every file back as it was: a file nobody touched since init gets its very bytes back;
 * one edited since loses only what init put in (text between markers, hook entries found by their command). Nothing
 * outside these files is touched: no PATH, no registry, no Node install (5.4).
 */
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { Run } from './host'
import { localRealpath } from './localpath'
import { ct } from './messages'
import { remoteTips } from './prepush'
import type { ProjectRef } from './project'
import { paths, readJsonFile, writeAtomic } from './store'
import { ciTemplate } from './templates'
import { REPORT_TOOL } from './tools'
import { VERSION } from './version'

export const START = '<!-- project-pm:start v1 -->'
export const END = '<!-- project-pm:end -->'
/** The marker of the files init writes whole in a language with # comments (the git hook, the CI workflow). */
export const SH_START = '# project-pm:start v1'
/** Claude Code's events the core's hooks answer, and the tools each one is about ('' is every tool). */
export const HOOK_EVENTS = { UserPromptSubmit: '', PreToolUse: 'Edit|MultiEdit|Write|NotebookEdit', PostToolUse: 'TodoWrite|TaskCreate|TaskUpdate|Bash|PowerShell|Edit|MultiEdit|Write|NotebookEdit', Stop: '' } as const
/** Codex reads 32 KiB of the AGENTS.md chain at most (X2): past this, the section shrinks to one line. */
export const AGENTS_LIMIT = 28 * 1024
/** The section's own budget (5.3). */
export const SECTION_LIMIT = 2 * 1024

export type Change =
  | { kind: 'copy'; file: string; from: string }
  | { kind: 'mcp'; command: string[] }
  | { kind: 'text'; file: string; block: string; atTop?: boolean }
  | { kind: 'whole'; file: string; text: string }
  | { kind: 'hooks'; file: string; command: string }
  | { kind: 'prepush'; file: string; command: string }
  | { kind: 'alias'; repo: string; value: string }

/** What one applied change left behind for uninstall. */
export type Done = Change & {
  at: number
  /** The file was there before init (for the git hook: someone else's hook was, and became pre-push.local). */
  existed?: boolean
  /** A copy of the file as it was before init. */
  backup?: string
  /** The alias's value before init. */
  before?: string
  /** The file as init left it: still the same at uninstall, the backup goes back byte for byte. */
  after?: string
  /** What init put between the old text and its section, so taking the section out leaves the old text. */
  sep?: string
  /** The folder the file's empty parent folders are removed up to. */
  root?: string
  /** The git hook: the remote branches' tips when it was put in (the board names unchecked pushes after them). */
  baseline?: string[]
  /** The project (its key) a project change belongs to; machine-wide changes have none. */
  project?: string
}

export type InstallLog = { version: string; entries: Done[] }

export type InstallEnv = {
  env: NodeJS.ProcessEnv
  run: Run
  /** The person's home folder. */
  home: string
  /** How Claude Code's settings and git's hooks start this program again, before the command's words. */
  self: string[]
  /** The single executable to copy into ~/.project-pm/bin, or null (npm, or the source). */
  exe: string | null
  now: number
}

/** Claude Code's folder: CLAUDE_CONFIG_DIR when set (Claude Code reads it too), else ~/.claude. */
export function claudeDir(ie: Pick<InstallEnv, 'env' | 'home'>): string {
  return ie.env.CLAUDE_CONFIG_DIR?.trim() || join(ie.home, '.claude')
}

/** A command line for sh (git's hooks and aliases, Claude Code's hooks on every platform): slashes forward, odd words quoted. */
export function shCommand(argv: string[]): string {
  return argv
    .map(word => {
      const forward = /^[A-Za-z]:\\/.test(word) || word.includes('\\') ? word.replace(/\\/g, '/') : word

      return /^[\w./:@=+-]+$/.test(forward) ? forward : `"${forward.replace(/(["$`\\])/g, '\\$1')}"`
    })
    .join(' ')
}

/** The AGENTS.md section: what every AI tool in this project is asked to do. */
export function agentsSection(isShort: boolean): string {
  const body = isShort ? ct('agents.short') : ct('agents.section', { tool: REPORT_TOOL })

  return `${START}\n${body.trim()}\n${END}`
}

export function skillText(): string {
  return `---\nname: project-pm\ndescription: ${ct('skill.description')}\n---\n\n${START}\n${ct('skill.body', { tool: REPORT_TOOL }).trim()}\n${END}\n`
}

/**
 * The pre-push hook: runs the hook that was there first (pre-push.local) as git would have, directly and only when it
 * may be executed (its own #! picks sh, node, python…), then the check, both with git's input.
 */
export function prePushScript(command: string): string {
  return [
    '#!/bin/sh',
    `${SH_START} (Project PM: docs/design/v1-core.md 6.2; undo with project-pm uninstall --hooks)`,
    'input=$(cat)',
    'here=$(dirname "$0")',
    'if [ -x "$here/pre-push.local" ]; then',
    '  printf \'%s\\n\' "$input" | "$here/pre-push.local" "$@" || exit $?',
    'fi',
    `printf '%s\\n' "$input" | ${command} check pre-push "$@"`,
    '',
  ].join('\n')
}

/**
 * A file's text, or null when there is none. A repository's AGENTS.md or CLAUDE.md may be a committed link that leads
 * off this machine's disks: that is an error (NotPlainPathError) before anything is read, never "no file" (init would
 * then write one through it).
 */
async function textOf(file: string): Promise<string | null> {
  const real = await localRealpath(file)
  try {
    return await readFile(real ?? file, 'utf8')
  } catch {
    return null
  }
}

/** What goes between a file's own text and a section added after it: a blank line, and no more than needed. */
export function separatorFor(text: string): string {
  if (!text.length || text.endsWith('\n\n')) return ''

  return text.endsWith('\n') ? '\n' : '\n\n'
}

/** A text with our section put in: an older one of ours replaced in place, else added at the top or after a blank line. */
export function withBlock(text: string, block: string, atTop = false): string {
  const at = text.indexOf(START)
  const end = text.indexOf(END, at)
  if (at >= 0 && end > at) return `${text.slice(0, at)}${block}${text.slice(end + END.length)}`
  if (atTop) return `${block}\n${text}`

  return `${text}${separatorFor(text)}${block}\n`
}

/** A text with our section taken out, and the separator init put before it (`sep`) when it is still there. */
export function withoutBlock(text: string, sep = ''): string {
  const at = text.indexOf(START)
  const end = text.indexOf(END, at)
  if (at < 0 || end < at) return text
  let from = at
  if (sep && text.slice(at - sep.length, at) === sep) from = at - sep.length
  let to = end + END.length
  if (text.slice(to, to + 2) === '\r\n') to += 2
  else if (text[to] === '\n') to += 1

  return text.slice(0, from) + text.slice(to)
}

/** Whether the desktop mod is installed: it serves its own project-pm tools and hooks, and two would clash (3.7). */
export function isModInstalled(ie: Pick<InstallEnv, 'env' | 'home'>): boolean {
  const dir = claudeDir(ie)
  if (existsSync(join(dir, 'local-mods', 'project-pm', '.claude-plugin', 'plugin.json'))) return true
  try {
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean> }

    return Object.entries(settings.enabledPlugins ?? {}).some(([name, on]) => on && name.startsWith('project-pm@'))
  } catch {
    return false
  }
}

/**
 * How Claude Code starts the MCP server: as `self`, except npx on Windows, which is a .cmd file that Claude Code
 * starts only through `cmd /c` (git's sh, which runs the hooks and the alias, finds npx as it is).
 */
export function mcpLauncher(self: string[], platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' && self[0] === 'npx' ? ['cmd', '/c', ...self] : self
}

export function binPath(env: NodeJS.ProcessEnv): string {
  return join(paths(env).bin, `project-pm-${VERSION}${process.platform === 'win32' ? '.exe' : ''}`)
}

/** Every change init would make for this project, and why some it would not. */
export async function planInstall(ref: ProjectRef, ie: InstallEnv, options: { ci: boolean }): Promise<{ changes: Change[]; notes: string[] }> {
  const changes: Change[] = []
  const notes: string[] = []
  const log = await readLog(ie.env)
  const bin = binPath(ie.env)
  const self = ie.exe ? [bin] : ie.self
  if (ie.exe) changes.push({ kind: 'copy', file: bin, from: ie.exe })
  const command = shCommand(self)
  const claude = claudeDir(ie)
  const hasClaude = (await ie.run(['claude', '--version'], ref.path, 15_000)) !== null
  const isMod = isModInstalled(ie)
  if (!hasClaude) notes.push(ct('init.noClaude'))
  if (isMod) notes.push(ct('init.modInstalled'))
  else {
    if (hasClaude) {
      const existing = await ie.run(['claude', 'mcp', 'get', 'project-pm'], ref.path, 20_000)
      if (existing !== null && !log.entries.some(e => e.kind === 'mcp')) notes.push(ct('init.mcpTaken'))
      else changes.push({ kind: 'mcp', command: [...mcpLauncher(self), 'mcp'] })
    }
    changes.push({ kind: 'hooks', file: join(claude, 'settings.json'), command })
  }
  const agentsFile = join(ref.path, 'AGENTS.md')
  const agents = withoutOurs(await textOf(agentsFile))
  const override = (await textOf(join(ref.path, 'AGENTS.override.md'))) ?? ''
  const isShort = Buffer.byteLength(agents + override) + SECTION_LIMIT > AGENTS_LIMIT
  if (isShort) notes.push(ct('init.agentsLong'))
  // 2.1: the PM keeps nothing in the project, but a .project-pm/ folder someone made there must not reach git.
  const kept = await localRealpath(join(ref.path, '.project-pm'))
  if (kept && existsSync(kept) && (await ie.run(['git', 'check-ignore', '-q', '.project-pm/'], ref.path)) === null) notes.push(ct('init.gitignoreHint'))
  changes.push({ kind: 'text', file: agentsFile, block: agentsSection(isShort) })
  const claudeFile = join(ref.path, 'CLAUDE.md')
  const claudeMd = await textOf(claudeFile)
  if (claudeMd !== null && (claudeMd.includes(START) || !/^@AGENTS\.md\s*$/m.test(claudeMd))) changes.push({ kind: 'text', file: claudeFile, block: `${START}\n@AGENTS.md\n${END}`, atTop: true })
  const skill = join(claude, 'skills', 'project-pm', 'SKILL.md')
  const skillNow = await textOf(skill)
  if (skillNow !== null && !skillNow.includes(START)) notes.push(ct('init.skillTaken', { file: skill }))
  else changes.push({ kind: 'whole', file: skill, text: skillText() })
  const hooksDir = await ie.run(['git', 'rev-parse', '--path-format=absolute', '--git-path', 'hooks'], ref.path)
  if (hooksDir) changes.push({ kind: 'prepush', file: join(hooksDir, 'pre-push'), command })
  const alias = await ie.run(['git', 'config', '--local', '--get', 'alias.pm'], ref.path)
  const aliasValue = `!${command}`
  const isOurAlias = log.entries.some(e => e.kind === 'alias' && e.repo === ref.path)
  if (alias && alias !== aliasValue && !isOurAlias) notes.push(ct('init.aliasTaken', { value: alias, command: `${command} skip "…"` }))
  else changes.push({ kind: 'alias', repo: ref.path, value: aliasValue })
  if (options.ci) {
    const workflow = join(ref.path, '.github', 'workflows', 'project-pm-qa.yml')
    const now = await textOf(workflow)
    if (now !== null && !now.includes(SH_START)) notes.push(ct('init.ciTaken', { file: workflow }))
    else changes.push({ kind: 'whole', file: workflow, text: ciTemplate() })
  }

  return { changes, notes }
}

function withoutOurs(text: string | null): string {
  return text === null ? '' : withoutBlock(text)
}

/** How a change reads in init's list: the file and what goes in. */
export function describe(change: Change): string {
  switch (change.kind) {
    case 'copy':
      return ct('init.copy', { file: change.file })
    case 'mcp':
      return ct('init.mcp', { command: `claude mcp add --scope user project-pm -- ${shCommand(change.command)}` })
    case 'text':
      return ct('init.text', { file: change.file, lines: change.block.split('\n').map(line => `    + ${line}`).join('\n') })
    case 'whole':
      return ct('init.whole', { file: change.file })
    case 'hooks':
      return ct('init.hooks', { file: change.file, events: Object.keys(HOOK_EVENTS).join(', '), command: `${change.command} hook claude-code <event>` })
    case 'prepush':
      return ct('init.prepush', { file: change.file })
    case 'alias':
      return ct('init.alias', { value: change.value })
  }
}

async function backupOf(ie: InstallEnv, file: string): Promise<string | undefined> {
  if (!existsSync(file)) return undefined
  const backup = join(paths(ie.env).home, 'backups', String(ie.now), `${Math.random().toString(36).slice(2, 8)}-${basename(file)}`)
  await mkdir(dirname(backup), { recursive: true })
  await copyFile(file, backup)

  return backup
}

type HookGroup = { matcher?: string; hooks?: { type?: string; command?: string }[] }
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>

/** Whether a hook command is one of ours (this program or an older copy of it, on a Claude Code event). */
const isOurHook = (command: string | undefined, ours: string) => !!command && (command.startsWith(`${ours} hook claude-code `) || /project-pm[^ ]* hook claude-code /.test(command))

/** Settings with our hook entries put in (replacing older ones of ours) or only taken out. */
export function withHooks(settings: Settings, ours: string, put: boolean): Settings {
  const next: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } }
  for (const event of Object.keys(next.hooks!)) {
    const groups = (next.hooks![event] ?? [])
      .map(group => ({ ...group, hooks: (group.hooks ?? []).filter(h => !isOurHook(h.command, ours)) }))
      .filter(group => group.hooks.length > 0)
    if (groups.length) next.hooks![event] = groups
    else delete next.hooks![event]
  }
  if (put) {
    for (const [event, matcher] of Object.entries(HOOK_EVENTS)) {
      next.hooks![event] = [...(next.hooks![event] ?? []), { matcher, hooks: [{ type: 'command', command: `${ours} hook claude-code ${event}` }] }]
    }
  }
  if (!Object.keys(next.hooks!).length) delete next.hooks

  return next
}

/** Applies one change and says what it left for uninstall; `prior` is the file's text just before (not logged). */
export async function apply(change: Change, ie: InstallEnv, ref: ProjectRef): Promise<Done & { prior?: string | null }> {
  const at = ie.now
  switch (change.kind) {
    case 'copy': {
      await mkdir(dirname(change.file), { recursive: true })
      if (change.from !== change.file) await copyFile(change.from, change.file)
      if (process.platform !== 'win32') await chmod(change.file, 0o755)

      return { ...change, at, root: paths(ie.env).home }
    }
    case 'mcp': {
      const before = await ie.run(['claude', 'mcp', 'get', 'project-pm'], ref.path, 20_000)
      if (before !== null) await ie.run(['claude', 'mcp', 'remove', '--scope', 'user', 'project-pm'], ref.path, 20_000)
      const added = await ie.run(['claude', 'mcp', 'add', '--scope', 'user', 'project-pm', '--', ...change.command], ref.path, 20_000)
      if (added === null) throw new Error(ct('init.mcpFailed'))

      return { ...change, at, existed: false }
    }
    case 'text': {
      const prior = await textOf(change.file)
      const backup = await backupOf(ie, change.file)
      const isReplacing = prior !== null && prior.includes(START)
      const after = withBlock(prior ?? '', change.block, change.atTop)
      await writeAtomic(change.file, after)

      return { ...change, at, existed: prior !== null, backup, after, sep: change.atTop || isReplacing ? '' : separatorFor(prior ?? ''), root: ref.path, project: ref.key, prior }
    }
    case 'whole': {
      const prior = await textOf(change.file)
      const backup = await backupOf(ie, change.file)
      await writeAtomic(change.file, change.text)
      const isProject = change.file.startsWith(ref.path)

      return { ...change, at, existed: prior !== null, backup, after: change.text, root: isProject ? ref.path : ie.home, ...(isProject ? { project: ref.key } : {}), prior }
    }
    case 'hooks': {
      const prior = await textOf(change.file)
      const backup = await backupOf(ie, change.file)
      const settings = prior?.trim() ? (JSON.parse(prior) as Settings) : {}
      const after = `${JSON.stringify(withHooks(settings, change.command, true), null, 2)}\n`
      await writeAtomic(change.file, after)

      return { ...change, at, existed: prior !== null, backup, after, root: ie.home, prior }
    }
    case 'prepush': {
      const prior = await textOf(change.file)
      const isOursAlready = prior !== null && prior.includes(SH_START)
      if (prior !== null && !isOursAlready) await rename(change.file, join(dirname(change.file), 'pre-push.local'))
      await writeAtomic(change.file, prePushScript(change.command))
      if (process.platform !== 'win32') await chmod(change.file, 0o755)

      return { ...change, at, existed: prior !== null && !isOursAlready, baseline: await remoteTips(ref.path, ie.run), project: ref.key }
    }
    case 'alias': {
      const before = await ie.run(['git', 'config', '--local', '--get', 'alias.pm'], change.repo)
      const set = await ie.run(['git', 'config', '--local', 'alias.pm', change.value], change.repo)
      if (set === null) throw new Error('git config alias.pm failed')

      return { ...change, at, existed: before !== null, ...(before !== null ? { before } : {}), project: ref.key }
    }
  }
}

/** Takes a file init made out again, and the folders it made for it that are now empty. */
async function removeMade(file: string, root: string | undefined) {
  await unlink(file).catch(() => {})
  if (root) await removeEmptyDirs(dirname(file), root)
}

/** Undoes one change; a file nobody changed since init is left exactly as it was before init. */
export async function undo(done: Done, ie: InstallEnv): Promise<string | void> {
  switch (done.kind) {
    case 'copy':
      try {
        await rm(done.file, { force: true })
      } catch (err) {
        // Windows will not delete a program while it runs: this very one, when uninstall runs from the copy.
        if (isThisProgram(done.file) && deleteAfterExit(done.file, ie.env)) return ct('uninstall.deleteLater', { file: done.file })
        throw err
      }
      await removeEmptyDirs(dirname(done.file), done.root ?? dirname(done.file))
      return
    case 'mcp':
      await ie.run(['claude', 'mcp', 'remove', '--scope', 'user', 'project-pm'], ie.home, 20_000)
      return
    case 'text':
    case 'whole':
    case 'hooks': {
      const now = await textOf(done.file)
      if (now === null) return
      if (now === done.after) {
        if (done.existed && done.backup && existsSync(done.backup)) await copyFile(done.backup, done.file)
        else if (!done.existed) await removeMade(done.file, done.root)

        return
      }
      // Changed since init: take out only what init put in.
      if (done.kind === 'whole') {
        if (!done.existed && (now.includes(START) || now.includes(SH_START))) await removeMade(done.file, done.root)

        return
      }
      if (done.kind === 'hooks') {
        let settings: Settings
        try {
          settings = JSON.parse(now) as Settings
        } catch {
          return
        }
        const rest = withHooks(settings, done.command, false)
        if (!done.existed && !Object.keys(rest).length) await removeMade(done.file, done.root)
        else await writeAtomic(done.file, `${JSON.stringify(rest, null, 2)}\n`)

        return
      }
      const rest = withoutBlock(now, done.sep)
      if (!done.existed && !rest.trim()) await removeMade(done.file, done.root)
      else await writeAtomic(done.file, rest)

      return
    }
    case 'prepush': {
      const now = await textOf(done.file)
      if (now !== null && now.includes(SH_START)) await unlink(done.file)
      const local = join(dirname(done.file), 'pre-push.local')
      if (done.existed && existsSync(local) && !existsSync(done.file)) await rename(local, done.file)

      return
    }
    case 'alias': {
      const now = await ie.run(['git', 'config', '--local', '--get', 'alias.pm'], done.repo)
      if (now !== done.value) return
      if (done.before !== undefined) await ie.run(['git', 'config', '--local', 'alias.pm', done.before], done.repo)
      else await ie.run(['git', 'config', '--local', '--unset', 'alias.pm'], done.repo)

      return
    }
  }
}

/** Removes folders that are empty, from `dir` up to (not including) `stop`. */
async function removeEmptyDirs(dir: string, stop: string) {
  // One spelling for both (PROJECT_PM_HOME may be written with forward slashes on Windows).
  let at = resolve(dir)
  const end = resolve(stop)
  while (at.startsWith(end) && at.length > end.length) {
    try {
      if ((await readdir(at)).length) return
      await rmdir(at)
    } catch {
      return
    }
    at = dirname(at)
  }
}

export async function readLog(env: NodeJS.ProcessEnv): Promise<InstallLog> {
  return (await readJsonFile<InstallLog>(paths(env).installLog).catch(() => null)) ?? { version: VERSION, entries: [] }
}

export async function writeLog(env: NodeJS.ProcessEnv, log: InstallLog) {
  if (!log.entries.length) {
    await rm(paths(env).installLog, { force: true })

    return
  }
  await writeAtomic(paths(env).installLog, `${JSON.stringify(log, null, 2)}\n`)
}

export type InitResult = { applied: Done[]; notes: string[]; failed: string[] }

/** init: lists the changes; with `yes`, applies them, records them, and checks Claude Code sees the server. */
export async function init(ref: ProjectRef, ie: InstallEnv, options: { yes: boolean; ci: boolean }, say: (text: string) => void): Promise<InitResult> {
  const { changes, notes } = await planInstall(ref, ie, { ci: options.ci })
  say(ct('init.heading', { project: ref.name, path: ref.path }))
  for (const change of changes) say(describe(change))
  for (const note of notes) say(`! ${note}`)
  if (!options.yes) {
    say(ct('init.dryRun'))

    return { applied: [], notes, failed: [] }
  }
  const log = await readLog(ie.env)
  const applied: Done[] = []
  const failed: string[] = []
  for (const change of changes) {
    try {
      const { prior, ...done } = await apply(change, ie, ref)
      applied.push(done)
      const older = log.entries.findIndex(e => sameTarget(e, done))
      if (older < 0) log.entries.push(done)
      else {
        // Made again: what was there before the first time still stands, unless the file was changed in between.
        const first = log.entries[older]!
        const isUntouched = first.after === undefined || prior === first.after
        log.entries[older] = isUntouched ? { ...done, existed: first.existed, backup: first.backup, before: first.before, sep: first.sep ?? done.sep, baseline: first.baseline ?? done.baseline } : done
      }
    } catch (err) {
      failed.push(`${describe(change).split('\n')[0]}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  await writeLog(ie.env, log)
  // Claude Code must now list the server (no model, no cost).
  if (applied.some(d => d.kind === 'mcp')) {
    const listed = await ie.run(['claude', 'mcp', 'list'], ref.path, 60_000)
    if (!listed || !listed.includes('project-pm')) {
      const entry = log.entries.find(e => e.kind === 'mcp')
      if (entry) await undo(entry, ie)
      log.entries = log.entries.filter(e => e.kind !== 'mcp')
      await writeLog(ie.env, log)
      failed.push(ct('init.mcpNotListed'))
    }
  }
  say(failed.length ? ct('init.partly', { n: applied.length, failed: failed.join('\n') }) : ct('init.done', { n: applied.length }))

  return { applied, notes, failed }
}

function sameTarget(a: Done | Change, b: Done | Change): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'mcp') return true
  if (a.kind === 'alias' && b.kind === 'alias') return a.repo === b.repo

  return 'file' in a && 'file' in b && a.file === b.file
}

/**
 * uninstall: undoes what init recorded for this project, the newest first, and the machine-wide changes (the program,
 * the MCP server, Claude Code's hooks, the skill) once no other project still uses them. `hooksOnly` takes out the
 * git hook and the alias alone (6.3).
 */
export async function uninstall(ref: ProjectRef | null, ie: InstallEnv, options: { yes: boolean; hooksOnly: boolean }, say: (text: string) => void): Promise<number> {
  const log = await readLog(ie.env)
  const ofProject = (e: Done) => !!e.project && e.project === ref?.key
  const isHook = (e: Done) => e.kind === 'prepush' || e.kind === 'alias'
  const mine = log.entries.filter(e => ofProject(e) && (!options.hooksOnly || isHook(e)))
  const othersLeft = log.entries.some(e => e.project && !ofProject(e))
  const shared = options.hooksOnly || othersLeft ? [] : log.entries.filter(e => !e.project)
  const chosen = [...mine, ...shared]
  if (!chosen.length) {
    say(ct('uninstall.nothing'))

    return 0
  }
  for (const entry of chosen) say(ct('uninstall.item', { what: describe(entry).split('\n')[0]! }))
  if (!options.yes) {
    say(ct('uninstall.dryRun'))

    return 0
  }
  const order = log.entries.filter(e => chosen.includes(e)).reverse()
  // One change that cannot be undone stops none of the others, and the log is written either way: what failed stays
  // in it, so uninstall can be run again.
  const failed = new Set<Done>()
  const notes: string[] = []
  for (const entry of order) {
    try {
      const note = await undo(entry, ie)
      if (note) notes.push(note)
    } catch (err) {
      failed.add(entry)
      const what = describe(entry).split('\n')[0]!
      const reason = err instanceof Error ? err.message : String(err)
      notes.push('file' in entry ? ct('uninstall.failedFile', { what, reason, file: entry.file }) : ct('uninstall.failed', { what, reason }))
    }
  }
  log.entries = log.entries.filter(e => !chosen.includes(e) || failed.has(e))
  await writeLog(ie.env, log)
  say(ct('uninstall.done', { n: chosen.length - failed.size }))
  for (const note of notes) say(`! ${note}`)

  return chosen.length - failed.size
}

/** Whether `file` is the program running now. */
function isThisProgram(file: string): boolean {
  const norm = (path: string) => resolve(path).toLowerCase()

  return process.platform === 'win32' && norm(file) === norm(process.execPath)
}

/**
 * The script that deletes the program once it ends (Windows). Its paths come in as arguments, so no path is ever parsed
 * as part of the script: %1 the program, %2 its folder, %3 the note that says it failed, %4 how many tries, %5 whether
 * to open that note. One try a second; when the last fails the note is opened, so the user knows the file is still there.
 */
const DELETE_SCRIPT = [
  '@echo off',
  'setlocal',
  'set tried=0',
  ':again',
  'ping -n 2 127.0.0.1 >nul',
  'del /f /q "%~1" >nul 2>nul',
  'if not exist "%~1" goto gone',
  'set /a tried+=1',
  'if %tried% lss %4 goto again',
  'if "%5"=="1" start "" notepad.exe "%~3"',
  'goto end',
  ':gone',
  'rmdir "%~2" >nul 2>nul',
  'del /f /q "%~3" >nul 2>nul',
  ':end',
  '(goto) 2>nul & del /f /q "%~f0"',
  '',
].join('\r\n')

/** Whether `file` is inside `folder` (not the folder itself), however either is written. */
function isInside(file: string, folder: string): boolean {
  const norm = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))
  const rel = relative(norm(folder), norm(file))

  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Windows: deletes `file` (and its folder, when empty) once this program ends, from a hidden cmd that outlives it: it
 * tries once a second, `tries` times, and if the file is still there then, opens a note that says so. Only ever a file
 * in the data folder's bin. Null when it is not, or the script cannot be started.
 */
export function deleteAfterExit(file: string, env: NodeJS.ProcessEnv, { tries = 60, show = true } = {}): { script: string; note: string } | null {
  if (!isInside(file, paths(env).bin)) return null
  const stamp = `project-pm-delete-${process.pid}-${Date.now()}`
  const script = join(tmpdir(), `${stamp}.cmd`)
  const note = join(tmpdir(), `${stamp}.txt`)
  try {
    writeFileSync(script, DELETE_SCRIPT)
    writeFileSync(note, ct('uninstall.deleteFailed', { file }))
    const line = `""${script}" "${file}" "${dirname(file)}" "${note}" ${Math.max(1, Math.floor(tries))} ${show ? 1 : 0}"`
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
    child.unref()

    return { script, note }
  } catch {
    rmSync(script, { force: true })
    rmSync(note, { force: true })

    return null
  }
}
