// Context and quota (T-48, M8), the hooks' side: what each session records of its own context, the PM compacting
// itself, the hand-overs, and the PM's SendMessage weighed by what waking costs. The decisions are in context.ts.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Me, ProjectFile, Session, Sessions, Track } from '../types'
import { MGMT, changeMine, claim, dataDir, getMine, identify, loadProject, readJson, reason, sameJson, str, textOf } from './actions'
import {
  COMPACT_DELAY_MS,
  contextOf,
  getThresholds,
  effectiveTokens,
  handoverFromOf,
  handoverMarker,
  hasWorkLeft,
  holdsSend,
  idleOf,
  idleText,
  isHandoverBrief,
  isUserPrompt,
  needsHandoff,
  pmHandoverPath,
  sendKey,
  shouldCompact,
  startedIdOf,
  tokensText,
  usageTokens,
  wakeCost,
  withAutoCompact,
  withoutAutoCompact,
} from './context'
import type { ContextMark, UsageLike } from './context'
import { clip, projectKey, sessionName } from './sessions'
import { t } from './messages'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)
const sessions = atom({ plugin: 'project-pm', key: 'sessions' } as const, { list: [], fetchedAt: 0, error: null } as Sessions)
const tracks = atom({ plugin: 'project-pm', key: 'tracks' } as const, {} as Record<string, Track>)
const projects = atom({ plugin: 'project-pm', key: 'projects' } as const, {} as Record<string, ProjectFile>)
const liveContext = atom({ plugin: 'project-pm', key: 'liveContext' } as const, {} as Record<string, ContextMark>)

/** The window the pane's last-resort button sets in the project's settings.local.json: Claude Code then compacts there itself. */
export const BUTTON_WINDOW = 300_000

/** How long after `$.command.run` a compaction may still come in before the try counts as failed. */
export const COMMAND_GRACE_MS = 60_000

/** How often, and how long apart, a new PM checks that the old PM started it (its start_session answer comes after the start). */
const CLAIM_RETRIES_MS = [2_000, 5_000, 15_000, 30_000]

// ── The turn: whether it is the person's own, and what it left the context at ──

/** Whether the turn running now was started by the person's own message: start_session works only in such a turn. */
let isUserTurn = false

export function noteSubmit(e: { text: string; isMeta?: boolean; command?: unknown; origin?: { kind?: string; name?: string } }) {
  // This mod's own wake-ups are not the person's; another plugin's prompt is (the test host's included).
  isUserTurn = isUserPrompt({ ...e, origin: e.origin?.kind === 'plugin' && e.origin.name !== 'project-pm' ? undefined : e.origin })
}

export function isPersonTurn(): boolean {
  return isUserTurn
}

/**
 * The context the last request read: the engine's live figure (what the status line shows), else the turn's usage.
 * The turn's usage sums every request of the turn, so it stands in only when the live figure is not there.
 */
async function measure($: EngineInterface, usage: UsageLike): Promise<number | null> {
  try {
    const live = (await $.session.usage()).context?.tokens
    if (typeof live === 'number' && live > 0) return live
  } catch {
    // An engine without the figure: the turn's own usage.
  }

  return usageTokens(usage)
}

/** Whether a compaction of the PM is under way (scheduled, or trying), so one threshold crossing compacts once. */
let isCompacting = false

/**
 * A main-loop turn ended: its context goes into this session's track (and, the first turn after a compaction, as the
 * compaction's measured "after"). The PM past its threshold compacts itself, between turns.
 */
