// Keeping every open session on the installed copy of the mod: once `claude plugin update`
// installs a newer copy, a session still running the old one reloads its plugins when idle,
// and its subagents with it.

import type { EngineInterface } from 'claude-code'

import { t } from './messages'

/** One install of a plugin, as `installed_plugins.json` lists it. */
type Install = { scope?: string; installPath?: string; version?: string; lastUpdated?: string }

function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * The install this running copy belongs to (same plugin, same marketplace), or null. A copy
 * that does not run from the plugin cache (a mods folder, `--plugin-dir`) has none.
 */
export function installOf(listing: unknown, name: string, root: string): Install | null {
  const at = norm(root).match(/\/plugins\/cache\/([^/]+)\/([^/]+)\/[^/]+$/)
  if (!at || at[2] !== name.toLowerCase()) return null
  const plugins = (listing as { plugins?: Record<string, Install[]> } | null)?.plugins ?? {}
  const key = Object.keys(plugins).find(k => k.toLowerCase() === `${name}@${at[1]}`.toLowerCase())
  const installs = key ? (plugins[key] ?? []) : []

  return installs.find(i => i.scope === 'user') ?? installs[0] ?? null
}

/**
 * Whether the installed copy is another one than the copy running here: another folder (a new
 * version), or the same folder installed again since this copy first saw it (`seenUpdate`).
 */
export function isReplaced(install: Install | null, root: string, seenUpdate?: string): install is Install & { installPath: string } {
  if (!install?.installPath) return false
  if (norm(install.installPath) !== norm(root)) return true

  return seenUpdate !== undefined && install.lastUpdated !== undefined && install.lastUpdated !== seenUpdate
}

/** Set once this copy has asked for a reload: the reload replaces it, so it never asks twice. */
let isReloadAsked = false
/** The install listing's modification time when last read: an unchanged listing is not read again. */
let listingSeenAt = -1
/** When this copy's own install was last updated, as this copy first read it. */
let seenUpdate: string | undefined

/** Queues /reload-plugins when a newer copy of this mod is installed. */
export async function reloadIfUpdated($: EngineInterface) {
  // Only a copy run from the plugin cache has an install that can replace it.
  if (isReloadAsked || !/[\\/]plugins[\\/]cache[\\/]/i.test($.plugin.root)) return
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : null)
  if (!config) return
  const path = `${config.replace(/\\/g, '/')}/plugins/installed_plugins.json`
  let listing: unknown = null
  try {
    const { mtimeMs } = await $.fs.stat(path)
    if (mtimeMs === listingSeenAt) return
    listingSeenAt = mtimeMs
    listing = JSON.parse(await $.fs.read(path))
  } catch {
    return
  }
  const install = installOf(listing, $.plugin.name, $.plugin.root)
  if (seenUpdate === undefined && install?.installPath && !isReplaced(install, $.plugin.root)) seenUpdate = install.lastUpdated ?? ''
  if (!isReplaced(install, $.plugin.root, seenUpdate)) return
  isReloadAsked = true
  $.ui.toast(t('update.reloading', { version: install.version ?? '' }))
  try {
    // Run as if the person typed it: queued until the session is idle, never mid-turn.
    await $.command.run({ command: 'reload-plugins' })
  } catch (err) {
    isReloadAsked = false
    $.ui.log(`project-pm: /reload-plugins: ${err instanceof Error ? err.message : String(err)}`)
  }
}
