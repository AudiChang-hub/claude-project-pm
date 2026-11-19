// The PM's agents: what a task notification says of one, the state its reply leaves it in, the brief each one is
// given, and the notification as the PM reads it. Pure: actions.ts keeps the records and register.tsx the hooks.

import type { AgentRecord, AgentState, LedgerItem } from '../types'
import { t } from './messages'

/** One line, cut to `max` characters (the same as sessions.ts's clip, which imports this file). */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Agent types that only read: they work in the PM's folder. Any other works in a git worktree of its own. */
export const READ_ONLY_TYPES: readonly string[] = ['Explore', 'Plan', 'claude-code-guide']

/** How long an agent's first line is kept, and how many agents the PM's track keeps (the latest; running ones always). */
export const RESULT_LINE = 120
export const AGENTS_KEPT = 50

/** The work item an agent's description leads with: T-12 → 12. */
export function itemOf(description: string): number | null {
  const m = /^\s*T-(\d+)\b/i.exec(description)

  return m ? Number(m[1]) : null
}

/** What one `<task-notification>` says of a finished agent (or command: the caller keeps those it knows). */
export type Notice = {
  id: string
  status: string
  result: string
  tokens?: number
  tools?: number
  durationMs?: number
  worktree?: { path: string; branch: string }
}

const field = (block: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]

/** Every notification in a prompt's text. */
export function noticesOf(text: string): Notice[] {
  return [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].flatMap(m => {
    const block = m[1]!
    const id = field(block, 'task-id')?.trim()
    if (!id) return []
    const number = (name: string) => {
      const value = Number(field(block, name))
      return Number.isFinite(value) && field(block, name) !== undefined ? value : undefined
    }
    const path = field(block, 'worktreePath')?.trim()
    const branch = field(block, 'worktreeBranch')?.trim()

    return [{
      id,
      status: field(block, 'status')?.trim() ?? '',
      result: field(block, 'result')?.trim() ?? '',
      tokens: number('subagent_tokens'),
      tools: number('tool_uses'),
      durationMs: number('duration_ms'),
      worktree: path && branch ? { path, branch } : undefined,
    }]
  })
}

/** A reply's first line, as the brief asks an agent to write it: `[status, commit] summary`. */
export function firstLine(result: string): string {
  return clip(result.split('\n').find(line => line.trim()) ?? '', RESULT_LINE)
}

/** The commit a first line names: `[done, 3fa1c2e] …`. */
export function commitOfLine(line: string): string | undefined {
  return /^\[[^\]]*?\b([0-9a-f]{7,40})\b[^\]]*\]/i.exec(line)?.[1]?.toLowerCase()
}

/**
 * Where a finished agent stands: failed or stopped; waiting on the person (its first line says waiting_user or
 * blocked); to verify (it committed in a worktree, for the PM to merge); else done.
 */
export function stateOf(status: string, line: string, isIsolated: boolean): AgentState {
  if (/failed|killed|stopped|error/i.test(status)) return 'failed'
  if (/^\[\s*(waiting_user|blocked)\b/i.test(line)) return 'decide'
  if (isIsolated && commitOfLine(line)) return 'verify'

  return 'done'
}

/** A QA agent's description: the work item's code, then QA as a word of its own (`T-12 QA`, `T-12 QA: abc`; not `T-12 QA-free`). */
export function isQaDescription(description: string): boolean {
  return /^\s*T-\d+\s+QA(?=$|[\s:：,，.。])/i.test(description)
}

/**
 * What the PM's mod adds to an agent's prompt: the rules it works by, how to report, and the guidelines. One that may
 * write puts its full account in `detail`; one that only reads cannot write a file, so it puts it in its reply, which
 * the mod keeps. A QA agent gets the checklist and answers pass or fail instead of the usual first line.
 */
export function briefOf(detail: string | null, item: number | null, isIsolated: boolean, guidelines: string | null, isQa = false): string {
  const code = item === null ? t('agent.noItem') : `T-${String(item).padStart(2, '0')}`
  const rules = [t('agent.brief', { item: code }), isQa ? t('agent.briefQaReply') : t('agent.briefReply')]
  rules.push(isIsolated && detail ? t('agent.briefDetailFile', { detail }) : t('agent.briefDetailReply'))
  const parts = [rules.join('\n')]
  parts.push(isIsolated ? t('agent.briefWorktree') : t('agent.briefReadOnly'))
  if (isQa) parts.push(t('agent.briefQa', { item: code }))
  if (guidelines) parts.push(guidelines)

  return `\n\n---\n${parts.join('\n\n')}`
}

/**
 * A notification as the PM reads it: each known agent's reply cut to its first line and the file the rest is in.
 * Anything else (a background command's notification, an agent the PM did not start) stays as it was.
 */
export function shortNotices(text: string, known: Readonly<Record<string, AgentRecord>>): string {
  return text.replace(/<task-notification>([\s\S]*?)<\/task-notification>/g, (whole, block: string) => {
    const id = field(block, 'task-id')?.trim()
    const record = id ? known[id] : undefined
    const result = field(block, 'result')
    if (!record || result === undefined) return whole
    const line = firstLine(result)
    const kept = record.detail ? `${line}\n${t('agent.detailLine', { path: record.detail })}` : line

    return whole.replace(/<result>[\s\S]*?<\/result>/, `<result>${kept}</result>`)
  })
}

/**
 * What the person's closing of an ended agent's work items settles it as: once every item it owns is closed (none
 * open) after it ended, done when any is done, dropped when all were dropped. Null while it runs, while one is open,
 * for one that owns none, and when the items were closed before it ended (its own end says more then).
 */
export function settledAgentState(one: AgentRecord, ledger: LedgerItem[]): AgentState | null {
  if (one.state === 'running' || one.endedAt === undefined) return null
  const owned = ledger.filter(item => item.owner === `agent:${one.id}`)
  if (owned.length === 0 || owned.some(item => item.status === 'open')) return null
  if (Math.max(...owned.map(item => item.updatedAt)) < one.endedAt) return null

  return owned.some(item => item.status === 'done') ? 'done' : 'dropped'
}

/** States an agent's work ends in: it needs nothing more, and folds away after a while. */
export function isSettledAgent(state: AgentState): boolean {
  return state === 'done' || state === 'dropped'
}

/** An agent as a short name: its description, else its id. */
export function agentName(record: AgentRecord): string {
  return record.description || record.id
}