export async function afterTurn($: EngineInterface, usage: UsageLike) {
  const tokens = await measure($, usage)
  if (tokens === null) return
  const now = await $.clock.now()
  await changeMine($, track => {
    const next: Track = { ...track, context: { tokens, at: now } }
    // The figure after a compaction counts the summary alone; the next turn's counts the whole prompt, as people see it.
    if (track.compacted && !track.compacted.isMeasured && tokens < track.compacted.before) next.compacted = { ...track.compacted, after: tokens, isMeasured: true }
    // The turn that was told to hand the PM over ended with no new PM: the button is what is left.
    if (track.selfHandoff?.shownAt && !track.selfHandoff.to && !track.selfHandoff.failedAt) next.selfHandoff = { ...track.selfHandoff, failedAt: now }

    return next
  })
  const self = await read($, me)
  const mine = getMine()
  if (!self?.isPm || !mine || isCompacting || !shouldCompact(tokens, getThresholds().compact, mine.compactFailedAt)) return
  isCompacting = true
  // A moment after the turn: the session is between turns by then, where a compaction is taken.
  $.clock.after(COMPACT_DELAY_MS, () => {
    void compactSelf($, tokens)
      .catch(err => $.ui.log(`project-pm: ${reason(err)}`))
      .finally(() => {
        isCompacting = false
      })
  })
}

/**
 * The PM compacts itself: `$.session.compact` (the interactive CLI), else `/compact` through `$.command.run` (the desktop
 * app, an SDK session, refuses the first). Both failing, it is told to hand itself over (prompt.compose), and is not
 * tried again until its context has grown by RETRY_AFTER.
 */
export async function compactSelf($: EngineInterface, tokens: number): Promise<'compact' | 'command' | 'failed'> {
  const instructions = t('context.compactInstructions')
  const startedAt = await $.clock.now()
  try {
    const done = compactedSizes(await $.session.compact({ instructions }))
    if (done) {
      await recordCompaction($, done.tokensBefore ?? tokens, done.tokensAfter, 'plugin')

      return 'compact'
    }
  } catch {
    // Refused (an SDK session, a turn running): the command next.
  }
  const isCompactedSince = () => (getMine()?.compactedAt ?? 0) >= startedAt
  try {
    await $.command.run({ command: 'compact', args: instructions })
    if (isCompactedSince()) return 'command'
    // Run, but no compaction seen yet: it may still be queued behind a turn.
    $.clock.after(COMMAND_GRACE_MS, () => {
      if (!isCompactedSince()) void compactFailed($, tokens).catch(() => undefined)
    })

    return 'command'
  } catch {
    // Not there either.
  }
  await compactFailed($, tokens)

  return 'failed'
}

async function compactFailed($: EngineInterface, tokens: number) {
  const now = await $.clock.now()
  await changeMine($, track => ({ ...track, compactFailedAt: tokens, selfHandoff: track.selfHandoff && !track.selfHandoff.failedAt ? track.selfHandoff : { at: now, tokens } }))
}

/** A compaction's sizes, or null when a hook vetoed it (`{ skip }`). */
export function compactedSizes(result: unknown): { tokensBefore?: number; tokensAfter?: number } | null {
  const r = (result ?? {}) as { skip?: unknown; tokensBefore?: unknown; tokensAfter?: unknown }
  if (typeof r.skip === 'string') return null
  const size = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)

  return { tokensBefore: size(r.tokensBefore), tokensAfter: size(r.tokensAfter) }
}

/** A compaction of the main conversation, any trigger: the size it left, and for the PM its card's before and after. */
export async function recordCompaction($: EngineInterface, before: number | undefined, after: number | undefined, trigger: string) {
  if (typeof after !== 'number' || !(after > 0)) return
  const now = await $.clock.now()
  const self = await read($, me)
  await changeMine($, track => {
    const next: Track = { ...track, compactedTo: after, compactedAt: now }
    // Claude Code's idle compaction (precompute) is not the PM's doing: its card keeps the last one it made.
    if (self?.isPm && trigger !== 'precompute') {
      const from = before ?? track.context?.tokens ?? 0
      next.compacted = { before: from, after, at: now, isMeasured: false }
      delete next.compactFailedAt
      if (!next.selfHandoff?.to) delete next.selfHandoff
    }

    return next
  })
}

// ── What the turn is told (prompt.compose) ──

/** Whether a session still has work to hand over (context.ts hasWorkLeft), by its project's ledger. */
function hasWork(id: string, track: Track | undefined, project: ProjectFile | undefined): boolean {
  return hasWorkLeft(id, track, project?.ledger ?? [])
}

export type Section = { id: string; text: string; scope: 'session' }

