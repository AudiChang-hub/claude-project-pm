// The QA core (docs/design/qa.md): a work item's QA verdict, whether it may close, what the board says of it, and what
// a QA agent is told. Portable: it uses no Claude Code engine (`$`) and nothing of the desktop app, only the ledger's
// types and the message table (messages.ts, itself plain data). A host wires it in: here the ledger tool (actions.ts),
// the board (sessions.ts), the pane (view.tsx) and the agent.spawn hook (register.tsx, agents.ts). What counts as an
// owner having delivered is the host's to say: it passes that in.

import type { LedgerItem, QaRecord } from '../types'
import { t } from './messages'

/** How long a line's text and its note or reason run before they are cut (as on the board). */
const TEXT = 100
const NOTE = 60
const QUOTE = 120

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const codeOf = (id: number) => `T-${String(id).padStart(2, '0')}`

/**
 * Whether two ids name the same owner or checker: compared trimmed and in any case, so `LOCAL_OPEN` or ` agent:A1 `
 * is still the owner. New owners are written trimmed; items written before may not be, and are found by this all the
 * same.
 */
export function isSameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Whether an owner id names an agent (`agent:<agent id>`), however it is spaced or cased. */
export function isAgentId(id: string | null | undefined): boolean {
  return !!id && /^\s*agent:/i.test(id)
}

/** What an item shows of its QA: its verdict; else, while it is open and its owner has delivered, awaiting. */
export type QaShown = QaRecord['result'] | 'awaiting'

export function qaShown(item: LedgerItem, isOwnerDelivered: boolean): QaShown | null {
  if (item.qa) return item.qa.result

  return item.status === 'open' && isOwnerDelivered ? 'awaiting' : null
}

/** An item's QA in words: passed or failed and by whom, skipped and why, or awaiting. */
export function qaText(item: LedgerItem, shown: QaShown, isWhole = false, who: (id: string) => string = id => id): string {
  if (shown === 'awaiting' || !item.qa) return t('qa.awaiting')
  if (shown === 'skipped') return t('qa.skipped', { note: isWhole ? item.qa.note : clip(item.qa.note, NOTE) })

  const commit = item.qa.commit ? t('qa.commit', { sha: item.qa.commit }) : ''

  return t(shown === 'pass' ? 'qa.pass' : 'qa.fail', { by: who(item.qa.by), commit })
}

/**
 * The QA verdict an update asks to record, or why it cannot be (the update then changes nothing); null when it records
 * none. `input` holds `qa` (pass, fail, skip), `qa_by` and `qa_note`. Pass and fail name who checked; skip gives its
 * reason and is `self`'s word unless it names someone. Whoever checked is never the item's owner. `head`, the project's
 * HEAD commit when the verdict was given, is kept with it to trace what was checked.
 */
export function qaOfInput(input: Record<string, unknown>, owner: string | null, self: string, now: number, code: string, head: string | null = null): { qa: QaRecord } | { error: string } | null {
  if (input.qa === undefined) return null
  const verdict = input.qa
  if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'skip') return { error: t('ledger.qaBad') }
  const by = typeof input.qa_by === 'string' ? input.qa_by.trim() : ''
  const note = typeof input.qa_note === 'string' ? input.qa_note.trim() : ''
  if (verdict === 'skip' && !note) return { error: t('ledger.qaNeedsNote') }
  if (verdict !== 'skip' && !by) return { error: t('ledger.qaNeedsBy') }
  const who = by || self
  if (isSameId(who, owner)) return { error: t('ledger.qaByOwner', { code, owner: owner!.trim() }) }

  return { qa: { result: verdict === 'skip' ? 'skipped' : verdict, by: who, at: now, note, ...(head ? { commit: head } : {}) } }
}

/** Why an item's QA keeps it from closing, or null when it has passed (or was skipped for a reason) by someone not its owner. */
export function qaBlocker(qa: QaRecord | undefined, owner: string | null, code: string): string | null {
  if (!qa) return t('ledger.qaNone', { code })
  if (isSameId(qa.by, owner)) return t('ledger.qaByOwnerClose', { code, by: qa.by.trim() })
  if (qa.result === 'fail') return t('ledger.qaFailed', { code, note: qa.note || t('qa.noNote') })
  if (qa.result === 'skipped' && !qa.note.trim()) return t('ledger.qaNeedsNote')

  return null
}

/**
 * The QA part of an update to `item`. A verdict that cannot be recorded is an `error`: the update changes nothing.
 * Otherwise `qa` is the verdict the item keeps: the one recorded now (`isRecorded`), else the one it had, unless the
 * update hands the item to another owner or reopens it after it closed (that verdict was for other work, and goes).
 * `refusal` says why a close is refused for its QA, or is null. A refused close keeps a verdict recorded with it: only
 * the status stays. `owner` is the owner after the update; `isClosing` whether it closes the item (done, and not
 * forced with a note); `head` the project's HEAD commit, kept with a verdict recorded now. The host runs its own
 * checks on the owner only when this refuses nothing.
 */
