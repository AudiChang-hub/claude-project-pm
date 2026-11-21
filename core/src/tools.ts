/**
 * The four MCP tools (docs/design/v1-core.md 3.2 to 3.5): board, ledger, report and pm. The words they answer with
 * are the mod's (hooks/messages.ts), so the model reads the same board and the same refusals in every tool; each
 * answer also carries the same as JSON (structuredContent).
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { t } from '../../hooks/messages'
import type { MessageKey } from '../../hooks/messages'
import { agentName, settledAgents } from '../../hooks/agents'
import { isAgentId, isSameId, openBreakdown, qaKeptText, qaShown, qaText, qaUpdate } from '../../hooks/qa'
import type { OpenBreakdown, QaShown } from '../../hooks/qa'
import {
  AGENT_STATUS,
  STATUS,
  agentTime,
  boardText,
  cardSummary,
  caveatOf,
  isActive,
  isHandedOff,
  kpiOf,
  limitOf,
  openSteps,
  settledAt,
  shownAgents,
  statusText,
  ciWords,
  clip,
  hasReport,
  deliveredOf,
  isCiPending,
  ownerTextOf,
  sessionName,
  whoOf,
  itemCode,
  latestWords,
  ledgerRow,
  ledgerText,
  quoteOf,
  reportOf,
  statusOf,
} from '../../hooks/sessions'
import type { BoardInput, Kpi, Status } from '../../hooks/sessions'
import type { AgentRecord, AgentState, CiCheck, LastWord, PushCheck, Session, Step, Track } from '../../types'
import { activeAt, projectSessions, trackOf } from './actors'
import type { Ctx, ToolResult } from './context'
import { projectOf } from './context'
import { checkCi, checkPush, heldCi } from './facts'
import { alertText, guidelinesAlerts } from './guard'
import { GIT_TIMEOUT_MS } from './host'
import { plainLocalPath } from './localpath'
import { prePushInstalled, pushProblems, pushedUnchecked, withAttention } from './prepush'
import { authorOf, uuidv7 } from './identity'
import { ct } from './messages'
import type { ProjectRef } from './project'
import { projectRefOf } from './project'
import { StoreError, changeActor, changeProject, loadProject, paths, readJsonFile, writeAtomic } from './store'
import type { Actor, CoreItem, CoreProject } from './types'

export const BOARD_TOOL = 'mcp__project-pm__board'
export const LEDGER_TOOL = 'mcp__project-pm__ledger'
export const REPORT_TOOL = 'mcp__project-pm__report'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function notGit(ctx: Ctx, input: Record<string, unknown>): ToolResult {
  const path = str(input.project)?.trim() || ctx.cwd
  // A network folder was never asked about (projectOf): say why, not that it has no git.
  if (plainLocalPath(path, ctx.cwd) === null) return { text: ct('error.remotePath', { path }), structured: { error: 'remote_path', path }, isError: true }

  return { text: ct('error.notGit', { path }), structured: { error: 'not_git', path }, isError: true }
}

function failed(err: unknown): ToolResult {
  const text = err instanceof StoreError ? err.message : ct('error.cannotWrite', { reason: err instanceof Error ? err.message : String(err) })

  return { text, structured: { error: 'store', message: text }, isError: true }
}

/** The project's HEAD, in full; null outside git. */
async function headOf(ctx: Ctx, ref: ProjectRef): Promise<string | null> {
  const sha = (await ctx.run(['git', 'rev-parse', 'HEAD'], ref.cwd, GIT_TIMEOUT_MS))?.trim() ?? ''

  return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null
}

