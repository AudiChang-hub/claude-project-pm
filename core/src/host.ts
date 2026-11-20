/**
 * The commands the core runs (git, gh, claude), never through a shell but in one case (a command npm installed on
 * Windows, below), and the paths it keeps its data under.
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

/** Windows' own cmd.exe, by its full path: never one in the current folder, nor one ComSpec names. */
export function systemCmd(): string {
  return join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'cmd.exe')
}

export const run: Run = (argv, cwd, timeoutMs = GIT_TIMEOUT_MS) =>
  new Promise(resolve => {
    const [command, ...args] = argv
    if (!command) return resolve(null)
    noProgramsFromCurrentFolder()
    try {
      execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout) => {
        if (!err) return resolve(String(stdout).trim())
        // Not found on Windows: it may be a .cmd file, as npm installs every command there (claude.cmd), which a
        // program started without a shell is never found as (CI run 44723838413: init said Claude Code was missing).
        const batch = process.platform === 'win32' && (err as NodeJS.ErrnoException).code === 'ENOENT' ? batchOnPath(command) : null
        if (!batch) return resolve(null)
        runBatch(batch, args, cwd, timeoutMs).then(resolve, () => resolve(null))
      })
    } catch {
      resolve(null)
    }
  })

/**
 * The .cmd or .bat file a bare command name is on Windows' PATH, or null. Only folders on this machine's own disks
 * are looked in (plainLocalPath: a network folder on PATH would be connected to), and never the working folder, which a
 * repository chooses the files of.
 */
function batchOnPath(command: string): string | null {
  if (!/^[\w.-]+$/.test(command) || /\.(cmd|bat|exe|com)$/i.test(command)) return null
  for (const entry of (process.env.PATH ?? '').split(';')) {
    const folder = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!/^[A-Za-z]:[\\/]/.test(folder)) continue
    const plain = plainLocalPath(folder, folder, 'win32')
    if (!plain) continue
    for (const ext of ['.cmd', '.bat']) {
      const file = join(plain, `${command}${ext}`)
      if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file
    }
  }

  return null
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
function runBatch(file: string, args: string[], cwd: string, timeoutMs: number): Promise<string | null> {
  if (![file, ...args].every(isCmdSafe)) return Promise.resolve(null)
  const line = [file, ...args].map(arg => `"${arg}"`).join(' ')

  return new Promise(resolve => {
    // /d: no AutoRun commands; /v:off: no delayed expansion; /s /c "…": the outer quotes are taken off, the rest kept.
    noProgramsFromCurrentFolder()
    execFile(systemCmd(), ['/d', '/v:off', '/s', '/c', `"${line}"`], { cwd: dirname(file), env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' }, timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout) =>
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