/**
 * The quota sections of this turn's system prompt: a session past the hand-over threshold with work left is asked to
 * hand over; the PM, on the person's own turn, to hand itself over (compaction failed) and to start the hand-overs the
 * app would not start before.
 */
export async function quotaSections($: EngineInterface): Promise<Section[]> {
  const self = await read($, me)
  const mine = getMine()
  if (!self?.id || !mine) return []
  const project = (await read($, projects))[self.projectKey]
  const mark = mine.context ?? null
  if (!self.isPm) {
    if (!project?.pmId || project.isDismissed || !mark) return []
    if (!needsHandoff(mark, mine, getThresholds().handoff, hasWork(self.id, mine, project))) return []
    const text = t('context.handoffAsk', { tokens: tokensText(effectiveTokens(mark, mine)), threshold: tokensText(getThresholds().handoff), template: t('handover.template') })

    return [{ id: 'project-pm:handoff', text, scope: 'session' }]
  }
  if (!isUserTurn) return []
  const out: Section[] = []
  const handoff = mine.selfHandoff
  if (handoff && !handoff.to && !handoff.failedAt && mark && effectiveTokens(mark, mine) >= getThresholds().compact) {
    const path = pmHandoverPath(await dataDir($), self.projectName, handoff.at)
    const text = t('context.selfHandoff', { tokens: tokensText(effectiveTokens(mark, mine)), path, marker: handoverMarker(self.id), project: self.projectName })
    out.push({ id: 'project-pm:self-handoff', text, scope: 'session' })
    if (!handoff.shownAt) {
      const now = await $.clock.now()
      await changeMine($, track => (track.selfHandoff ? { ...track, selfHandoff: { ...track.selfHandoff, shownAt: now } } : track))
    }
  }
  const pending = mine.pendingHandoffs ?? []
  if (pending.length) {
    const list = pending.map(one => t('context.pendingItem', { title: one.title, prompt: clip(one.prompt, 600) })).join('\n')
    out.push({ id: 'project-pm:pending-handoffs', text: t('context.pending', { list }), scope: 'session' })
  }

  return out
}

// ── The PM's round: live figures, and an idle session to hand over ──

/** Parses get_usage's answer: `{ context: { status: 'ok', tokensUsed } }`; an idle session's is not ok. */
export function liveTokensOf(text: string): number | null {
  try {
    const context = (JSON.parse(text) as { context?: { status?: unknown; tokensUsed?: unknown } }).context
    const used = context?.tokensUsed

    return context?.status === 'ok' && typeof used === 'number' && used > 0 ? used : null
  } catch {
    return null
  }
}

/** The last activity each running session had when get_usage was last asked about it. */
const usageAskedAt = new Map<string, string>()

/**
 * The PM's round: the desktop app's live context of the project's running sessions (get_usage), and an idle session
 * past the hand-over threshold with work left, for which the PM is woken once (a turn of the mod's, not the person's).
 */
export async function quotaRound($: EngineInterface) {
  const self = await read($, me)
  if (!self?.id || !self.isPm) return
  const list = (await read($, sessions)).list.filter(one => projectKey(one.cwd) === self.projectKey && one.id !== self.id)
  const now = await $.clock.now()
  const held = await read($, liveContext)
  const live: Record<string, ContextMark> = {}
  for (const one of list.filter(s => s.isRunning)) {
    // Asked again only once the session did something since: a quiet PM asks the app nothing new (as its other rounds).
    if (usageAskedAt.get(one.id) === one.lastActivityAt) {
      if (held[one.id]) live[one.id] = held[one.id]!
      continue
    }
    usageAskedAt.set(one.id, one.lastActivityAt)
    try {
      const result = await $.mcp.call(MGMT, 'get_usage', { session_id: one.id })
      const tokens = result.isError ? null : liveTokensOf(textOf(result))
      if (tokens !== null) live[one.id] = { tokens, at: now }
      else if (held[one.id]) live[one.id] = held[one.id]!
    } catch {
      if (held[one.id]) live[one.id] = held[one.id]!
    }
  }
  if (!sameJson(held, live)) await update($, liveContext, () => live)
  const all = await read($, tracks)
  const project = (await read($, projects))[self.projectKey]
  for (const one of list) {
    if (one.isRunning || getMine()?.handoffAsked?.[one.id] !== undefined) continue
    const track = all[one.id]
    const mark = contextOf(track, live[one.id])
    if (!mark || !needsHandoff(mark, track, getThresholds().handoff, hasWork(one.id, track, project))) continue
    await changeMine($, mine => ({ ...mine, handoffAsked: { ...(mine.handoffAsked ?? {}), [one.id]: now } }))
    const text = t('context.wakePm', { name: sessionName(one, track), id: one.id, tokens: tokensText(effectiveTokens(mark, track)) })
    void $.prompt.submit({ text }).catch(err => $.ui.log(`project-pm: ${reason(err)}`))
    // One a round: the PM's turn takes it from there.
    break
  }
}

