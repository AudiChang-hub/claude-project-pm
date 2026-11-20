/**
 * The commands the core runs (git, gh, claude), never through a shell but in one case (a command npm installed on
 * Windows, below), on Windows each by the full path it is found at on PATH's plain local folders, and the paths it
 * keeps its data under.
 */
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { plainLocalPath } from './localpath'

export const GIT_TIMEOUT_MS = 4_000
export const GH_TIMEOUT_MS = 8_000

/** What a command printed (trimmed) when it exits 0; null when it fails, is missing or takes too long. */
export type Run = (argv: string[], cwd: string, timeoutMs?: number) => Promise<string | null>

const MAX_BUFFER = 16 * 1024 * 1024

/**
 * Windows looks for a program named without a folder (git, gh, claude, and inside a batch file node, ping) in the
 * current folder before PATH, unless NoDefaultCurrentDirectoryInExePath is set in the environment of the process that
 * starts it; Node asks Windows the same for every program it starts. The current folder is often the person's
 * repository, which could hold a git.exe or a node.cmd of its own (T-39 QA8; Claude Code's own shell sets the
 * variable, which hid this). Set in this process before anything is started, so every program started, and every one
 * those start, has it.
 */
export function noProgramsFromCurrentFolder(): void {
  if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1'
}

/**
 * One of Windows' own programs (cmd.exe, rundll32.exe), by its full path in System32: never one in the current folder,
 * on PATH, or one ComSpec names. SystemRoot (or windir) is taken only when it is a plain path on this machine's own
 * disks (plainLocalPath), else C:\Windows (T-39 QA9).
 */
export function systemProgram(name: string): string {
  const root = [process.env.SystemRoot, process.env.windir].map(value => (value && /^[A-Za-z]:\\/.test(value) ? plainLocalPath(value, value, 'win32') : null)).find(Boolean)

  return join(root ?? 'C:\\Windows', 'System32', name)
}

/** Windows' own cmd.exe (systemProgram). */
export function systemCmd(): string {
  return systemProgram('cmd.exe')
}

export const run: Run = (argv, cwd, timeoutMs = GIT_TIMEOUT_MS) =>
  new Promise(resolve => {
    const [command, ...args] = argv
    if (!command) return resolve(null)
    const done = (err: Error | null, stdout: string) => resolve(err ? null : String(stdout).trim())
    try {
      if (process.platform !== 'win32') {
        execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, done)

        return
      }
      // Windows: a program named without a folder is looked for here, on PATH's plain local folders only, and started by
      // its full path; Windows' own search would also try the current folder, and any ".", relative or empty entry on
      // PATH, both of which the repository chooses the files of (T-39 QA8, QA9).
      noProgramsFromCurrentFolder()
      const env = childEnv()
      if (!isBare(command)) {
        execFile(command, args, { cwd, env, timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, done)

        return
      }
      const hasExt = /\.(exe|com)$/i.test(command)
      const exe = onPath(command, hasExt ? [''] : ['.com', '.exe'])
      if (exe) {
        execFile(exe, args, { cwd, env, timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, done)

        return
      }
      // None: it may be a .cmd file, as npm installs every command there (claude.cmd), which a program started without a
      // shell is never found as (CI run 44723838413: init said Claude Code was missing).
      const batch = hasExt ? null : onPath(command, ['.cmd', '.bat'])
      if (!batch) return resolve(null)
      runBatch(batch, args, timeoutMs).then(resolve, () => resolve(null))
    } catch {
      resolve(null)
    }
  })

/** A program's name alone, as a caller writes it (git, gh, claude): no folder, nothing a shell would read. */
const isBare = (command: string) => /^[\w.-]+$/.test(command)

/**
 * PATH's folders that are absolute plain paths on this machine's own disks (Windows), each once: no ".", relative or
 * empty entry (read against the current folder, often the repository), and no network folder (plainLocalPath: looking
 * in one would connect to it).
 */
export function pathFolders(path: string = process.env.PATH ?? ''): string[] {
  const folders: string[] = []
  for (const entry of path.split(';')) {
    const folder = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!/^[A-Za-z]:[\\/]/.test(folder)) continue
    const plain = plainLocalPath(folder, folder, 'win32')
    if (plain && !folders.some(known => known.toLowerCase() === plain.toLowerCase())) folders.push(plain)
  }

  return folders
}

/** The first file `command` with one of `exts` is in PATH's plain local folders (pathFolders), or null. */
function onPath(command: string, exts: string[]): string | null {
  for (const folder of pathFolders()) {
    for (const ext of exts) {
      const file = join(folder, `${command}${ext}`)
      if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file
    }
  }

  return null
}

/**
 * The environment a program the core starts gets on Windows: PATH with its plain local folders only (pathFolders),
 * so that the programs it starts by name in turn (git's own, a batch file's node) are not looked for in a folder the
 * repository chooses either; and NoDefaultCurrentDirectoryInExePath set.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!/^path$/i.test(key)) env[key] = value
  env.PATH = pathFolders().join(';')
  env.NoDefaultCurrentDirectoryInExePath = '1'

  return env
}

/**
 * Whether cmd.exe reads `text`, inside double quotes, as just that text, and the program the batch file hands it on to
 * gets it back the same: no quote, percent sign (a variable), exclamation mark (one too, were delayed expansion on), line
 * break or other control character, and no backslash at the end (it would escape the closing quote). & | < > ( ) ^ and
 * spaces are only text inside the quotes.
 */
const isCmdSafe = (text: string) => !/["%!\u0000-\u001f]/.test(text) && !text.endsWith('\\')

/**
 * Runs a batch file through Windows' own cmd.exe: each argument quoted, and only when every one of them, and the
 * file's own path, is read by cmd.exe as given (isCmdSafe); otherwise nothing runs, as for a command not found. It runs
 * in the batch file's own folder, not the repository: the commands it serves (claude --version, claude mcp get, add,
 * remove and list) are about the person's user-level setting, and none needs the repository's folder; and with
 * NoDefaultCurrentDirectoryInExePath set (noProgramsFromCurrentFolder) the `node` an npm batch file names is never
 * looked for in the current folder either (T-39 QA8).
 */
function runBatch(file: string, args: string[], timeoutMs: number): Promise<string | null> {
  if (![file, ...args].every(isCmdSafe)) return Promise.resolve(null)
  const line = [file, ...args].map(arg => `"${arg}"`).join(' ')

  return new Promise(resolve => {
    // /d: no AutoRun commands; /v:off: no delayed expansion; /s /c "…": the outer quotes are taken off, the rest kept.
    noProgramsFromCurrentFolder()
    execFile(systemCmd(), ['/d', '/v:off', '/s', '/c', `"${line}"`], { cwd: dirname(file), env: childEnv(), timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout) =>
      resolve(err ? null : String(stdout).trim()),
    )
  })
}

/** Where the core keeps its data: PROJECT_PM_HOME, else ~/.project-pm. */
export function dataHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROJECT_PM_HOME?.trim() || join(homedir(), '.project-pm')
}

/** Where the desktop mod (v0.9) keeps its data: ~/.claude/project-pm. The core reads it, and writes projects back (E1). */
export function legacyHome(): string {
  return join(homedir(), '.claude', 'project-pm')
}

/** A file name for an actor id: `claude-code:1a2b` is not a legal file name on Windows. */
export function actorFile(id: string): string {
  return encodeURIComponent(id).replace(/\*/g, '%2A')
}
