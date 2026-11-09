import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Me } from '../types'

import { applyPlan, clip, finishedTasks, planFromTodos } from './sessions'
import {
  BOARD_TOOL,
  CLAIM,
  LEDGER_TOOL,
  MGMT,
  REPORT_TOOL,
  PANE,
  POLL_MS,
  ROLE,
  board,
  changeMine,
  claim,
  closesBoard,
  deliveryAsk,
  ensureBoard,
  ensureTools,
  getMine,
  identify,
  isReporter,
  ledger,
  loadRound,
  notifyPm,
  openBoard,
  reason,
  refresh,
  refreshSoon,
  registerReportTool,
  registerTools,
  release,
  rememberBoard,
  report,
  str,
  textOf,
  updateOf,
} from './actions'
import { MAX_CHARS, WRITING_TOOLS, asksForGuidelines, guidelinesPath, isSameFile, readGuidelines } from './guidelines'
import { getLang, resolveLang, setLang, systemLocale, t } from './messages'
import { reloadIfUpdated } from './update'
import { renderBand, renderPane } from './view'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)

/** Whether this copy of the module has done its start-up: a reload starts a fresh copy. */
let isStarted = false

/** The `/config` row of the `language` option (plugin.json `userConfig`): auto, en or zh-TW. */
const LANGUAGE_ROW = 'project-pm.language'

/** The `/config` row of the `guidelines` option: the path of the development guidelines, empty for none. */
const GUIDELINES_ROW = 'project-pm.guidelines'

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
  if ((await read($, me))?.isPm) await registerTools($)
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
    await identify($)
    // The PM's board and ledger, or a reporting session's report tool.
    await ensureTools($)
    // A new process draws the board from the last round at once; its own first round follows.
    await loadRound($)
  } catch (err) {
    $.ui.log(`project-pm: ${reason(err)}`)
  }
  await keepBoard($, 'start')
  // A round still running when its copy of the module goes (a reload) has nowhere left to report.
  $.clock.every(POLL_MS, () => void keepBoard($, 'poll')
    .then(() => refresh($))
    .then(() => reloadIfUpdated($))
    .catch(() => undefined))
  refreshSoon($, 300)
  $.clock.after(1_000, () => void reloadIfUpdated($).catch(() => undefined))
}

// ── Hooks ──

export const register: Register = (on, options) => {
  // The `language` option when it names one, else the system's (messages.ts): read once per load,
  // and a change to the option reloads the module.
  setLang(resolveLang(options.language, systemLocale()))
  guidelinesOption = typeof options.guidelines === 'string' ? options.guidelines : ''

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
    // A new turn starts: last turn's recap and question no longer stand (a background wake-up included).
    if (!e.command) await changeMine($, t => ({ ...t, ask: null, recap: null, ...(e.isMeta ? {} : { lastPrompt: clip(e.text, 400) }) }))
    // A background command's notification: it has finished, one way or another.
    const finished = finishedTasks(e.text)
    if (finished.length) await changeMine($, t => ({ ...t, background: (t.background ?? []).filter(b => !finished.includes(b.id)) }))
    refreshSoon($, 500)

    return next(e)
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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      // A turn that ended without its own wrap_up leaves no recap: the one there is an older turn's.
      await changeMine($, t => ({
        ...t,
        lastAnswer: clip(e.answer, 800),
        turnAt: now,
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
      refreshSoon($, 500)
      // The PM hears of it now, not at its next poll.
      try {
        await notifyPm($)
      } catch (err) {
        $.ui.log(`project-pm: ${reason(err)}`)
      }
    }

    return next(e)
  })

  on('tool.call', { tool: REPORT_TOOL }, async ($, e) => ({ result: await report($, e as unknown as Record<string, unknown>) })).catch(() => ({
    deny: t('report.badStatus'),
  }))

  // An update from another session of the project: its track is on disk, so the board reads it now. Taken in here,
  // so it is never queued, written to the transcript or read by the model: no turn, no tokens.
  on('session.receive', async ($, e, next) => {
    const id = updateOf(e.text)
    if (!id) return next(e)
    refreshSoon($, 100)

    return { consumed: `project-pm: update from ${id}` }
  })

  on('tool.call', { tool: BOARD_TOOL }, async ($, e) => ({ result: await board($, e as unknown as Record<string, unknown>) })).catch(() => ({
    deny: t('command.denyBoard'),
  }))
  on('tool.call', { tool: LEDGER_TOOL }, async ($, e) => {
    const text = await ledger($, e as unknown as Record<string, unknown>)
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
    if (!self?.isPm) {
      // A session of a project with a PM declares its delivery at its end; other projects' sessions hear nothing.
      const ask = await deliveryAsk($)
      if (!self || !ask) return composed
      const rules = await guidelinesSection($, self)

      return {
        sections: [
          ...composed.sections,
          { id: 'project-pm:delivery', text: ask, scope: 'session' as const },
          ...(rules ? [{ id: 'project-pm:guidelines', text: rules, scope: 'session' as const }] : []),
        ],
      }
    }
    const rules = await guidelinesSection($, self)

    return {
      sections: [
        ...composed.sections,
        { id: 'project-pm:role', text: ROLE(self), scope: 'session' as const },
        ...(rules ? [{ id: 'project-pm:guidelines', text: rules, scope: 'session' as const }] : []),
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