// ── The PM's SendMessage, weighed by what waking costs ──

/** The PM's sends held once, by recipient and message, and when. */
const heldSends = new Map<string, number>()

/** The session a SendMessage `to` names: its id, or its title. */
function recipientOf(list: Session[], to: string): Session | undefined {
  const bare = to.replace(/\s*\[[^\]]*\]\s*$/, '').trim()

  return list.find(one => one.id === bare) ?? list.find(one => !!one.title && one.title.trim() === bare)
}

/**
 * Why the PM's SendMessage waits, once: an idle session whose wake costs WAKE_ASK or more. The same message again
 * within RESEND_MS goes through, as does a send to a session the PM was woken to ask for hand-over notes.
 */
export async function heldSendReason($: EngineInterface, input: Record<string, unknown>): Promise<string | null> {
  const self = await read($, me)
  const to = str(input.to)?.trim()
  if (!self?.isPm || !to) return null
  const one = recipientOf((await read($, sessions)).list, to)
  if (!one || one.isRunning || one.id === self.id) return null
  if (getMine()?.handoffAsked?.[one.id] !== undefined) return null
  const track = (await read($, tracks))[one.id]
  const mark = contextOf(track, (await read($, liveContext))[one.id])
  if (!mark) return null
  const now = await $.clock.now()
  const idle = idleOf(one, track, now)
  const tokens = effectiveTokens(mark, track)
  const cost = wakeCost(tokens, idle)
  const key = sendKey(one.id, str(input.message) ?? '')
  if (!holdsSend(cost, idle, heldSends.get(key), now)) return null
  heldSends.set(key, now)

  return t('context.sendHeld', { name: sessionName(one, track), tokens: tokensText(cost), context: tokensText(tokens), time: idleText(idle) })
}

/** Forgets the held sends (a test's fresh start). */
export function forgetHeldSends() {
  heldSends.clear()
}

// ── start_session: hand-overs the app would not start, and the PM's own ──

/** A tool's answer as text: a string, MCP content, or anything else as JSON. */
function answerText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(part => (typeof part === 'string' ? part : str((part as { text?: unknown })?.text) ?? '')).join('\n')
  if (value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)) return answerText((value as { content: unknown }).content)

  return value === undefined ? '' : JSON.stringify(value)
}

/**
 * The PM's start_session, once answered: a hand-over the app refused (a turn another session's message started) is kept
 * for the person's next message; one that started leaves that list. The PM's own hand-over notes the new PM.
 */
export async function afterStartSession($: EngineInterface, input: Record<string, unknown>, result: { deny?: string; isError?: boolean; result?: unknown }) {
  const self = await read($, me)
  if (!self?.isPm) return
  const prompt = str(input.prompt) ?? ''
  const title = str(input.title)?.trim() || clip(prompt, 60)
  const id = result.deny !== undefined || result.isError === true ? null : startedIdOf(answerText(result.result))
  const isOwn = handoverFromOf(prompt) === self.id
  const now = await $.clock.now()
  if (id) {
    await changeMine($, track => {
      const pending = (track.pendingHandoffs ?? []).filter(one => one.prompt !== prompt && one.title !== title)
      const next: Track = { ...track, pendingHandoffs: pending }
      if (!pending.length) delete next.pendingHandoffs
      if (isOwn) next.selfHandoff = { ...(track.selfHandoff ?? { at: now, tokens: track.context?.tokens ?? 0 }), to: id }

      return next
    })

    return
  }
  if (isOwn || !isHandoverBrief(prompt)) return
  await changeMine($, track => ({ ...track, pendingHandoffs: [...(track.pendingHandoffs ?? []).filter(one => one.prompt !== prompt), { title, prompt, at: now }] }))
}