/** A commit as git names it in full, when the project holds it; else the text as given (another repository's hash stays readable). */
async function fullSha(ctx: Ctx, ref: ProjectRef, sha: string): Promise<string> {
  const full = await ctx.run(['git', 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`], ref.cwd, GIT_TIMEOUT_MS)

  return full && /^[0-9a-f]{40}$/i.test(full) ? full.toLowerCase() : sha.toLowerCase()
}

// ── Owners: whether the session or agent an item is handed to has delivered ──

const BLOCKING: Partial<Record<Status, true>> = { ci: true, failed: true, unreleased: true, running: true, waiting: true, asking: true, open: true }

/** Facts for one session's latest words: its CI and push, asked now (an owner's close waits on them). */
async function factsFor(ctx: Ctx, id: string, cwd: string, track: Track | undefined, word?: LastWord): Promise<{ ci?: CiCheck; push?: PushCheck }> {
  if (!track && !word) return {}
  const said = ciWords(track, word)
  const push = await checkPush(ctx.facts, id, cwd, said)
  const ci = isCiPending(said) ? await checkCi(ctx.facts, id, cwd, said, track?.turnAt || ctx.now()) : undefined

  return { ci, push }
}

/**
 * Why the owner's work cannot be counted done yet, or null (the mod's ownerBlocker, with the core's actors for the
 * desktop app's session list). An agent holds the close until its record says done; a session until its report,
 * its words and git and GitHub say it delivered; an owner nobody knows of any more holds nothing.
 */
export async function ownerBlocker(ctx: Ctx, ref: ProjectRef, owner: string, pmId: string | null = null): Promise<string | null> {
  const found = await projectSessions(ref, [owner], ctx.env, pmId, ctx.now())
  const { everyone, tracks, actors, words } = found
  if (isAgentId(owner)) {
    const record = [...found.agents, ...actors.flatMap(a => a.agents ?? [])].find(a => isSameId(`agent:${a.id}`, owner))
    if (!record || record.state === 'done') return null

    return t('blocker.agent', { name: record.description, why: t(`agent.state.${record.state}` as MessageKey) })
  }
  const one = everyone.find(s => isSameId(s.id, owner))
  if (!one) return null
  const track = hasReport(tracks[one.id]) ? tracks[one.id] : undefined
  // A desktop session: what the PM's mod last found (its round), else asked now.
  const kept = found.ci[one.id] || found.push[one.id] ? { ci: found.ci[one.id], push: found.push[one.id] } : null
  const { ci, push } = kept ?? (await factsFor(ctx, one.id, one.cwd, track, words[one.id]))
  const status = statusOf(one, track, words[one.id], ctx.now(), ci, push)
  if (!BLOCKING[status]) return null
  const said = quoteOf(track, words[one.id])
  const why = t(`blocker.why.${status as 'ci' | 'failed' | 'unreleased' | 'running' | 'waiting' | 'asking' | 'open'}`)

  return said ? t('blocker.lastReport', { title: one.title, why, said: clip(said, 120) }) : t('blocker.plain', { title: one.title, why })
}

// ── ledger ──

export async function ledgerTool(ctx: Ctx, input: Record<string, unknown>): Promise<ToolResult> {
  const ref = await projectOf(ctx, input)
  if (!ref) return notGit(ctx, input)
  try {
    return await ledgerOn(ctx, ref, input)
  } catch (err) {
    return failed(err)
  }
}

async function ledgerOn(ctx: Ctx, ref: ProjectRef, input: Record<string, unknown>): Promise<ToolResult> {
  const action = str(input.action)
  const now = ctx.now()
  if (action === 'list') {
    const project = await loadProject(ref, ctx.env)
    if (input.id === undefined) {
      const isAll = input.include_done === true
      const items = isAll ? project.ledger : project.ledger.filter(i => i.status === 'open')

      return { text: ledgerText(project.ledger, isAll), structured: { items: items.map(itemJson) } }
    }
    const one = project.ledger.find(i => i.id === Number(input.id))

    return one ? { text: ledgerRow(one, true), structured: { item: itemJson(one) } } : { text: t('ledger.notFound', { id: String(input.id) }), structured: { error: 'not_found' } }
  }
  if (action === 'add') {
    const text = str(input.text)?.trim()
    if (!text) return { text: t('ledger.needText'), structured: { error: 'need_text' } }
    const author = await authorOf(ctx.actor, ref.cwd, ctx.run, ctx.env)
    const done = await changeProject(
      ref,
      project => {
        const criteria = str(input.criteria)?.trim()
        const item: CoreItem = {
          id: project.nextId,
          text,
          owner: str(input.owner)?.trim() || null,
          status: 'open',
          note: str(input.note) ?? '',
          createdAt: now,
          updatedAt: now,
          ...(criteria ? { criteria } : {}),
          uid: uuidv7(now),
          createdBy: author,
          updatedBy: author,
          rev: 1,
        }

        return { project: { ...project, ledger: [...project.ledger, item], nextId: project.nextId + 1 }, result: item }
      },
      ctx.env,
    )
    const item = done!.result

    return { text: `${t('ledger.added', { code: itemCode(item.id), id: item.id })}\n${ledgerRow(item, true)}`, structured: { item: itemJson(item), revision: done!.project.revision } }
  }
  if (action === 'update') return ledgerUpdate(ctx, ref, input, now)

  return { text: t('ledger.badAction'), structured: { error: 'bad_action' } }
}

async function ledgerUpdate(ctx: Ctx, ref: ProjectRef, input: Record<string, unknown>, now: number): Promise<ToolResult> {
  const id = typeof input.id === 'number' ? input.id : Number(input.id)
  const before = await loadProject(ref, ctx.env)
  const item = before.ledger.find(i => i.id === id)
  if (!item) return { text: t('ledger.notFound', { id: String(input.id) }), structured: { error: 'not_found' } }
  const status = str(input.status)
  const owner = input.owner === undefined ? item.owner : str(input.owner)?.trim() || null
  const isClosing = status === 'done' && item.status !== 'done' && !(input.force === true && str(input.note)?.trim())
  const asked = str(input.qa_sha)?.trim()
  const head = input.qa !== undefined ? (asked ? await fullSha(ctx, ref, asked) : await headOf(ctx, ref)) : null
  // The QA core (hooks/qa.ts) decides first: a verdict it cannot record changes nothing.
  const checked = qaUpdate(item, input, owner, ctx.actor, now, isClosing, head)
  if ('error' in checked) return { text: `${checked.error}\n${ledgerRow(item)}`, structured: { error: 'qa', message: checked.error, item: itemJson(item) } }
  let refusal = checked.refusal
  if (isClosing && !refusal && owner) {
    const blocker = await ownerBlocker(ctx, ref, owner, before.pmId)
    if (blocker) refusal = t('ledger.refused', { code: itemCode(id), blocker })
  }
  if (refusal && !checked.isRecorded) return { text: `${refusal}\n${ledgerRow(item)}`, structured: { refused: refusal, item: itemJson(item) } }
  const author = await authorOf(ctx.actor, ref.cwd, ctx.run, ctx.env)
  const commit = str(input.commit)?.trim() ? await fullSha(ctx, ref, str(input.commit)!.trim()) : null
  const done = await changeProject(
    ref,
    project => {
      // Read again under the lock: another session may have changed it since.
      const now_ = project.ledger.find(i => i.id === id) ?? item
      const criteria = typeof input.criteria === 'string' ? input.criteria.trim() || undefined : now_.criteria
      const qa = checked.qa && checked.isRecorded ? { ...checked.qa, ...(author.person ? { byPerson: author.person } : {}) } : checked.qa
      const changed: CoreItem = {
        ...now_,
        text: str(input.text)?.trim() || now_.text,
        owner,
        status: !refusal && (status === 'open' || status === 'done' || status === 'dropped') ? status : now_.status,
        note: str(input.note) ?? now_.note,
        updatedAt: now,
        ...(criteria ? { criteria } : {}),
        ...(qa ? { qa } : {}),
        updatedBy: author,
        rev: (now_.rev ?? 0) + 1,
      }
      if (!criteria) delete changed.criteria
      // Handed over: the owner it leaves is kept, as v0.9.1's mod keeps it (hooks/actions.ts), so a session stopped
      // mid-work that gave it up is not waited on (isHandedOff). Each owner once, the latest to leave last.
      if (now_.owner && !isSameId(now_.owner, owner)) changed.formerOwners = [...(now_.formerOwners ?? []).filter(o => !isSameId(o, now_.owner!)), now_.owner.trim()]
      if (!qa) delete changed.qa
      if (commit && !(changed.commits ?? []).includes(commit)) changed.commits = [...(changed.commits ?? []), commit]

      return { project: { ...project, ledger: project.ledger.map(i => (i.id === id ? changed : i)) }, result: changed }
    },
    ctx.env,
  )
  const changed = done!.result
  if (refusal) return { text: `${qaKeptText(refusal)}\n${ledgerRow(changed, true)}`, structured: { refused: refusal, item: itemJson(changed), revision: done!.project.revision } }

  return { text: `${t('ledger.updated', { code: itemCode(id) })}\n${ledgerRow(changed, true)}`, structured: { item: itemJson(changed), revision: done!.project.revision } }
}

export function itemJson(item: CoreItem) {
  return {
    id: item.id,
    code: itemCode(item.id),
    uid: item.uid ?? null,
    text: item.text,
    status: item.status,
    owner: item.owner,
    note: item.note,
    criteria: item.criteria ?? null,
    qa: item.qa ?? null,
    commits: item.commits ?? [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: item.createdBy ?? null,
    updatedBy: item.updatedBy ?? null,
    rev: item.rev ?? null,
  }
}

// ── report ──

export async function reportTool(ctx: Ctx, input: Record<string, unknown>): Promise<ToolResult> {
  const made = reportOf(input)
  if (!made) return { text: t('report.badStatus'), structured: { error: 'bad_status' } }
  const ref = await projectOf(ctx, input)
  if (!ref) return notGit(ctx, input)
  const now = ctx.now()
  const actorId = str(input.actor)?.trim() || ctx.actor
  try {
    const detail = str(input.detail)?.trim()
    if (detail) {
      const file = paths(ctx.env).report(actorId, now)
      await writeAtomic(file, `${detail}\n`)
      made.detail = file
    }
    const title = str(input.title)?.trim()
    await changeActor(
      actorId,
      old => ({
        ...(old ?? { id: actorId, tool: ctx.tool, title: '', cwd: ref.cwd, lastSeenAt: now }),
        id: actorId,
        tool: old?.tool ?? ctx.tool,
        title: title || old?.title || '',
        cwd: old?.cwd ?? ref.cwd,
        projectKey: ref.key,
        lastSeenAt: now,
        report: made,
        reportAt: now,
      }),
      ctx.env,
    )
    let note = ''
    const itemId = input.item === undefined ? null : Number(input.item)
    if (itemId !== null && made.commit) {
      const commit = await fullSha(ctx, ref, made.commit)
      const author = await authorOf(ctx.actor, ref.cwd, ctx.run, ctx.env)
      const done = await changeProject(
        ref,
        project => {
          const item = project.ledger.find(i => i.id === itemId)
          if (!item || (item.commits ?? []).includes(commit)) return null
          const changed: CoreItem = { ...item, commits: [...(item.commits ?? []), commit], updatedAt: now, updatedBy: author, rev: (item.rev ?? 0) + 1 }

          return { project: { ...project, ledger: project.ledger.map(i => (i.id === itemId ? changed : i)) }, result: true }
        },
        ctx.env,
      )
      if (!done && !(await loadProject(ref, ctx.env)).ledger.some(i => i.id === itemId)) note = `\n${ct('report.itemMissing', { id: String(itemId) })}`
    }
    const project = await loadProject(ref, ctx.env)
    const text = !project.pmId
      ? ct('report.noPmYet', { status: made.status })
      : made.detail
        ? ct('report.recordedDetail', { status: made.status, path: made.detail })
        : ct('report.recorded', { status: made.status })

    return { text: `${text}${note}`, structured: { actor: actorId, report: made, pm: project.pmId } }
  } catch (err) {
    return failed(err)
  }
}

// ── pm ──

/** The PM's instructions (the mod's ROLE), with the tools' names as Claude Code calls them. */
export function roleText(ref: ProjectRef): string {
  return t('role.text', { project: ref.name, path: ref.path, board: BOARD_TOOL, ledger: LEDGER_TOOL })
}

export async function pmTool(ctx: Ctx, input: Record<string, unknown>): Promise<ToolResult> {
  const action = str(input.action)
  if (action !== 'claim' && action !== 'release' && action !== 'status') return { text: ct('pm.badAction'), structured: { error: 'bad_action' } }
  const ref = await projectOf(ctx, input)
  if (!ref) return notGit(ctx, input)
  try {
    if (action === 'claim') {
      const done = await changeProject(ref, project => ({ project: { ...project, pmId: ctx.actor, isDismissed: false }, result: project.pmId }), ctx.env)
      const before = done!.result
      const said = before && before !== ctx.actor ? ct('pm.tookOver', { actor: ctx.actor, project: ref.name, before }) : ct('pm.claimed', { actor: ctx.actor, project: ref.name })

      return { text: `${said}\n\n${roleText(ref)}\n\n${t('role.justClaimed', { board: BOARD_TOOL })}`, structured: { pmId: ctx.actor, before: before ?? null, project: ref.name } }
    }
    if (action === 'release') {
      const project = await loadProject(ref, ctx.env)
      if (project.pmId !== ctx.actor) return { text: ct('pm.notPm', { actor: ctx.actor, project: ref.name, pm: project.pmId ?? ct('pm.nobody') }), structured: { pmId: project.pmId } }
      await changeProject(ref, p => (p.pmId === ctx.actor ? { project: { ...p, pmId: null }, result: true } : null), ctx.env)

      return { text: ct('pm.released', { project: ref.name }), structured: { pmId: null } }
    }
    const project = await loadProject(ref, ctx.env)
    const url = await boardUrl(ctx, ref)
    const open = project.ledger.filter(i => i.status === 'open').length

    return {
      text: ct('pm.status', { project: ref.name, path: ref.path, pm: project.pmId ?? ct('pm.nobody'), open, total: project.ledger.length, url: url ?? ct('pm.noBoardUrl') }),
      structured: { project: ref.name, path: ref.path, pmId: project.pmId, open, total: project.ledger.length, boardUrl: url },
    }
  } catch (err) {
    return failed(err)
  }
}

/** The web board's address with its token, while `serve` runs (server.json, and its process still alive). */
export async function boardUrl(ctx: Ctx, ref?: ProjectRef): Promise<string | null> {
  const server = await readJsonFile<{ port: number; token: string; pid: number }>(paths(ctx.env).server).catch(() => null)
  if (!server?.port || !server.token) return null
  try {
    process.kill(server.pid, 0)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return null
  }
  const project = ref ? `&p=${encodeURIComponent(ref.key)}` : ''

  return `http://127.0.0.1:${server.port}/#t=${server.token}${project}`
}

// ── board ──

/** How long the board waits on git and GitHub before it answers with what it holds (3.1: every call within 10 s). */
const FACTS_WAIT_MS = 6_000

export type BoardJson = {
  /** pmName: the PM as people read it (T-43); pmId stays for programs. */
  project: { name: string; path: string; key: string; pmId: string | null; pmName: string | null }
  /** In words for people: sessions by name (T-43). */
  attention: { text: string; item?: number }[]
  /** ownerName: the owner as people read it, with its status (T-43); owner stays the id, for programs. */
  items: (ReturnType<typeof itemJson> & { qaShown: QaShown | null; ownerName: string })[]
  actors: BoardActor[]
  agents: unknown[]
  /** The PM's agents as the pane's cards show them (T-44): listed ones only; `agentsHidden` more are folded away. */
  agentCards: AgentCard[]
  agentsHidden: number
  /** The pane's figures and words, so the web board says and counts what the pane does (T-44). */
  pane: PaneJson
  progress: { done: number; total: number }
  /** The open items by kind, in the board's words (T-42): `text` is the line the pane and the text board say. */
  breakdown: OpenBreakdown
  boardUrl: string | null
  revision: number
  sessionsError: string | null
  isCheckingCi: boolean
  /** Commits pushed past the pre-push check (git push --no-verify), newest first. */
  noPush: { branch: string; commits: string[] } | null
  /** Pushes the pre-push check could not check, in the last week. */
  pushProblems: { at: number; reason: string }[]
}

/** A session's card, as the pane draws it (T-44): its theme color (`look`), its steps, and its lines in the pane's words. */
export type BoardActor = {
  id: string
  tool: string
  status: Status
  label: string
  /** The pane's theme color for the status: warning, error, claude, planMode, permission, success, suggestion, inactive, subtle. */
  look: string
  /** The pane's own hue for the status's marks (its dot, its step bar). */
  hex: string
  title: string
  said: string
  at: number
  plan: { done: number; total: number }
  /** "Steps 3/7", in the pane's words; '' without a task list. */
  stepsText: string
  steps: Step['status'][]
  /** The step now (in progress, else the next), with how many more: "▸ Boost in-stock items (+3 more)". */
  current: string | null
  /** What the session left to follow up (the pane's caveat), else null; `summary` is the line otherwise. */
  caveat: string | null
  summary: string
  /** Listed among the active sessions, not folded with the ended ones. */
  isActive: boolean
  untracked: boolean
}

export type AgentCard = { id: string; name: string; state: AgentState; label: string; look: string; hex: string; time: string; meta: string[]; line: string; usage: string | null; isRunning: boolean }

export type PaneJson = {
  kpi: Kpi
  /** null with nothing to count (no work items, no steps). */
  percent: number | null
  words: Record<'project' | 'ratioCaption' | 'kpiRunning' | 'kpiAsking' | 'kpiOpen' | 'kpiAgents' | 'items' | 'itemsMeta' | 'agents' | 'agentsMeta' | 'sessions' | 'sessionsMeta' | 'showEnded' | 'hideEnded' | 'noLive' | 'noSessions' | 'caveat' | 'agentsHidden', string>
}

/** A work item's QA by the pane's theme colors (hooks/view.tsx QA_COLOR). */
const QA_LOOK: Record<QaShown, string | null> = { pass: 'success', fail: 'error', awaiting: 'warning', skipped: null }

/**
 * The board tool. `isForPeople`: the words as people read them, each session by name and never by its raw id (T-43;
 * `project-pm board` in a terminal, T-46); the model's board keeps the ids, which it assigns owners by.
 */
export async function boardTool(ctx: Ctx, input: Record<string, unknown>, isForPeople = false): Promise<ToolResult> {
  if (input.scope === 'all') return boardOfAll(ctx, input.include_done === true, isForPeople)
  const ref = await projectOf(ctx, input)
  if (!ref) return notGit(ctx, input)
  try {
    const { text, peopleText, json } = await boardOf(ctx, ref, input.include_done === true)

    return { text: isForPeople ? peopleText : text, structured: json as unknown as Record<string, unknown> }
  } catch (err) {
    return failed(err)
  }
}

/** Every project the core keeps, one board after another. */
async function boardOfAll(ctx: Ctx, isIncludingDone: boolean, isForPeople: boolean): Promise<ToolResult> {
  try {
    const dir = join(paths(ctx.env).home, 'projects')
    const names = (await readdir(dir).catch(() => [] as string[])).filter(name => name.endsWith('.json'))
    const boards: { text: string; peopleText: string; json: BoardJson }[] = []
    for (const name of names) {
      const file = await readJsonFile<CoreProject>(join(dir, name)).catch(() => null)
      if (!file?.path) continue
      boards.push(await boardOf(ctx, projectRefOf(file.path), isIncludingDone))
    }

    return { text: boards.length ? boards.map(b => (isForPeople ? b.peopleText : b.text)).join('\n\n---\n\n') : t('board.none'), structured: { projects: boards.map(b => b.json) } }
  } catch (err) {
    return failed(err)
  }
}

/** The board of one project: the mod's board text, and the same as JSON for the web board and other programs. */
export async function boardOf(ctx: Ctx, ref: ProjectRef, isIncludingDone: boolean): Promise<{ text: string; peopleText: string; json: BoardJson; project: CoreProject }> {
  const project = await loadProject(ref, ctx.env)
  const owners = project.ledger.filter(i => i.status === 'open' && i.owner).map(i => i.owner!)
  let found
  let sessionsError: string | null = null
  try {
    found = await projectSessions(ref, owners, ctx.env, project.pmId, ctx.now())
    if (found.errors.length) sessionsError = found.errors.join('; ')
  } catch (err) {
    sessionsError = err instanceof Error ? err.message : String(err)
    found = { sessions: [] as Session[], everyone: [] as Session[], tracks: {} as Record<string, Track>, actors: [] as Actor[], errors: [], words: {}, ci: {}, push: {}, agents: [] }
  }
  // The PM is not one of the sessions it follows (the desktop app's list leaves the asking session out too).
  found = { ...found, sessions: found.sessions.filter(s => s.id !== project.pmId) }
  const now = ctx.now()
  // Git and GitHub for every idle session whose words leave a push or CI: asked in parallel, waited on for a while. A
  // desktop session's are what the PM's mod found at its last round (E2): not asked again.
  const words = found.words
  const ci: Record<string, CiCheck> = { ...found.ci }
  const push: Record<string, PushCheck> = { ...found.push }
  let isCheckingCi = false
  const asks = found.everyone
    .filter(s => !s.isRunning && (hasReport(found.tracks[s.id]) || !!words[s.id]) && !found.ci[s.id] && !found.push[s.id])
    .map(async s => {
      const facts = await factsFor(ctx, s.id, s.cwd, found.tracks[s.id], words[s.id])
      if (facts.ci) ci[s.id] = facts.ci
      if (facts.push) push[s.id] = facts.push
    })
  const all = Promise.all(asks).then(() => true)
  const isAnswered = await Promise.race([all, new Promise<boolean>(resolve => setTimeout(() => resolve(false), FACTS_WAIT_MS).unref?.())])
  if (!isAnswered) {
    isCheckingCi = true
    // What the slow ones already know stays; the rest answer next time.
    for (const s of found.everyone) {
      const track = found.tracks[s.id]
      const held = track || words[s.id] ? heldCi(ctx.facts, s.id, ciWords(track, words[s.id])) : undefined
      if (held && !ci[s.id]) ci[s.id] = held
      const pushed = ctx.facts.push.get(s.id)
      if (pushed && !push[s.id]) push[s.id] = pushed
    }
  }
  // The person's closing of their work items settles ended agents, as the mod's checkAgents does (T-49).
  const agents = settledAgents(found.agents, project.ledger)
  const input: BoardInput = {
    project: { name: ref.name, path: ref.path },
    sessions: found.sessions,
    everyone: found.everyone,
    tracks: found.tracks,
    words,
    ci,
    push,
    ledger: project.ledger,
    agents: agents.length ? agents : undefined,
    now,
    isIncludingDone,
  }
  // The model's board names sessions with their ids; the web board's words, for people, by name alone (T-43).
  let text = boardText(input)
  const peopleInput = { ...input, isForPeople: true }
  let forPeople = boardText(peopleInput)
  const who = whoOf(peopleInput)
  const attend = (line: string, peopleLine = line) => {
    text = withAttention(text, line, t('board.section.attention'), t('board.none'))
    forPeople = withAttention(forPeople, peopleLine, t('board.section.attention'), t('board.none'))
  }
  // Layer 1: commits that reached the remote past the pre-push check (6.2 point 5).
  const hook = await prePushInstalled(ref, ctx.env)
  const pushed = hook === null ? null : await pushedUnchecked(project, ref.path, ctx.run, hook.baseline)
  if (pushed?.commits.length) attend(ct('board.noPush', { branch: pushed.branch, n: pushed.commits.length, sha: pushed.commits[0]!.slice(0, 7) }))
  // Pushes the check let through because it could not check them (6.2), for a week.
  const problems = await pushProblems(ref, ctx.env, now)
  for (const problem of problems) attend(ct('board.pushNotChecked', { when: localMinute(problem.at), reason: problem.reason }))
  // The guidelines file changed without the person agreeing (guard.ts: only noticed, never put back), for a week.
  for (const alert of await guidelinesAlerts(ref, ctx.env, now)) attend(alertText(alert, localMinute(alert.at)), alertText(alert, localMinute(alert.at), who))
  const notes = [...(sessionsError ? [ct('board.noSessionsRead', { error: sessionsError })] : []), ...(isCheckingCi ? [ct('board.ciChecking')] : [])]
  for (const note of notes) {
    text += `\n\n${note}`
    forPeople += `\n\n${note}`
  }
  const url = await boardUrl(ctx, ref)
  const actorById = new Map(found.actors.map(a => [a.id, a]))
  const statusById = new Map<string, Status>()
  // As the board and the pane read it: the person's closing (settledAt) and a handover (isHandedOff) count too.
  for (const s of found.everyone) statusById.set(s.id, statusOf(s, hasReport(found.tracks[s.id]) ? found.tracks[s.id] : undefined, words[s.id], now, ci[s.id], push[s.id], settledAt(s.id, project.ledger), isHandedOff(s.id, project.ledger)))
  // Each item's QA as the text board reads it (deliveredOf), so the web board's counts and the board's words agree (T-42).
  const isDelivered = deliveredOf(input)
  const openItems = project.ledger.filter(i => i.status === 'open')
  const breakdown = openBreakdown(openItems.map(item => ({ item, qa: qaShown(item, isDelivered(item.owner)) })))
  const counted = project.ledger.filter(i => i.status !== 'dropped')
  const ownerName = ownerTextOf(peopleInput)
  const pmTrack = project.pmId ? found.tracks[project.pmId] : undefined
  const pmSession = project.pmId ? found.everyone.find(s => s.id === project.pmId) : undefined
  // ── What the pane shows (hooks/view.tsx renderPane), for the web board to draw alike (T-44) ──
  const trackFor = (s: Session) => found.tracks[s.id] ?? (actorById.get(s.id) ? trackOf(actorById.get(s.id)!) : undefined)
  const isOwner = (s: Session) => openItems.some(item => isSameId(item.owner, s.id))
  const actors: BoardActor[] = found.sessions
    .map(s => {
      const status = statusById.get(s.id) ?? 'done'
      const actor = actorById.get(s.id)
      const track = trackFor(s)
      const kept = hasReport(track) ? track : undefined
      const plan = track?.plan ?? []
      const left = openSteps(kept)
      const now_ = left.find(step => step.status === 'in_progress') ?? left[0]
      const caveat = status === 'running' || settledAt(s.id, project.ledger) !== undefined ? null : caveatOf(kept, push[s.id])

      return {
        id: s.id,
        tool: actor?.tool ?? 'claude-code',
        status,
        label: statusText(status, status === 'limit' ? limitOf(s, kept, words[s.id]) : null, 'label'),
        look: STATUS[status].color,
        hex: STATUS[status].hex,
        title: sessionName(s, track),
        said: track ? clip(track.report?.summary || quoteOf(track, words[s.id]) || latestWords(track), 300) : clip(words[s.id]?.said ?? '', 300),
        at: Math.max(actor ? activeAt(actor) : 0, Date.parse(s.lastActivityAt) || 0),
        plan: { done: plan.filter(p => p.status === 'completed').length, total: plan.length },
        steps: plan.map(p => p.status),
        stepsText: plan.length ? t('pane.steps', { done: plan.length - left.length, total: plan.length }) : '',
        current: now_ ? `▸ ${now_.content}${left.length > 1 ? t('pane.moreSteps', { n: left.length - 1 }) : ''}` : null,
        caveat: caveat ? clip(caveat, 160) : null,
        summary: clip(cardSummary(kept, words[s.id]), 160),
        isActive: isActive(status) || !!caveat || s.hasOpenPr || isOwner(s),
        untracked: !kept,
      }
    })
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || b.at - a.at)
  const liveCount = actors.filter(a => a.isActive).length
  const kpi = kpiOf(actors.map(a => a.status), agents)
  const items = project.ledger.filter(i => i.status !== 'dropped')
  const itemsDone = items.filter(i => i.status === 'done').length
  const steps = actors.flatMap(a => a.steps)
  const stepsDone = steps.filter(s => s === 'completed').length
  const hasRatio = items.length > 0 || steps.length > 0
  const ratio = items.length ? itemsDone / items.length : steps.length ? stepsDone / steps.length : 0
  const listedAgents = shownAgents(agents, now, isIncludingDone)
  const agentCard = (one: AgentRecord): AgentCard => ({
    id: one.id,
    name: agentName(one),
    state: one.state,
    label: t(`agent.state.${one.state}` as MessageKey),
    look: STATUS[AGENT_STATUS[one.state]].color,
    hex: STATUS[AGENT_STATUS[one.state]].hex,
    time: agentTime(one, now),
    meta: [one.type, one.isolated ? t('pane.agentWorktree') : t('pane.agentReadOnly')],
    line: one.result ? clip(one.result, 160) : t('pane.agentWorking'),
    usage: one.tokens !== undefined ? t('pane.agentUsage', { tokens: Math.round(one.tokens / 1000), tools: one.tools ?? 0 }) : null,
    isRunning: one.state === 'running',
  })
  /** A work item's owner as the pane's row says it, with the color it marks it in. */
  const paneOwner = (owner: string | null): { ownerLine: string; ownerLook: string | null; ownerAgentHex: string | null; ownerAgentRunning: boolean } => {
    const plain = { ownerAgentHex: null, ownerAgentRunning: false }
    if (!owner) return { ownerLine: t('pane.ownerNone'), ownerLook: 'warning', ...plain }
    if (isAgentId(owner)) {
      const agent = agents.find(a => isSameId(`agent:${a.id}`, owner))
      if (agent) {
        const name = agentName(agent).replace(/^\s*T-\d+\s*/i, '')

        return { ownerLine: t('pane.ownerAgent', { name, status: t(`agent.state.${agent.state}` as MessageKey) }), ownerLook: null, ownerAgentHex: STATUS[AGENT_STATUS[agent.state]].hex, ownerAgentRunning: agent.state === 'running' }
      }

      return { ownerLine: t('pane.ownerGone'), ownerLook: 'warning', ...plain }
    }
    const one = found.everyone.find(s => isSameId(s.id, owner))
    if (!one) return { ownerLine: t('pane.ownerGone'), ownerLook: 'warning', ...plain }
    const status = statusById.get(one.id) ?? 'done'
    const elsewhere = found.sessions.some(s => s.id === one.id) ? '' : t('pane.elsewhere')

    return { ownerLine: t('pane.owner', { title: sessionName(one, found.tracks[one.id]), status: statusText(status, status === 'limit' ? limitOf(one, found.tracks[one.id], words[one.id]) : null, 'label'), elsewhere }), ownerLook: null, ...plain }
  }
  const json: BoardJson = {
    project: { name: ref.name, path: ref.path, key: ref.key, pmId: project.pmId, pmName: project.pmId ? sessionName(pmSession ?? { id: project.pmId, title: pmTrack?.title }, pmTrack) : null },
    attention: attentionOf(forPeople).map(line => {
      const code = /\bT-(\d+)\b/.exec(line)

      return code ? { text: line, item: Number(code[1]) } : { text: line }
    }),
    items: (isIncludingDone ? project.ledger : project.ledger.filter(i => i.status === 'open')).map(item => {
      const shown = qaShown(item, isDelivered(item.owner))

      return { ...itemJson(item), qaShown: shown, ownerName: ownerName(item.owner), ...paneOwner(item.owner), qaText: shown ? qaText(item, shown, false, who) : null, qaLook: shown ? QA_LOOK[shown] : null }
    }),
    actors,
    agents,
    agentCards: listedAgents.map(agentCard),
    agentsHidden: agents.length - listedAgents.length,
    pane: {
      kpi,
      percent: hasRatio ? Math.round(ratio * 100) : null,
      words: {
        project: t('pane.project'),
        ratioCaption: items.length ? t('pane.itemsDone', { done: itemsDone, total: items.length }) : steps.length ? t('pane.stepsDone', { done: stepsDone, total: steps.length }) : t('pane.noItems'),
        kpiRunning: t('pane.kpiRunning'),
        kpiAsking: t('pane.kpiAsking'),
        kpiOpen: t('pane.kpiOpen'),
        kpiAgents: kpi.runningAgents ? t('pane.kpiAgents', { n: kpi.runningAgents }) : '',
        items: t('pane.items'),
        itemsMeta: t('pane.itemsOpen', { n: openItems.length }),
        agents: t('pane.agents'),
        agentsMeta: t('pane.agentsMeta', { running: kpi.runningAgents, ended: agents.length - kpi.runningAgents }),
        sessions: t('pane.sessions'),
        sessionsMeta: t('pane.sessionsMeta', { live: liveCount, ended: actors.length - liveCount }),
        showEnded: t('pane.showEnded', { n: actors.length - liveCount }),
        hideEnded: t('pane.hideEnded'),
        noLive: actors.length ? t('pane.noLive') : t('pane.noSessions'),
        noSessions: t('pane.noSessions'),
        caveat: t('pane.caveat'),
        agentsHidden: t('pane.agentsHidden', { n: agents.length - listedAgents.length }),
      },
    },
    progress: { done: counted.filter(i => i.status === 'done').length, total: counted.length },
    breakdown,
    boardUrl: url,
    revision: project.revision ?? 0,
    sessionsError,
    isCheckingCi,
    noPush: pushed?.commits.length ? { branch: pushed.branch, commits: pushed.commits } : null,
    pushProblems: problems,
  }

  return { text, peopleText: forPeople, json, project }
}

/** A moment as the person's clock shows it, to the minute: 2026-11-19 20:05. */
function localMinute(at: number): string {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** The lines of the board's attention section. */
function attentionOf(text: string): string[] {
  const lines = text.split('\n')
  const at = lines.indexOf(t('board.section.attention'))
  if (at < 0) return []
  const out: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) break
    out.push(line)
  }

  return out.length === 1 && out[0] === t('board.none') ? [] : out
}

