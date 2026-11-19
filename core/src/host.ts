/** The commands the core runs (git, gh), never through a shell, and the paths it keeps its data under. */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const GIT_TIMEOUT_MS = 4_000
export const GH_TIMEOUT_MS = 8_000

/** What a command printed (trimmed) when it exits 0; null when it fails, is missing or takes too long. */
export type Run = (argv: string[], cwd: string, timeoutMs?: number) => Promise<string | null>

export const run: Run = (argv, cwd, timeoutMs = GIT_TIMEOUT_MS) =>
  new Promise(resolve => {
    const [command, ...args] = argv
    if (!command) return resolve(null)
    try {
      execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) =>
        resolve(err ? null : String(stdout).trim()),
      )
    } catch {
      resolve(null)
    }
  })

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