/**
 * The new PM of a hand-over claims the project when its brief names the old PM, that PM is still the project's, and
 * the old PM's own track says it started this session. The old PM's answer may come after the start: asked again a few times.
 */
export async function claimHandover($: EngineInterface, from: string, attempt = 0): Promise<boolean> {
  const self = await identify($)
  if (!self?.id || self.isPm || self.isScratch) return false
  const project = await loadProject($, self.projectKey, self.projectName, self.projectPath)
  const old = project.pmId === from ? await readJson<Track>($, `${await dataDir($)}/sessions/${from}.json`) : null
  if (old?.selfHandoff?.to === self.id) {
    await claim($, from)

    return true
  }
  const wait = CLAIM_RETRIES_MS[attempt]
  if (project.pmId === from && wait !== undefined) $.clock.after(wait, () => void claimHandover($, from, attempt + 1).catch(() => undefined))

  return false
}

// ── The pane's last resort: Claude Code compacts the project's sessions itself ──

/** The settings file the button writes: the project's own, local to this machine. */
export function buttonSettingsPath(projectPath: string): string {
  return `${projectPath.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/settings.local.json`
}

/** Whether the pane offers the button: the PM's compaction and its own hand-over both failed. */
export function needsButton(track: Track | null | undefined): boolean {
  return !!track?.selfHandoff?.failedAt && !track.selfHandoff.to && !track.autoCompactSet
}

/** The button: `autoCompactWindow` in the project's settings.local.json, every other byte as it was; the text before kept for the undo. */
export async function setAutoCompact($: EngineInterface): Promise<string> {
  const self = await read($, me)
  if (!self) return t('context.buttonFailed', { reason: 'no project' })
  const path = buttonSettingsPath(self.projectPath)
  let before: string | null = null
  try {
    before = await $.fs.read(path)
  } catch {
    before = null
  }
  const text = withAutoCompact(before, BUTTON_WINDOW)
  if (text === null) return t('context.buttonFailed', { reason: t('context.buttonUnreadable', { path }) })
  try {
    await $.fs.write(path, text)
  } catch (err) {
    return t('context.buttonFailed', { reason: reason(err) })
  }
  const now = await $.clock.now()
  await changeMine($, track => ({ ...track, autoCompactSet: { path, before, at: now } }))

  return t('context.buttonDone')
}

/** The undo: the file as it was, byte for byte, when nothing else changed it since; else only the key put back. */
export async function undoAutoCompact($: EngineInterface): Promise<string> {
  const set = getMine()?.autoCompactSet
  if (!set) return t('context.buttonUndone')
  let now: string | null = null
  try {
    now = await $.fs.read(set.path)
  } catch {
    now = null
  }
  if (now !== null) {
    const previous = set.before === null ? null : previousWindow(set.before)
    const wrote = withAutoCompact(set.before, BUTTON_WINDOW)
    const text = now === wrote && set.before !== null ? set.before : withoutAutoCompact(now, previous)
    try {
      await $.fs.write(set.path, text)
    } catch (err) {
      return t('context.buttonFailed', { reason: reason(err) })
    }
  }
  await changeMine($, track => {
    const next = { ...track }
    delete next.autoCompactSet

    return next
  })

  return t('context.buttonUndone')
}

/** The `autoCompactWindow` a settings text held before the button, or null. */
function previousWindow(text: string): number | string | null {
  try {
    const value = (JSON.parse(text) as Record<string, unknown>).autoCompactWindow

    return typeof value === 'number' || typeof value === 'string' ? value : null
  } catch {
    return null
  }
}
