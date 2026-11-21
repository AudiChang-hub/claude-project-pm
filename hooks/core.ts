// The core (project-pm's own MCP server, core/), as the desktop mod finds and uses it (E2: docs/design/v1-core.md 2.4,
// 3.7). Where Claude Code starts the core, the core serves the board, the ledger and the report tool, and keeps the
// ledger and its QA for the desktop app and the terminal alike; the mod draws the pane and keeps the session list.

import type { EngineInterface } from 'claude-code'

import type { ProjectFile, Track } from '../types'
import { mergeLegacy } from '../core/src/merge'
import type { CoreProject } from '../core/src/types'

/** The core's MCP server, as Claude Code names it (`claude mcp add … project-pm`): its tools are mcp__project-pm__*. */
export const CORE_SERVER = 'project-pm'
/** A tool only the core serves (the mod never registered `pm`): seen in the tool list, the core is connected. */
export const CORE_PM_TOOL = 'mcp__project-pm__pm'
/** How long the answer to "is the core there" stands. */
const RECHECK_MS = 60_000

let known: { isOn: boolean; at: number; project: string } | null = null

async function homeOf($: EngineInterface): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
}

/** The core's data folder: PROJECT_PM_HOME, else ~/.project-pm (core/src/host.ts dataHome). */
export async function coreHome($: EngineInterface): Promise<string> {
  const set = (await $.env.get('PROJECT_PM_HOME'))?.trim()

  return (set || `${await homeOf($)}/.project-pm`).replace(/\\/g, '/').replace(/\/+$/, '')
}

/** A folder as ~/.claude.json keys its projects: forward slashes, no slash at the end, any case. */
const folderKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * Whether Claude Code's settings (~/.claude.json) start the core's MCP server: for every project (user scope, as
 * `project-pm init` adds it), or for this one (local scope).
 */
export function isCoreConfigured(config: unknown, projectPath: string): boolean {
  if (!config || typeof config !== 'object') return false
  const servers = (o: unknown) => (o && typeof o === 'object' ? (o as { mcpServers?: unknown }).mcpServers : undefined)
  const has = (o: unknown) => {
    const list = servers(o)

    return !!list && typeof list === 'object' && CORE_SERVER in (list as object)
  }
  if (has(config)) return true
  const projects = (config as { projects?: unknown }).projects
  if (!projects || typeof projects !== 'object') return false
  const wanted = folderKey(projectPath)

  return Object.entries(projects as Record<string, unknown>).some(([folder, one]) => folderKey(folder) === wanted && has(one))
}

/**
 * Whether the core serves this session's project-pm tools (3.7): it is in the session's tool list, or Claude Code's
 * settings start it (at a session's start its server may not be connected yet, and the mod must not register tools
 * of the same name meanwhile). Asked again after RECHECK_MS; a failure to tell is "no", which is v1.0's behavior.
 */
export async function hasCore($: EngineInterface, projectPath: string): Promise<boolean> {
  const now = await $.clock.now()
  if (known && known.project === projectPath && now - known.at < RECHECK_MS) return known.isOn
  let isOn = false
  try {
    isOn = (await $.tool.list()).some(tool => tool.name === CORE_PM_TOOL)
    if (!isOn) {
      const dir = (await $.env.get('CLAUDE_CONFIG_DIR'))?.trim()
      for (const file of [...(dir ? [`${dir.replace(/\\/g, '/')}/.claude.json`] : []), `${await homeOf($)}/.claude.json`]) {
        if (!(await $.fs.exists(file))) continue
        isOn = isCoreConfigured(JSON.parse(await $.fs.read(file)), projectPath)
        break
      }
    }
  } catch {
    isOn = false
  }
  known = { isOn, at: now, project: projectPath }

  return isOn
}

/** Forgets the answer: the next hasCore asks again. */
export function forgetCore() {
  known = null
}

/** One of the core's tools, called for the mod (`pm claim`, …): its answer's text; throws when it does not answer. */
export async function callCore($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<string> {
  const result = await $.mcp.call(CORE_SERVER, tool, args)
  const text = result.content.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n').trim()
  if (result.isError) throw new Error(text || `${CORE_SERVER} ${tool} failed`)

  return text
}

/**
 * The project as the core and the mod's folder both hold it, merged exactly as the core merges them (mergeLegacy): the
 * core's copy is the newer home of the ledger (E2), the mod's is written back by the core and still read by v1.0.
 */
export function mergedProject(base: ProjectFile, core: ProjectFile | null, legacy: ProjectFile | null, isLegacyNewer: boolean): ProjectFile {
  const filled = (file: ProjectFile) => ({ ...base, ...file, ledger: Array.isArray(file.ledger) ? file.ledger : [] })
  if (!core) return legacy ? filled(legacy) : base
  if (!legacy) return filled(core)

  return mergeLegacy(filled(core) as CoreProject, filled(legacy) as CoreProject, isLegacyNewer) as ProjectFile
}

/** What a session reported to the core (its record there), as far as the mod's card needs it. */
export type CoreActor = { id?: unknown; title?: unknown; cwd?: unknown; report?: Track['report']; reportAt?: number; lastSeenAt?: number }

/**
 * A desktop session's track with the report it made through the core's report tool, when that one is newer (the core
 * keeps it in its own record, core/src/actors.ts withReport).
 */
export function trackWithReport(track: Track | null, actor: CoreActor | null): Track | null {
  if (!actor?.report || typeof actor.report !== 'object') return track
  const reportAt = typeof actor.reportAt === 'number' ? actor.reportAt : typeof actor.lastSeenAt === 'number' ? actor.lastSeenAt : 0
  if (track && reportAt <= (track.reportAt ?? 0)) return track
  const base: Track = track ?? {
    id: typeof actor.id === 'string' ? actor.id : '',
    title: typeof actor.title === 'string' ? actor.title : '',
    cwd: typeof actor.cwd === 'string' ? actor.cwd : '',
    plan: [],
    recap: null,
    ask: null,
    lastPrompt: '',
    lastAnswer: '',
    turnAt: reportAt,
    planAt: 0,
  }

  return { ...base, report: actor.report, reportAt }
}
