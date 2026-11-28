/**
 * The sessions of a project as the board reads them. Outside the desktop app there is no session list, so the
 * core's actors (what each session reported, and what its hooks wrote) stand for it: each turns into the mod's
 * Session and Track, and the mod's board and status logic read them unchanged. When the project's PM is a desktop
 * session, the desktop app's own list stands too, as the PM's mod kept it at its last round (E2, v1-core.md 3.2).
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { hasReport, projectKey, projectPath } from '../../hooks/sessions'
import type { AgentRecord, CiCheck, LastWord, PushCheck, Session, Track } from '../../types'
import { legacyHome } from './host'
import { DESKTOP_ID } from './mod'
import type { ProjectRef } from './project'
import { loadActors, loadLegacyTrack, readJsonFile } from './store'
import type { Actor } from './types'

/** How long the PM's last round counts as now: the mod makes one every 30 s while the desktop app runs. */
export const ROUND_FRESH_MS = 10 * 60_000

/** When an actor last did anything it wrote down: its turn, its report, its task list, or its last call. */
export function activeAt(actor: Actor): number {
  return Math.max(actor.lastSeenAt ?? 0, actor.turnAt ?? 0, actor.reportAt ?? 0, actor.planAt ?? 0)
}

export function sessionOf(actor: Actor): Session {
  return {
    id: actor.id,
    title: actor.title || actor.id,
    cwd: actor.cwd,
    isRunning: actor.state === 'running',
    lastActivityAt: new Date(activeAt(actor) || 0).toISOString(),
    isPinned: false,
    hasOpenPr: false,
  }
}

export function trackOf(actor: Actor): Track {
  return {
    id: actor.id,
    title: actor.title || actor.id,
    cwd: actor.cwd,
    plan: actor.plan ?? [],
    recap: actor.recap ?? null,
    ask: actor.ask ?? null,
    lastPrompt: actor.lastPrompt ?? '',
    lastAnswer: actor.lastAnswer ?? '',
    turnAt: actor.turnAt ?? actor.lastSeenAt ?? 0,
    planAt: actor.planAt ?? 0,
    ...(actor.background ? { background: actor.background } : {}),
    ...(actor.agents ? { agents: actor.agents } : {}),
    ...(actor.report ? { report: actor.report, reportAt: actor.reportAt ?? actor.lastSeenAt } : {}),
    ...(actor.context ? { context: actor.context } : {}),
  }
}

/**
 * A desktop session's track (the mod's file) with the report it made through the core's report tool, when that one is
 * newer: the mod keeps the session's task list and last words, the core what it reported (E2).
 */
export function withReport(track: Track | null, actor: Actor | undefined): Track | null {
  if (!actor?.report) return track
  if (!track) return trackOf(actor)
  if ((actor.reportAt ?? 0) <= (track.reportAt ?? 0)) return track

  return { ...track, report: actor.report, reportAt: actor.reportAt ?? actor.lastSeenAt }
}

/** Whether an actor works on this project: the project it reported for, else its folder's. */
export function isOfProject(actor: Actor, ref: ProjectRef): boolean {
  return (actor.projectKey ?? projectKey(projectPath(actor.cwd))) === ref.key
}

/** The PM's last round, as the mod writes it (hooks/actions.ts saveRound). */
type Round = { sessions?: { list?: unknown; fetchedAt?: unknown }; lastWords?: unknown; ciChecks?: unknown; pushChecks?: unknown }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A session of the desktop app's list as the round holds it, or null for anything else. */
function sessionIn(value: unknown): Session | null {
  if (!isRecord(value)) return null
  const { id, title, cwd, lastActivityAt } = value
  if (typeof id !== 'string' || !DESKTOP_ID.test(id) || typeof cwd !== 'string' || typeof lastActivityAt !== 'string') return null

  return {
    id,
    title: typeof title === 'string' ? title : '',
    cwd,
    isRunning: value.isRunning === true,
    lastActivityAt,
    isPinned: value.isPinned === true,
    hasOpenPr: value.hasOpenPr === true,
  }
}

/** Each entry of a round's map whose key is a desktop session's id. */
function byDesktopId<T>(value: unknown): Record<string, T> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(Object.entries(value).filter(([id, one]) => DESKTOP_ID.test(id) && isRecord(one))) as Record<string, T>
}

/**
 * `listedAt`: when the desktop app's list was taken (the round's fetchedAt, else its file's time less ROUND_MARGIN_MS):
 * a desktop session that did nothing after it and is not in the list is one the app no longer lists (archived, T-59).
 */
export type DesktopRound = { list: Session[]; words: Record<string, LastWord>; ci: Record<string, CiCheck>; push: Record<string, PushCheck>; isFresh: boolean; listedAt: number }

/** How long before its file's time a round without its fetchedAt may have taken its list: the round's own work after. */
export const ROUND_MARGIN_MS = 5 * 60_000

/**
 * The desktop app's session list as a desktop PM's mod last saw it, with each session's last words and what git and
 * GitHub said of them; null when the PM is no desktop session or its mod kept no round. A round older than
 * ROUND_FRESH_MS (the desktop app closed) still names the sessions, but none of them counts as running.
 */
