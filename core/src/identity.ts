/** Who is calling (docs/design/v1-core.md 1.5) and the ids the core hands out. */
import { randomBytes } from 'node:crypto'

import type { Run } from './host'
import { GH_TIMEOUT_MS, run as hostRun } from './host'
import { hostSessionId } from './mod'
import type { Author } from './types'

/** A UUID v7: 48 bits of milliseconds, then random bits; sortable by time, never the same on two machines. */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Math.floor(now), 0, 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A tool's name as ids use it: `Claude Code` and `claude-code` alike read `claude-code`. */
export function toolName(name: string | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'mcp'
}

/**
 * The session id the tool that started this process put in its environment, when it put one: the hooks of the same
 * session see the same id, so the MCP server's reports and the hooks' land on one actor.
 */
export function sessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.CLAUDE_CODE_SESSION_ID ?? env.CLAUDE_SESSION_ID
  return id && /^[\w-]{6,}$/.test(id) ? id : null
}

/**
 * The actor id of an MCP connection: in the desktop app its session's own id (local_…, the one the mod knows it by, so
 * the PM, owners and checkers the core records are the mod's: E2); else the tool's session id when known, else a short
 * random one for this process.
 */
export function connectionActor(tool: string, env: NodeJS.ProcessEnv = process.env): string {
  const desktop = hostSessionId(env)
  if (desktop) return desktop
  const session = tool === 'claude-code' ? sessionIdFromEnv(env) : null

  return `${tool}:${session ?? randomBytes(4).toString('hex')}`
}

/** The GitHub login gh is signed in as, asked once per process; null when gh is missing or signed out. */
let login: Promise<string | null> | null = null

export function githubLogin(cwd: string, run: Run = hostRun): Promise<string | null> {
  login ??= run(['gh', 'api', 'user', '--jq', '.login'], cwd, GH_TIMEOUT_MS).then(out => (out && /^[\w-]+$/.test(out) ? out : null))

  return login
}

/** Forgets the login (tests, and a person who signs in while the server runs). */
export function forgetLogin() {
  login = null
}

export async function authorOf(actor: string, cwd: string, run: Run = hostRun, env: NodeJS.ProcessEnv = process.env): Promise<Author> {
  // Tests and machines without GitHub skip the lookup.
  const person = env.PROJECT_PM_NO_GH ? null : await githubLogin(cwd, run)

  return person ? { actor, person } : { actor }
}
