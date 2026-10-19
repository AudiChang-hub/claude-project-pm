import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import type { Me } from '../types'

import { applyPlan, clip, planFromTodos } from './sessions'
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
  getMine,
  identify,
  ledger,
  reason,
  refresh,
  refreshSoon,
  registerTools,
  release,
  str,
  textOf,
} from './actions'
import { renderBand, renderPane } from './view'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)

// ── Hooks ──

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pm', description: '指定此 Session 為專案 PM（/pm off 卸任）' })
    await $.command.register({ name: 'board', description: '開啟或收合專案看板' })
    try {
      const self = await identify($)
      if (self?.isPm) {
        await registerTools($)
        void $.ui.open({ id: PANE, title: `${self.projectName} · PM` })
      }
    } catch (err) {
      $.ui.log(`project-pm: ${reason(err)}`)
    }
    $.clock.every(POLL_MS, () => void refresh($))
    refreshSoon($, 300)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.text.includes(CLAIM)) {
      try {
        await claim($)
      } catch (err) {
        $.ui.log(`project-pm: ${reason(err)}`)
      }
    }
    // A new turn starts: last turn's recap and question no longer stand (a background wake-up included).
    if (!e.command) await changeMine($, t => ({ ...t, ask: null, recap: null, ...(e.isMeta ? {} : { lastPrompt: clip(e.text, 400) }) }))
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
    deny: 'project-pm：專案看板讀取失敗，請稍後再試，或改用 list_sessions / list_events。',
  }))
  on('tool.call', { tool: LEDGER_TOOL }, async ($, e) => {
    const text = await ledger($, e as unknown as Record<string, unknown>)
    refreshSoon($)

    return { result: text }
  }).catch(() => ({ deny: 'project-pm：工作項目寫入失敗，請再試一次。' }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const self = await read($, me)
    if (!self?.isPm) return composed

    return { sections: [...composed.sections, { id: 'project-pm:role', text: ROLE(self), scope: 'session' as const }] }
  })

  on('command.run', { command: 'pm' }, async ($, e) => {
    if (/^\s*(off|卸任|取消)\s*$/i.test(e.args)) return { text: await release($) }
    const text = await claim($)
    const self = await read($, me)
    if (!self?.isPm) return { text }

    return {
      text,
      context: [
        `${ROLE(self)}\n\n使用者剛用 /pm 把這個 Session 設成 PM。先呼叫 ${BOARD_TOOL}，用幾句話報告專案現況：哪些 Session 在等使用者回覆、哪些停下但還有步驟、工作項目有沒有沒完成的。`,
      ],
    }
  })

  on('command.run', { command: 'board' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: '已收合專案看板，再次執行 /board 可重新開啟。' }
    }
    const self = await identify($)
    await $.ui.open({ id: PANE, title: self ? `${self.projectName} · 專案看板` : '專案看板' })
    void refresh($, true)

    return { text: '已開啟專案看板。' }
  })

  // ── Drawing ──

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, () => next(e)))
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