export async function desktopRound(pmId: string | null | undefined, now: number): Promise<DesktopRound | null> {
  if (!pmId || !DESKTOP_ID.test(pmId)) return null
  const file = join(legacyHome(), 'rounds', `${pmId}.json`)
  let round: Round | null
  let at: number
  try {
    round = await readJsonFile<Round>(file)
    at = (await stat(file)).mtimeMs
  } catch {
    return null
  }
  if (!round || !Array.isArray(round.sessions?.list)) return null
  const isFresh = now - at <= ROUND_FRESH_MS
  const list = (round.sessions.list as unknown[]).map(sessionIn).filter((one): one is Session => !!one).map(one => (isFresh ? one : { ...one, isRunning: false }))

  const fetchedAt = round.sessions.fetchedAt
  const listedAt = typeof fetchedAt === 'number' && fetchedAt > 0 ? Math.min(fetchedAt, at) : at - ROUND_MARGIN_MS

  return { list, words: byDesktopId(round.lastWords), ci: byDesktopId(round.ciChecks), push: byDesktopId(round.pushChecks), isFresh, listedAt }
}

export type ProjectSessions = {
  sessions: Session[]
  /** Every actor of any project, and the desktop sessions that own open items: an owner elsewhere is still there. */
  everyone: Session[]
  /** Desktop sessions the core holds a report of that the app no longer lists (archived, T-59): counted nowhere. */
  archived: Session[]
  tracks: Record<string, Track>
  actors: Actor[]
  errors: string[]
  /** The desktop sessions' last words, CI and push as the PM's mod last read them (empty without a desktop PM). */
  words: Record<string, LastWord>
  ci: Record<string, CiCheck>
  push: Record<string, PushCheck>
  /** The PM's agents: in its actor record, or in a desktop PM's track. */
  agents: AgentRecord[]
}

/**
 * The project's sessions, and the owners its open items name that work elsewhere or in the desktop app. With a desktop
 * PM (`pmId` local_…), the desktop app's list from the PM's last round comes first, each session's track from the mod's
 * folder with what it reported to the core; the core's own actors (Claude Code in a terminal) are added after it.
 */
export async function projectSessions(ref: ProjectRef, owners: string[], env: NodeJS.ProcessEnv = process.env, pmId: string | null = null, now = Date.now()): Promise<ProjectSessions> {
  const { actors, errors } = await loadActors(env)
  const actorById = new Map(actors.map(a => [a.id, a]))
  const tracks: Record<string, Track> = {}
  for (const actor of actors) tracks[actor.id] = trackOf(actor)
  const wanted = new Set(owners.map(o => o.trim()))
  const round = await desktopRound(pmId, now)
  const everyone: Session[] = []
  const mine: Session[] = []
  for (const one of round?.list ?? []) {
    everyone.push(one)
    const isMine = projectKey(one.cwd) === ref.key
    if (isMine) mine.push(one)
    // Only the tracks the board reads: this project's sessions, and the owners its items name.
    if (!isMine && !wanted.has(one.id)) continue
    const track = withReport(await loadLegacyTrack(one.id, env), actorById.get(one.id))
    if (track) tracks[one.id] = track
    else delete tracks[one.id]
  }
  const archived: Session[] = []
  for (const actor of actors) {
    if (everyone.some(s => s.id === actor.id)) continue
    const one = sessionOf(actor)
    if (round && isUnlisted(actor.id, activeAt(actor), round)) {
      archived.push(one)
      continue
    }
    everyone.push(one)
    if (isOfProject(actor, ref)) mine.push(one)
  }
  for (const id of wanted) {
    if (!id || everyone.some(s => s.id === id) || archived.some(s => s.id === id)) continue
    // A desktop session (local_…) no list holds: its track is in the mod's folder; the desktop app alone knows if it still runs.
    const track = withReport(await loadLegacyTrack(id, env), actorById.get(id))
    if (!track || !hasReport(track)) continue
    // Not in the app's list, and nothing since it was taken: archived, an owner gone as the pane has it (T-59).
    if (round && isUnlisted(id, Math.max(track.turnAt, track.planAt, track.reportAt ?? 0), round)) continue
    tracks[id] = track
    everyone.push({ id, title: track.title || id, cwd: track.cwd, isRunning: false, lastActivityAt: new Date(Math.max(track.turnAt, track.planAt, track.reportAt ?? 0)).toISOString(), isPinned: false, hasOpenPr: false })
  }
  // The PM's agents: a desktop PM's mod keeps them in its track, the core in its actor record. Its track names it too.
  const pmTrack = pmId && round ? withReport(await loadLegacyTrack(pmId, env), actorById.get(pmId)) : null
  if (pmId && pmTrack) tracks[pmId] = pmTrack
  const agents = [...(pmTrack?.agents ?? []), ...(pmId ? (actorById.get(pmId)?.agents ?? []) : [])].filter((a, i, all) => all.findIndex(b => b.id === a.id) === i)

  return { sessions: mine, everyone, archived, tracks, actors, errors, words: round?.words ?? {}, ci: round?.ci ?? {}, push: round?.push ?? {}, agents }
}

/**
 * Whether the desktop app no longer lists a desktop session (T-59): its id is a desktop one, the round's list leaves it
 * out, and it did nothing after the list was taken. One active since may be newer than the list: it still counts.
 */
function isUnlisted(id: string, lastActive: number, round: DesktopRound): boolean {
  return DESKTOP_ID.test(id) && !round.list.some(s => s.id === id) && lastActive <= round.listedAt
}
