/**
 * The sessions of a project as the board reads them. Outside the desktop app there is no session list, so the
 * core's actors (what each session reported, and what its hooks wrote) stand for it: each turns into the mod's
 * Session and Track, and the mod's board and status logic read them unchanged.
 */
import { projectKey, projectPath } from '../../hooks/sessions'
import type { Session, Track } from '../../types'
import type { ProjectRef } from './project'
import { loadActors, loadLegacyTrack } from './store'
import type { Actor } from './types'

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
  }
}

/** Whether an actor works on this project: the project it reported for, else its folder's. */
export function isOfProject(actor: Actor, ref: ProjectRef): boolean {
  return (actor.projectKey ?? projectKey(projectPath(actor.cwd))) === ref.key
}

export type ProjectSessions = {
  sessions: Session[]
  /** Every actor of any project, and the desktop sessions that own open items: an owner elsewhere is still there. */
  everyone: Session[]
  tracks: Record<string, Track>
  actors: Actor[]
  errors: string[]
}

/** The project's sessions, and the owners its open items name that work elsewhere or in the desktop app. */
export async function projectSessions(ref: ProjectRef, owners: string[], env: NodeJS.ProcessEnv = process.env): Promise<ProjectSessions> {
  const { actors, errors } = await loadActors(env)
  const mine = actors.filter(a => isOfProject(a, ref))
  const tracks: Record<string, Track> = {}
  for (const actor of actors) tracks[actor.id] = trackOf(actor)
  const everyone = actors.map(sessionOf)
  for (const owner of owners) {
    const id = owner.trim()
    if (!id || everyone.some(s => s.id === id)) continue
    // A desktop session (local_…): its track is in the mod's folder; the desktop app alone knows if it still runs.
    const track = await loadLegacyTrack(id, env)
    if (!track) continue
    tracks[id] = track
    everyone.push({ id, title: track.title || id, cwd: track.cwd, isRunning: false, lastActivityAt: new Date(Math.max(track.turnAt, track.planAt, track.reportAt ?? 0)).toISOString(), isPinned: false, hasOpenPr: false })
  }

  return { sessions: mine.map(sessionOf), everyone, tracks, actors, errors }
}
