import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Me } from '../types'

import { applyPlan, clip, finishedTasks, keyStateOf, planFromTodos, reportOf } from './sessions'
import {
  BOARD_TOOL,
  CLAIM,
  LEDGER_TOOL,
  MGMT,
  PANE,
  POLL_MS,
  REPORT_TOOL,
  ROLE,
  agentCallInput,
  agentDetailPath,
  board,
  changeMine,
  checkAgents,
  claim,
  closesBoard,
  deliveryAsk,
  ensureBoard,
  ensureTools,
  getMine,
  identify,
  isPmCall,
  isReporter,
  ledger,
  loadRound,
  noteKeyState,
  openBoard,
  reason,
  refresh,
  refreshSoon,
  registerReportTool,
  registerTools,
  release,
  rememberBoard,
  report,
  startAgent,
  startTurn,
  str,
  takeNotices,
  textOf,
  updateOf,
  usesCore,
} from './actions'
import { MAX_CHARS, WRITING_TOOLS, asksForGuidelines, guidelinesPath, isSameFile, readGuidelines } from './guidelines'
import { READ_ONLY_TYPES, briefOf, itemOf } from './agents'
import { isQaDescription } from './qa'
import { getLang, resolveLang, setLang, systemLocale, t } from './messages'
import { reloadIfUpdated } from './update'
import { getThresholds, handoverFromOf, parseThresholds, setThresholds, thresholdsWords } from './context'
import { afterStartSession, afterTurn, claimHandover, compactedSizes, heldSendReason, noteSubmit, quotaRound, quotaSections, recordCompaction } from './quota'
import { renderBand, renderPane } from './view'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)

/** Whether this copy of the module has done its start-up: a reload starts a fresh copy. */
let isStarted = false

/** The `/config` row of the `language` option (plugin.json `userConfig`): auto, en or zh-TW. */
const LANGUAGE_ROW = 'project-pm.language'

/** The `/config` row of the `guidelines` option: the path of the development guidelines, empty for none. */
const GUIDELINES_ROW = 'project-pm.guidelines'

/** The `/config` row of the `context` option: the hand-over and compaction thresholds ("200k 300k"), empty for the defaults. */
const CONTEXT_ROW = 'project-pm.context'

/**
 * `/pm context <handoff> <compact>` sets the thresholds (saved as the `context` option), `/pm context default` puts the
 * defaults back, and `/pm context` alone says what they are.
 */
async function changeContext($: EngineInterface, args: string): Promise<string> {
  const parsed = parseThresholds(args)
  if ('show' in parsed || 'error' in parsed) return t('context.usage', { now: thresholdsWords(getThresholds()) })
  const value = 'set' in parsed ? thresholdsWords(parsed.set) : ''
  setThresholds(value)
  let failure: string | null = null
  try {
    const result = await $.config.set({ key: CONTEXT_ROW, value })
    if ('deny' in result && result.deny) failure = result.deny
  } catch (err) {
    failure = reason(err)
  }
  if (failure !== null) return t('context.notSaved', { reason: failure })
  const now = getThresholds()
  const words = { handoff: thresholdsWords(now).split(' ')[0]!, compact: thresholdsWords(now).split(' ')[1]! }

  return 'set' in parsed ? t('context.set', words) : t('context.reset', words)
}

/** The `guidelines` option as this copy of the module was loaded with it, or as /pm guidelines just set it. */
let guidelinesOption = ''

/**
 * The person's latest own message in this session (not a command, not a background wake-up): the guidelines file
 * may be edited only in a turn it asks about the guidelines in. A reload forgets it, which keeps the file locked.
 */
let lastOwnPrompt = ''

/** Guidelines files already reported unreadable, so a broken path is logged once, not every turn. */
const unreadable = new Set<string>()

/**
 * The development guidelines as a system prompt section, for the PM and for the other sessions of a project with a
 * PM (prompt.compose): the file is read each turn, so an edit reaches the next turn of every session.
 */
