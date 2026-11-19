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

/** What an item shows of its QA: its verdict; else, while it is open and its owner has delivered, awaiting. */
export type QaShown = QaRecord['result'] | 'awaiting'

export function qaShown(item: LedgerItem, isOwnerDelivered: boolean): QaShown | null {
  if (item.qa) return item.qa.result

  return item.status === 'open' && isOwnerDelivered ? 'awaiting' : null
}

/** An item's QA in words: passed or failed and by whom, skipped and why, or awaiting. */
export function qaText(item: LedgerItem, shown: QaShown, isWhole = false): string {
  if (shown === 'awaiting' || !item.qa) return t('qa.awaiting')
  if (shown === 'skipped') return t('qa.skipped', { note: isWhole ? item.qa.note : clip(item.qa.note, NOTE) })

  return t(shown === 'pass' ? 'qa.pass' : 'qa.fail', { by: item.qa.by })
}

/**
 * The QA verdict an update asks to record, or why it cannot be (the update then changes nothing); null when it records
 * none. `input` holds `qa` (pass, fail, skip), `qa_by` and `qa_note`. Pass and fail name who checked; skip gives its
 * reason and is `self`'s word unless it names someone. Whoever checked is never the item's owner.
 */
export function qaOfInput(input: Record<string, unknown>, owner: string | null, self: string, now: number, code: string): { qa: QaRecord } | { error: string } | null {
  if (input.qa === undefined) return null
  const verdict = input.qa
  if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'skip') return { error: t('ledger.qaBad') }
  const by = typeof input.qa_by === 'string' ? input.qa_by.trim() : ''
  const note = typeof input.qa_note === 'string' ? input.qa_note.trim() : ''
  if (verdict === 'skip' && !note) return { error: t('ledger.qaNeedsNote') }
  if (verdict !== 'skip' && !by) return { error: t('ledger.qaNeedsBy') }
  const who = by || self
  if (owner && who === owner) return { error: t('ledger.qaByOwner', { code, owner }) }

  return { qa: { result: verdict === 'skip' ? 'skipped' : verdict, by: who, at: now, note } }
}

/** Why an item's QA keeps it from closing, or null when it has passed (or was skipped for a reason) by someone not its owner. */
export function qaBlocker(qa: QaRecord | undefined, owner: string | null, code: string): string | null {
  if (!qa) return t('ledger.qaNone', { code })
  if (owner && qa.by === owner) return t('ledger.qaByOwnerClose', { code, by: qa.by })
  if (qa.result === 'fail') return t('ledger.qaFailed', { code, note: qa.note || t('qa.noNote') })
  if (qa.result === 'skipped' && !qa.note.trim()) return t('ledger.qaNeedsNote')

  return null
}

/**
 * The QA part of an update to `item`: the verdict it keeps (the one recorded now, else the one it had), or why the
 * update is refused. `owner` is the owner after the update; `isClosing` whether it closes the item (done, and not
 * forced with a note). The host runs its own checks on the owner only once this lets the update through.
 */
export function qaUpdate(item: LedgerItem, input: Record<string, unknown>, owner: string | null, self: string, now: number, isClosing: boolean): { refusal: string } | { qa: QaRecord | undefined } {
  const code = codeOf(item.id)
  const verdict = qaOfInput(input, owner, self, now, code)
  if (verdict && 'error' in verdict) return { refusal: verdict.error }
  const qa = verdict?.qa ?? item.qa
  const blocker = isClosing ? qaBlocker(qa, owner, code) : null

  return blocker ? { refusal: blocker } : { qa }
}

/**
 * The board's "Needs attention" lines for QA: each open item awaiting it (its owner has delivered, there is no verdict)
 * and each that failed it. `isDelivered` and `ownerText` are the host's: whether an owner has handed its work over, and
 * how an owner reads.
 */
export function qaAttention(items: LedgerItem[], isDelivered: (owner: string | null) => boolean, ownerText: (owner: string | null) => string): string[] {
  return items
    .filter(item => item.status === 'open')
    .flatMap(item => {
      const shown = qaShown(item, isDelivered(item.owner))
      const fields = { code: codeOf(item.id), text: clip(item.text, TEXT) }
      if (shown === 'awaiting') return [t('board.attention.qaAwaiting', { ...fields, owner: ownerText(item.owner) })]
      if (shown === 'fail') return [t('board.attention.qaFailed', { ...fields, note: clip(item.qa?.note || t('qa.noNote'), QUOTE), by: item.qa?.by ?? '' })]

      return []
    })
}

/** A QA agent's description: the work item's code, then QA as a word of its own (`T-12 QA`, `T-12 QA: abc`; not `T-12 QA-free`). */
export function isQaDescription(description: string): boolean {
  return /^\s*T-\d+\s+QA(?=$|[\s:：,，.。])/i.test(description)
}

/** What a QA agent is told for work item `code`: how its reply starts (pass or fail), and the checklist. */
export function qaBrief(code: string): { reply: string; checklist: string } {
  return { reply: t('agent.briefQaReply'), checklist: t('agent.briefQa', { item: code }) }
}
