/**
 * The desktop mod (hooks/), as the core sees it: whether it is installed, and whether the session running now is one of
 * the desktop app's, where the mod draws the board and keeps each session's record (docs/design/v1-core.md 3.7, E2).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A desktop session's id, as the desktop app and the mod name it. */
export const DESKTOP_ID = /^local_[\w-]+$/

/** Claude Code's folder: CLAUDE_CONFIG_DIR when set (Claude Code reads it too), else ~/.claude. */
export function claudeDir(ie: { env: NodeJS.ProcessEnv; home: string }): string {
  return ie.env.CLAUDE_CONFIG_DIR?.trim() || join(ie.home, '.claude')
}

/** Whether the desktop mod is installed: it serves its own project-pm tools and hooks unless it uses the core (3.7). */
export function isModInstalled(ie: { env: NodeJS.ProcessEnv; home: string }): boolean {
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
 * The desktop session this process runs for: Claude Code started by the desktop app has its session's id in
 * CLAUDE_CODE_HOST_SESSION_ID (local_…, the id the mod gets from get_session), and every program it starts (an MCP
 * server, a hook) inherits it. Null outside the desktop app.
 */
export function hostSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.CLAUDE_CODE_HOST_SESSION_ID?.trim()

  return id && DESKTOP_ID.test(id) ? id : null
}