async function guidelinesSection($: EngineInterface, self: Me): Promise<string | null> {
  const found = await readGuidelines($, guidelinesOption, self.projectPath)
  if (!found) return null
  if ('error' in found) {
    if (!unreadable.has(found.file)) {
      unreadable.add(found.file)
      $.ui.log(t('guidelines.unreadable', { file: found.file, error: found.error }))
    }

    return null
  }
  unreadable.delete(found.file)
  const parts = [t('guidelines.section', { file: found.file, project: self.projectName })]
  if (self.isPm) parts.push(t('guidelines.pm'))
  parts.push(found.text)
  if (found.isClipped) parts.push(t('guidelines.clipped', { max: MAX_CHARS, file: found.file }))

  return parts.join('\n\n')
}

/** The guidelines as an agent of the PM is given them: the file, without the PM's own part. */
async function agentGuidelines($: EngineInterface, self: Me): Promise<string | null> {
  const found = await readGuidelines($, guidelinesOption, self.projectPath)
  if (!found || 'error' in found) return null
  const parts = [t('guidelines.section', { file: found.file, project: self.projectName }), found.text]
  if (found.isClipped) parts.push(t('guidelines.clipped', { max: MAX_CHARS, file: found.file }))

  return parts.join('\n\n')
}

/**
 * `/pm guidelines <file>` saves the path as the `guidelines` option (the same `/config` row a person sets by hand),
 * `/pm guidelines off` clears it, and `/pm guidelines` alone says what is set and whether it reads.
 */
