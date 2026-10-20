import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Me } from '../types'

import { applyPlan, clip, finishedTasks, planFromTodos } from './sessions'
import {
  BOARD_TOOL,
  CLAIM,
  LEDGER_TOOL,
  MGMT,
  PANE,
  POLL_MS,
  ROLE,
  board,
  changeMine,
  claim,
  closesBoard,
  ensureBoard,
  ensureTools,
  getMine,
  identify,
  ledger,
  loadRound,
  openBoard,
  reason,
  refresh,
  refreshSoon,
  registerTools,
  release,
  rememberBoard,
  str,
  textOf,
} from './actions'
import { getLang, resolveLang, setLang, systemLocale, t } from './messages'
import { renderBand, renderPane } from './view'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)

/** Whether this copy of the module has done its start-up: a reload starts a fresh copy. */
let isStarted = false

/** The `/config` row of the `language` option (plugin.json `userConfig`): auto, en or zh-TW. */
const LANGUAGE_ROW = 'project-pm.language'

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
    if (self?.isPm) await registerTools($)
    // A new process draws the board from the last round at once; its own first round follows.
    await loadRound($)
  } catch (err) {
    $.ui.log(`project-pm: ${reason(err)}`)
  }
  await keepBoard($, 'start')
  // A round still running when its copy of the module goes (a reload) has nowhere left to report.
  $.clock.every(POLL_MS, () => void keepBoard($, 'poll')
    .then(() => refresh($))
    .catch(() => undefined))
  refreshSoon($, 300)
}

// ── Hooks ──

export const register: Register = (on, options) => {
  // The `language` option when it names one, else the system's (messages.ts): read once per load,
  // and a change to the option reloads the module.
  setLang(resolveLang(options.language, systemLocale()))

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
    }

    return next(e)
  })

  on('tool.call', { tool: BOARD_TOOL }, async ($, e) => ({ result: await board($, e as unknown as Record<string, unknown>) })).catch(() => ({
    deny: t('command.denyBoard'),
  }))
  on('tool.call', { tool: LEDGER_TOOL }, async ($, e) => {
    const text = await ledger($, e as unknown as Record<string, unknown>)
    refreshSoon($)

    return { result: text }
  }).catch(() => ({ deny: t('command.denyLedger') }))

  on('prompt.compose', async ($, e, next) => {
    await start($)
    await ensureTools($)
    const composed = await next(e)
    const self = await read($, me)
    if (!self?.isPm) return composed

    return { sections: [...composed.sections, { id: 'project-pm:role', text: ROLE(self), scope: 'session' as const }] }
  })

  on('command.run', { command: 'pm' }, async ($, e) => {
    await start($)
    if (/^\s*(off|卸任|取消)\s*$/i.test(e.args)) return { text: await release($) }
    const lang = /^\s*(?:lang|language|語言)(?:\s+(\S+))?\s*$/i.exec(e.args)
    if (lang) return { text: await changeLanguage($, lang[1] ?? '') }
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