export function qaUpdate(
  item: LedgerItem,
  input: Record<string, unknown>,
  owner: string | null,
  self: string,
  now: number,
  isClosing: boolean,
  head: string | null = null,
): { error: string } | { qa: QaRecord | undefined; isRecorded: boolean; refusal: string | null } {
  const code = codeOf(item.id)
  const verdict = qaOfInput(input, owner, self, now, code, head)
  if (verdict && 'error' in verdict) return { error: verdict.error }
  // Handed to another owner in the same update: the owner it had may not check its own work either.
  if (verdict && isSameId(verdict.qa.by, item.owner)) return { error: t('ledger.qaByOwner', { code, owner: item.owner!.trim() }) }
  const isSameOwner = owner?.trim() ? isSameId(owner, item.owner) : !item.owner?.trim()
  const isReopened = input.status === 'open' && item.status !== 'open'
  const qa = verdict?.qa ?? (isSameOwner && !isReopened ? item.qa : undefined)

  return { qa, isRecorded: !!verdict, refusal: isClosing ? qaBlocker(qa, owner, code) : null }
}

/** A refused close beside a verdict recorded in the same update: the verdict is kept, and the answer says both. */
export function qaKeptText(refusal: string): string {
  return t('ledger.qaKept', { reason: refusal })
}

/**
 * The board's "Needs attention" lines for QA: each open item awaiting it (its owner has delivered, there is no verdict)
 * and each that failed it. `isDelivered` and `ownerText` are the host's: whether an owner has handed its work over, and
 * how an owner reads.
 */
export function qaAttention(items: LedgerItem[], isDelivered: (owner: string | null) => boolean, ownerText: (owner: string | null) => string, who: (id: string) => string = id => id): string[] {
  return items
    .filter(item => item.status === 'open')
    .flatMap(item => {
      const shown = qaShown(item, isDelivered(item.owner))
      const fields = { code: codeOf(item.id), text: clip(item.text, TEXT) }
      if (shown === 'awaiting') return [t('board.attention.qaAwaiting', { ...fields, owner: ownerText(item.owner) })]
      if (shown === 'fail') return [t('board.attention.qaFailed', { ...fields, note: clip(item.qa?.note || t('qa.noNote'), QUOTE), by: item.qa?.by ? who(item.qa.by) : '' })]

      return []
    })
}

/**
 * A QA agent's description: the work item's code, then QA, then nothing, a space, punctuation or a dash and a round
 * number (`T-12 QA`, `T-12 QA: abc`, `T-31 QA（第二次）`, `T-31 QA(2nd)`, `T-31 QA-2`, `T-31 QA、複驗`); not a longer
 * word, dashed or not (`T-12 QAX`, `T-13 QA-free`, `T-12 QA-less`).
 */
export function isQaDescription(description: string): boolean {
  return /^\s*T-\d+\s+QA(?=$|[\s:：,，.。（(、]|-\d)/i.test(description)
}

/** What a QA agent is told for work item `code`: how its reply starts (pass or fail), and the checklist. */
export function qaBrief(code: string): { reply: string; checklist: string } {
  return { reply: t('agent.briefQaReply'), checklist: t('agent.briefQa', { item: code }) }
}

// ── The open work items at a glance: each under one kind, so the counts add up (T-42) ──

/** What an open work item most needs, first first: a failed QA, then QA due, then an owner; else it is on track. */
export type OpenKind = 'qaFailed' | 'qaAwaiting' | 'unassigned' | 'normal'

export const OPEN_KINDS: readonly OpenKind[] = ['qaFailed', 'qaAwaiting', 'unassigned', 'normal']

/** The one kind an open item counts under: the first of OPEN_KINDS it is, so an item is never counted twice. */
export function openKindOf(item: LedgerItem, qa: QaShown | null): OpenKind {
  if (qa === 'fail') return 'qaFailed'
  if (qa === 'awaiting') return 'qaAwaiting'
  if (!item.owner?.trim()) return 'unassigned'

  return 'normal'
}

/** `prefix` is the lead with what comes before the parts ("4 open: "), for a view that colors each part itself. */
export type OpenBreakdown = { total: number; parts: { kind: OpenKind; n: number; text: string }[]; lead: string; prefix: string; joiner: string; text: string }

/**
 * The open items counted by kind, in words the pane, the text board and the web board all say alike: "4 open: 1 failed
 * QA · 1 awaiting QA · 1 unassigned · 1 on track". Kinds with none are left out; the parts always add up to the total.
 */
export function openBreakdown(items: { item: LedgerItem; qa: QaShown | null }[]): OpenBreakdown {
  const open = items.filter(({ item }) => item.status === 'open')
  const counts = new Map<OpenKind, number>(OPEN_KINDS.map(kind => [kind, 0]))
  for (const { item, qa } of open) {
    const kind = openKindOf(item, qa)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const parts = OPEN_KINDS.filter(kind => (counts.get(kind) ?? 0) > 0).map(kind => ({ kind, n: counts.get(kind)!, text: t(`items.${kind}`, { n: counts.get(kind)! }) }))
  const lead = t('items.open', { n: open.length })

  const prefix = t('items.summary', { lead, parts: '' })
  const joiner = t('items.joiner')

  return { total: open.length, parts, lead, prefix, joiner, text: parts.length ? `${prefix}${parts.map(p => p.text).join(joiner)}` : lead }
}