async function changeGuidelines($: EngineInterface, wanted: string): Promise<string> {
  const self = await read($, me)
  const projectPath = self?.projectPath ?? ''
  const value = /^(off|none|clear|取消|關閉)$/i.test(wanted.trim()) ? '' : wanted.trim().replace(/^["']|["']$/g, '')
  if (!wanted.trim()) {
    const found = await readGuidelines($, guidelinesOption, projectPath)
    const now = !found
      ? t('guidelines.none')
      : 'error' in found
        ? t('guidelines.broken', { file: found.file, error: found.error })
        : t('guidelines.ok', { file: found.file, chars: found.text.length })

    return t('guidelines.usage', { now })
  }
  guidelinesOption = value
  let failure: string | null = null
  try {
    const result = await $.config.set({ key: GUIDELINES_ROW, value })
    if ('deny' in result && result.deny) failure = result.deny
  } catch (err) {
    failure = reason(err)
  }
  if (failure !== null) return t('guidelines.notSaved', { reason: failure })
  if (!value) return t('guidelines.off')
  const found = await readGuidelines($, value, projectPath)
  const text = t('guidelines.set', { file: found?.file ?? value })

  return found && 'error' in found ? `${text}\n${t('guidelines.broken', { file: found.file, error: found.error })}` : text
}

async function registerCommands($: EngineInterface) {
  await $.command.register({ name: 'pm', description: t('command.pm') })
  await $.command.register({ name: 'board', description: t('command.board') })
}

/**
 * `/pm lang <en|zh-TW|auto>`: speaks it from now on, and saves it as the `language` option, the same
 * `/config` row and settings.json `pluginConfigs` entry a person sets by hand (the engine then reloads
 * the module with it). Words the engine already holds, the commands' and the tools' descriptions, are
 * given again in the new language.
 */
async function changeLanguage($: EngineInterface, wanted: string): Promise<string> {
  const value = /^(en|english|英)/i.test(wanted) ? 'en' : /^(zh|中|繁|tw)/i.test(wanted) ? 'zh-TW' : /^(auto|system|系統|自動)/i.test(wanted) ? 'auto' : null
  if (!value) return t('lang.usage', { lang: getLang() })
  setLang(resolveLang(value, systemLocale()))
  await registerCommands($)
  if (await usesCore($)) {
    // The core's tools: the core speaks its own language setting.
  } else if ((await read($, me))?.isPm) await registerTools($)
  else if (await isReporter($)) await registerReportTool($)
  let failure: string | null = null
  try {
    const result = await $.config.set({ key: LANGUAGE_ROW, value })
    if ('deny' in result && result.deny) failure = result.deny
  } catch (err) {
    failure = reason(err)
  }
  if (failure !== null) return t('lang.notSaved', { lang: getLang(), reason: failure })

  return value === 'auto' ? t('lang.setAuto', { lang: getLang() }) : t('lang.set', { lang: getLang() })
}

/** Brings the board back when it should be up (ensureBoard): a failure is logged, never in the way. */
async function keepBoard($: EngineInterface, why: 'start' | 'prompt' | 'poll') {
  try {
    await ensureBoard($, why)
  } catch (err) {
    $.ui.log(`project-pm: ${reason(err)}`)
  }
}

/**
 * The commands, the PM's tools and the polling timer. `session.start` does it at the session's
 * start; /reload-plugins loads a fresh copy without one (and the engine drops the old copy's
 * tools), so the first hook to run in that copy does it instead. Tools the engine drops later
 * (a change to the mod's folder reloads it before a command of it runs) come back by ensureTools.
 */
async function start($: EngineInterface) {
  if (isStarted) return
  isStarted = true
  await registerCommands($)
  try {
    const self = await identify($)
    // The PM's board and ledger, or a reporting session's report tool.
    await ensureTools($)
    // The PM's agents: one the engine no longer runs ended with the process before this one.
    if (self?.isPm) await checkAgents($)
    // A new process draws the board from the last round at once; its own first round follows.
    await loadRound($)
  } catch (err) {
    $.ui.log(`project-pm: ${reason(err)}`)
  }
  await keepBoard($, 'start')
  // A round still running when its copy of the module goes (a reload) has nowhere left to report.
  $.clock.every(POLL_MS, () => void keepBoard($, 'poll')
    .then(() => refresh($))
    .then(() => quotaRound($))
    .then(() => reloadIfUpdated($))
    .catch(() => undefined))
  refreshSoon($, 300)
  $.clock.after(1_000, () => void reloadIfUpdated($).catch(() => undefined))
  // The quota's first round (quota.ts) once the first round has the sessions; the poll's after that.
  $.clock.after(1_000, () => void quotaRound($).catch(() => undefined))
}

// ── Hooks ──

export const register: Register = (on, options) => {
  // The `language` option when it names one, else the system's (messages.ts): read once per load,
  // and a change to the option reloads the module.
  setLang(resolveLang(options.language, systemLocale()))
  guidelinesOption = typeof options.guidelines === 'string' ? options.guidelines : ''
  setThresholds(options.context)

  on('session.start', async ($, e, next) => {
    await start($)
    // A new process has no panes: the board comes back if it was left open (a start in the same copy, too).
    await keepBoard($, 'start')
    // A new process: background commands of the one before it ended with it.
    await changeMine($, t => (t.background?.length ? { ...t, background: [] } : t))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await start($)
    await ensureTools($)
    await keepBoard($, 'prompt')
    if (e.text.includes(CLAIM)) {
      try {
        await claim($)
      } catch (err) {
        $.ui.log(`project-pm: ${reason(err)}`)
      }
    }
    if (!e.command && !e.isMeta) lastOwnPrompt = e.text
    noteSubmit(e as unknown as Parameters<typeof noteSubmit>[0])
    // The brief of a PM's own hand-over: this session takes the project over, when that PM started it (quota.ts).
    const from = handoverFromOf(e.text)
    if (from) await claimHandover($, from).catch(err => $.ui.log(`project-pm: ${reason(err)}`))
    // A new turn starts: last turn's recap and question no longer stand (a background wake-up included).
    if (!e.command) await changeMine($, t => ({ ...t, ask: null, recap: null, ...(e.isMeta ? {} : { lastPrompt: clip(e.text, 400) }) }))
    // A background command's notification: it has finished, one way or another.
    const finished = finishedTasks(e.text)
    if (finished.length) await changeMine($, t => ({ ...t, background: (t.background ?? []).filter(b => !finished.includes(b.id)) }))
    refreshSoon($, 500)
    // The PM's agents that finished: taken in, and each reply read as its first line and the file the rest is in.
    if (e.text.includes('<task-notification>') && (await read($, me))?.isPm) {
      const text = await takeNotices($, e.text)
      if (text !== e.text) return next({ ...e, text })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The PM's Agent call: in the background, and in a worktree of its own unless it only reads (agentCallInput).
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (!(await isPmCall($, e.agentId))) {
      const result = await next(e)
      // Another session's agent in the background: the session waits on it, as on a background command, until its
      // notification (prompt.submit, finishedTasks) comes in.
      const started = result.result as { agentId?: unknown; isAsync?: unknown } | undefined
      if (e.agentId === undefined && started?.isAsync === true && typeof started.agentId === 'string') {
        const id = started.agentId
        const now = await $.clock.now()
        const label = clip(str((e as unknown as Record<string, unknown>).description) ?? id, 120)
        await changeMine($, t => ({ ...t, background: [...(t.background ?? []).filter(b => b.id !== id), { id, label, at: now }] }))
      }

      return result
    }
    const input = e as unknown as Record<string, unknown>
    const made = await agentCallInput($, input)
    if ('deny' in made) return { deny: made.deny }
    const result = await next(made.input as unknown as typeof e)
    if (result.deny === undefined && result.isError !== true) await startAgent($, made.input, result.result, str(input.tool_use_id) ?? '')

    return result
  }).catch(($, e, next) => next(e))

  // What the PM's agent is told beside its task: how to report, where to write the rest, and the guidelines; a QA
  // agent ("T-12 QA") also the checklist. One that only reads has no detail file: its reply holds the rest.
  on('agent.spawn', async ($, e, next) => {
    if (e.parentAgentId !== undefined || e.workflow || !(await isPmCall($, undefined))) return next(e)
    const self = await read($, me)
    const isIsolated = !READ_ONLY_TYPES.includes(e.subagentType)
    const detail = isIsolated ? await agentDetailPath($, e.tool_use_id) : null
    const rules = self ? await agentGuidelines($, self) : null

    return next({ ...e, prompt: `${e.prompt}${briefOf(detail, itemOf(e.description), isIsolated, rules, isQaDescription(e.description))}` })
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.deny === undefined && result.isError !== true) {
      const input = e as unknown as Record<string, unknown>
      const now = await $.clock.now()
      await changeMine($, t => ({ ...t, plan: applyPlan(t.plan, input), planAt: now }))
    }

    return result
  }).catch(($, e, next) => next(e))

  // A command run in the background (asked for, or moved there) runs on after the turn: the session waits on it.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const result = await next(e)
    // Bash and PowerShell both answer `backgroundTaskId` when the command runs on in the background.
    const id = (result.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId
    if (e.agentId === undefined && id) {
      const now = await $.clock.now()
      const label = clip(e.description || e.command, 120)
      await changeMine($, t => ({ ...t, background: [...(t.background ?? []).filter(b => b.id !== id), { id, label, at: now }] }))
    }

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const result = await next(e)
    const input = e as unknown as Record<string, unknown>
    const id = str(input.task_id) ?? str(input.shell_id)
    if (id && result.deny === undefined) await changeMine($, t => ({ ...t, background: (t.background ?? []).filter(b => b.id !== id) }))

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.deny === undefined && result.isError !== true) {
      const now = await $.clock.now()
      await changeMine($, t => ({ ...t, plan: planFromTodos(e.todos), planAt: now }))
    }

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.deny === undefined && result.isError !== true) {
      const input = e as unknown as Record<string, unknown>
      const now = await $.clock.now()
      await changeMine($, t => ({
        ...t,
        recap: str(input.recap) ?? null,
        ask: str(input.ask) ?? null,
        recapAt: now,
        plan: t.plan.map(s => ({ ...s, status: 'completed' as const })),
        planAt: now,
      }))
    }

    return result
  }).catch(($, e, next) => next(e))

  // The main conversation's turn that starts: a report made in it is kept with it (noteKeyState).
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) startTurn(e.turnId)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      // A turn that ended without its own wrap_up leaves no recap: the one there is an older turn's.
      await changeMine($, t => ({
        ...t,
        lastAnswer: clip(e.answer, 800),
        turnAt: now,
        // How it ended: a usage limit or an API error ends a turn with `error`. The answer is the model's own last words,
        // not the error's: those the app writes into the transcript, where the board reads them (limitOf).
        endedInError: e.reason === 'error',
        ...((t.recapAt ?? 0) > t.turnAt ? {} : { recap: null, ask: null }),
        // Likewise a report: one made in an earlier turn no longer says where this turn left the work.
        ...((t.reportAt ?? 0) > t.turnAt ? {} : { report: undefined, reportAt: undefined }),
      }))
      // The title is often given after the first turn.
      if (getMine() && !getMine()?.title) {
        try {
          const result = await $.mcp.call(MGMT, 'get_session', { session_id: 'self' })
          const o = JSON.parse(textOf(result)) as Record<string, unknown>
          if (typeof o.title === 'string') await changeMine($, t => ({ ...t, title: o.title as string }))
        } catch {
          // The title is a nicety.
        }
      }
      // The context this turn left: the card's figure, the hand-over's and the PM's own compaction's (quota.ts).
      await afterTurn($, e.usage).catch(err => $.ui.log(`project-pm: ${reason(err)}`))
      refreshSoon($, 500)
      // The PM hears of it now only when the session enters a key state (T-57): this turn's report says where it
      // stands, or the hand-over line its answer opens with; a turn without either leaves the key state it was in.
      try {
        const kept = getMine()?.keyState
        const reported = kept?.turnId !== undefined && kept.turnId === e.turnId ? kept.state : null
        await noteKeyState($, keyStateOf(null, e.answer) ?? reported, false)
      } catch (err) {
        $.ui.log(`project-pm: ${reason(err)}`)
      }
    }

    return next(e)
  })

  // A compaction of the main conversation, any trigger: the PM's summary keeps what it needs, and the size it left is
  // recorded (quota.ts). A failure to record never stops the compaction or runs it twice.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    let input = e
    try {
      if ((await read($, me))?.isPm && !e.instructions?.trim()) input = { ...e, instructions: t('context.compactInstructions') }
    } catch {
      input = e
    }
    const result = await next(input)
    const sizes = compactedSizes(result)
    if (sizes) await recordCompaction($, sizes.tokensBefore, sizes.tokensAfter, e.trigger).catch(() => undefined)

    return result
  })

  // The PM's message to an idle session that is costly to wake waits once, for the PM to weigh it (quota.ts).
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const held = await heldSendReason($, e as unknown as Record<string, unknown>)
      if (held) return { deny: held }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The PM's start_session: a hand-over the app would not start is kept for the person's next message (quota.ts).
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await afterStartSession($, e as unknown as Record<string, unknown>, result).catch(err => $.ui.log(`project-pm: ${reason(err)}`))

    return result
  })

  on('tool.call', { tool: REPORT_TOOL }, async ($, e, next) => {
    // The core's report tool (E2): it keeps the report; the PM hears of it at once when it enters a key state (T-57).
    if (await usesCore($)) {
      const result = await next(e)
      refreshSoon($, 100)
      const made = result.deny === undefined && result.isError !== true ? reportOf(e as unknown as Record<string, unknown>) : null
      if (made) await noteKeyState($, keyStateOf(made), true).catch(() => undefined)

      return result
    }

    return { result: await report($, e as unknown as Record<string, unknown>) }
  }).catch(() => ({
    deny: t('report.badStatus'),
  }))

  // An update from another session of the project: its track is on disk, so the board reads it now. Taken in here,
  // so it is never queued, written to the transcript or read by the model: no turn, no tokens.
  // The limit (T-57): only while this copy of the mod runs. The engine raises session.receive for the desktop app's
  // host-injected peer messages too, but where the PM's hooks are not running (seen under Claude Code 2.1.330: a PM
  // whose mod hooks stopped mid-session, until /reload-plugins, with no notice in the conversation), every hook fails
  // open and each update reaches the PM's model as "Another Claude session sent a message", a turn of its own. The
  // sender reads the difference: a consumed update answers "did not accept it", one queued for the model answers
  // delivered (CHANGELOG 0.6.1). So notifyPm stops sending to a PM that answered delivered until its mod writes again,
  // and sessions send an update only on entering a key state (noteKeyState).
  on('session.receive', async ($, e, next) => {
    const id = updateOf(e.text)
    if (!id) return next(e)
    refreshSoon($, 100)

    return { consumed: `project-pm: update from ${id}` }
  })

  on('tool.call', { tool: BOARD_TOOL }, async ($, e, next) => {
    // The core's board (E2) reads the desktop app's sessions from this PM's last round: a fresh one first.
    if (await usesCore($)) {
      await refresh($, true, (e as unknown as Record<string, unknown>).scope === 'all')

      return next(e)
    }

    return { result: await board($, e as unknown as Record<string, unknown>) }
  }).catch(() => ({
    deny: t('command.denyBoard'),
  }))
  on('tool.call', { tool: LEDGER_TOOL }, async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    // The PM's agents read the ledger; changing it is the PM's.
    if (e.agentId !== undefined && input.action !== 'list') return { deny: t('ledger.agentDenied') }
    if (await usesCore($)) {
      // A close waits on its owner, as the core reads it from this PM's round: a fresh one first.
      if (input.action === 'update' && input.status === 'done') await refresh($, true, true)
      const result = await next(e)
      refreshSoon($)

      return result
    }
    const text = await ledger($, input)
    refreshSoon($)

    return { result: text }
  }).catch(() => ({ deny: t('command.denyLedger') }))

  // The guidelines change only when the person asks for it: an edit to the file in a turn whose message does not
  // mention the guidelines is refused, with the reason, so the model asks first. A failure here lets the edit through.
  on('tool.call', async ($, e, next) => {
    const field = WRITING_TOOLS[e.tool]
    const target = field ? (e as unknown as Record<string, unknown>)[field] : undefined
    if (typeof target !== 'string' || !guidelinesOption.trim() || asksForGuidelines(lastOwnPrompt)) return next(e)
    const self = await read($, me)
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? null
    const file = guidelinesPath(guidelinesOption, home, self?.projectPath ?? '')
    if (!isSameFile(target, file)) return next(e)

    return { deny: t('guidelines.locked', { file }) }
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    await start($)
    await ensureTools($)
    const composed = await next(e)
    const self = await read($, me)
    // Outside the desktop app the core's hooks hand each turn the same (E2): said once.
    if (!self?.id && (await usesCore($))) return composed
    if (!self?.isPm) {
      // A session of a project with a PM declares its delivery at its end; other projects' sessions hear nothing.
      const ask = await deliveryAsk($)
      if (!self || !ask) return composed
      const rules = await guidelinesSection($, self)
      const quota = await quotaSections($).catch(() => [])

      return {
        sections: [
          ...composed.sections,
          { id: 'project-pm:delivery', text: ask, scope: 'session' as const },
          ...(rules ? [{ id: 'project-pm:guidelines', text: rules, scope: 'session' as const }] : []),
          ...quota,
        ],
      }
    }
    const rules = await guidelinesSection($, self)
    const quota = await quotaSections($).catch(() => [])

    return {
      sections: [
        ...composed.sections,
        { id: 'project-pm:role', text: ROLE(self), scope: 'session' as const },
        ...(rules ? [{ id: 'project-pm:guidelines', text: rules, scope: 'session' as const }] : []),
        ...quota,
      ],
    }
  })

  on('command.run', { command: 'pm' }, async ($, e) => {
    await start($)
    if (/^\s*(off|卸任|取消)\s*$/i.test(e.args)) return { text: await release($) }
    const lang = /^\s*(?:lang|language|語言)(?:\s+(\S+))?\s*$/i.exec(e.args)
    if (lang) return { text: await changeLanguage($, lang[1] ?? '') }
    const rules = /^\s*(?:guidelines?|rules|準則)(?:\s+([\s\S]+))?$/i.exec(e.args)
    if (rules) return { text: await changeGuidelines($, rules[1] ?? '') }
    const context = /^\s*(?:context|上下文|門檻)(?:\s+([\s\S]+))?$/i.exec(e.args)
    if (context) return { text: await changeContext($, context[1] ?? '') }
    const text = await claim($)
    const self = await read($, me)
    if (!self?.isPm) return { text }

    return {
      text,
      context: [
        `${ROLE(self)}\n\n${t('role.justClaimed', { board: BOARD_TOOL })}`,
      ],
    }
  })

  // /board turns the board on and off, and the board stays as the person leaves it. A board left undrawn (opened
  // unasked on a narrow window) is not on yet: /board places it.
  on('command.run', { command: 'board' }, async $ => {
    await start($)
    if ((await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)) {
      // The close itself keeps it closed (ui.close below).
      await $.ui.close({ id: PANE })

      return { text: t('command.boardClosed') }
    }
    const self = await identify($)
    await rememberBoard($, true)
    await openBoard($, self)
    // As the poll's round: nowhere to report once this copy of the module is gone.
    void refresh($, true).catch(() => undefined)

    return { text: t('command.boardOpened') }
  })

  // The person's close (the pane's close mark or key, the app closing it) and /board's own: the board stays closed
  // until /board. An unload (the engine dropping a pane nothing draws) never reaches the hooks, and a process that
  // ends closes nothing: those come back (ensureBoard).
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (closesBoard(e)) await rememberBoard($, false)

    return result
  })

  // ── Drawing ──

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, () => next(e)))
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
