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

/** The first version of the mod that uses the core's tools where Claude Code starts the core (E2, v1-core.md 2.4). */
export const E2_VERSION = '1.1.0'

/** Whether version `a` is `b` or later (x.y.z; a part that is not a number counts as 0). */
export function isAtLeast(a: string, b: string): boolean {
  const parts = (v: string) => v.split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)

  return true
}

/**
 * The versions of the desktop mod on this machine: the local copy's (local-mods), and each one Claude Code installed
 * from a marketplace (plugins/installed_plugins.json) that settings.json has enabled. A copy whose version cannot be
 * read counts as "0.0.0".
 */
export function modVersions(ie: { env: NodeJS.ProcessEnv; home: string }): string[] {
  const dir = claudeDir(ie)
  const versions: string[] = []
  const local = join(dir, 'local-mods', 'project-pm', '.claude-plugin', 'plugin.json')
  if (existsSync(local)) {
    try {
      const { version } = JSON.parse(readFileSync(local, 'utf8')) as { version?: unknown }
      versions.push(typeof version === 'string' ? version : '0.0.0')
    } catch {
      versions.push('0.0.0')
    }
  }
  let enabled: Record<string, unknown> = {}
  try {
    enabled = (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, unknown> }).enabledPlugins ?? {}
  } catch {
    // None enabled.
  }
  try {
    const installed = JSON.parse(readFileSync(join(dir, 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, unknown> }
    for (const [name, entries] of Object.entries(installed.plugins ?? {})) {
      if (!name.startsWith('project-pm@') || enabled[name] !== true || !Array.isArray(entries)) continue
      for (const entry of entries) versions.push(typeof (entry as { version?: unknown })?.version === 'string' ? (entry as { version: string }).version : '0.0.0')
    }
  } catch {
    // No marketplace installs.
  }

  return versions
}

/**
 * Whether the mod installed here uses the core (E2): every copy of it is E2_VERSION or later. An older copy serves its
 * own project-pm tools, which the core's would clash with (3.7), so init leaves Claude Code's MCP setting alone then.
 */
export function isModOnCore(ie: { env: NodeJS.ProcessEnv; home: string }): boolean {
  const versions = modVersions(ie)

  return versions.length > 0 && versions.every(v => isAtLeast(v, E2_VERSION))
}
