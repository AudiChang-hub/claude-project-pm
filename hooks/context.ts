// Context size and quota (T-48, M8): what each session's context holds, what waking it costs, when the PM compacts
// itself and when a session hands over. Pure functions: the hooks (register.tsx) and the board (sessions.ts) use them.

import type { Session, Track } from '../types'

import { getLang, t } from './messages'

/** A session hands over at this context (tokens): about where the next turns start to cost more than a fresh start. */
export const HANDOFF_AT = 200_000
/** The PM compacts itself at this context (tokens). */
export const COMPACT_AT = 300_000
/** The thresholds accepted: 100k is the lowest compaction window Claude Code itself takes. */
export const CONTEXT_MIN = 100_000
export const CONTEXT_MAX = 1_000_000
/** The prompt cache lives an hour: a session idle longer is written into the cache again, whole, when woken. */
export const CACHE_MS = 60 * 60_000
/** Waking after the cache expired: context × 1.3 (T-30: a 650k context woke at about 840k input-equivalent tokens). */
export const WAKE_COLD = 1.3
/** Waking within the hour: the context is read from the cache, at a tenth of its price. */
export const WAKE_WARM = 0.1
/** The PM's SendMessage to a session whose wake costs this much or more is held once, for the PM to weigh. */
export const WAKE_ASK = 100_000
/** The same message to the same session again within this time goes through. */
export const RESEND_MS = 10 * 60_000
/** A compaction that failed is not tried again until the context has grown by this much. */
export const RETRY_AFTER = 100_000
/** How long after a turn ends the PM's mod compacts: by then the session is between turns. */
export const COMPACT_DELAY_MS = 2_000

export type Thresholds = { handoff: number; compact: number }
export const DEFAULT_THRESHOLDS: Thresholds = { handoff: HANDOFF_AT, compact: COMPACT_AT }

/** A context size and when it was measured, ms. */
export type ContextMark = { tokens: number; at: number }

/** A request's usage as `turn.complete` and the transcript give it. */
export type UsageLike = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null | undefined

/** The context a request read: its input, cache reads and cache writes (the same as `$.session.usage().context.tokens`). */
export function usageTokens(usage: UsageLike): number | null {
  if (!usage || typeof usage !== 'object') return null
  const parts = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
  if (!parts.some(n => typeof n === 'number' && Number.isFinite(n))) return null
  const sum = parts.reduce<number>((a, n) => a + (typeof n === 'number' && Number.isFinite(n) ? n : 0), 0)

  return sum > 0 ? sum : null
}

/** A token count as people read it: 21.3 萬 in Chinese (one decimal), 213k in English (whole). */
export function tokensText(tokens: number): string {
  if (getLang() === 'zh-TW') return `${(tokens / 10_000).toFixed(1)} 萬`

  return `${Math.round(tokens / 1_000)}k`
}

/** What waking a session costs, in input-equivalent tokens: compacted, the compacted size stands for its context. */
export function wakeCost(tokens: number, idleMs: number, compactedTo?: number): number {
  const size = typeof compactedTo === 'number' && compactedTo > 0 ? Math.min(compactedTo, tokens) : tokens

  return Math.round(size * (idleMs > CACHE_MS ? WAKE_COLD : WAKE_WARM))
}

/**
 * A session's context: the desktop app's live figure (get_usage, running sessions only) when it is newer than the
 * session's own record, else the record its mod wrote at its last turn; none from a mod too old to write one.
 */
export function contextOf(track: Track | undefined, live: ContextMark | undefined): ContextMark | null {
  const own = track?.context && track.context.tokens > 0 ? track.context : null
  if (live && live.tokens > 0 && (!own || live.at > own.at)) return live

  return own
}

/** How long a session has been idle, ms: since its last activity (the app's) or its last turn (its own), whichever is later. */
export function idleOf(one: Pick<Session, 'lastActivityAt'>, track: Track | undefined, now: number): number {
  const at = Math.max(Date.parse(one.lastActivityAt) || 0, track?.turnAt ?? 0)

  return at > 0 ? Math.max(0, now - at) : 0
}

/** An idle time as the card says it: 5 分鐘 / 2 小時 / 3 天 (5m, 2h, 3d). */
export function idleText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return t('context.minutes', { n: Math.max(1, min) })
  const hours = Math.round(min / 60)
  if (hours < 24) return t('context.hours', { n: hours })

  return t('context.days', { n: Math.round(hours / 24) })
}

/** The card's small line: "上下文 21.3 萬・閒置 2 小時・喚醒約 27.7 萬", or "上下文 21.3 萬・執行中"; null with no figure. */
export function contextLine(one: Pick<Session, 'isRunning' | 'lastActivityAt'>, track: Track | undefined, live: ContextMark | undefined, now: number): string | null {
  const mark = contextOf(track, live)
  if (!mark) return null
  const size = t('context.size', { tokens: tokensText(mark.tokens) })
  if (one.isRunning) return `${size}${t('context.joiner')}${t('context.running')}`
  const idle = idleOf(one, track, now)
  const wake = wakeCost(mark.tokens, idle, track?.compactedTo)

  return [size, t('context.idle', { time: idleText(idle) }), t('context.wake', { tokens: tokensText(wake) })].join(t('context.joiner'))
}

/** The last compaction, as the PM's card says it: "已自動整理對話：31.0 萬 → 2.1 萬". */
export function compactedLine(track: Track | undefined): string | null {
  const done = track?.compacted
  if (!done || !(done.before > 0) || !(done.after > 0)) return null

  return t('context.compacted', { before: tokensText(done.before), after: tokensText(done.after) })
}

/** "200k", "200,000", "0.2m", "20萬" → tokens; null for anything else. */
export function tokensOf(word: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(k|m|萬)?$/i.exec(word.trim().replace(/,/g, ''))
  if (!m) return null
  const unit = (m[2] ?? '').toLowerCase()
  const n = Number(m[1]) * (unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : unit === '萬' ? 10_000 : 1)

  return Number.isFinite(n) ? Math.round(n) : null
}

/** `/pm context` arguments: none shows them, `default` resets them, `<handoff> <compact>` sets them. */
export function parseThresholds(args: string): { show: true } | { reset: true } | { set: Thresholds } | { error: true } {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { show: true }
  if (words.length === 1 && /^(default|reset|預設|恢復)$/i.test(words[0])) return { reset: true }
  if (words.length !== 2) return { error: true }
  const [handoff, compact] = words.map(tokensOf)
  if (handoff === null || compact === null) return { error: true }
  if ([handoff, compact].some(n => n < CONTEXT_MIN || n > CONTEXT_MAX)) return { error: true }

  return { set: { handoff, compact } }
}

/** Thresholds as kept (the mod's `context` option, the core's config): anything unreadable or out of range is the default. */
export function thresholdsOf(value: unknown): Thresholds {
  if (typeof value === 'string') {
    const parsed = parseThresholds(value)

    return 'set' in parsed ? parsed.set : DEFAULT_THRESHOLDS
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const ok = (n: unknown) => typeof n === 'number' && n >= CONTEXT_MIN && n <= CONTEXT_MAX
    if (ok(o.handoff) && ok(o.compact)) return { handoff: o.handoff as number, compact: o.compact as number }
  }

  return DEFAULT_THRESHOLDS
}

/** The thresholds as the option keeps them, and as /pm context shows them: "200k 300k". */
export function thresholdsWords(thresholds: Thresholds): string {
  return `${Math.round(thresholds.handoff / 1_000)}k ${Math.round(thresholds.compact / 1_000)}k`
}

/**
 * Whether the PM compacts itself after this turn: its context at or past the threshold, and not right after a failed
 * try (another only once the context has grown by RETRY_AFTER).
 */
export function shouldCompact(tokens: number, threshold: number, failedAt: number | undefined): boolean {
  if (tokens < threshold) return false

  return failedAt === undefined || tokens >= failedAt + RETRY_AFTER
}

/**
 * Whether a session is past the hand-over threshold with work left: its context (a compaction since, the built-in
 * idle one too, counts with its smaller size) at or past it, and steps left on its task list or a work item it owns.
 */
export function needsHandoff(mark: ContextMark | null, track: Track | undefined, threshold: number, hasWork: boolean): boolean {
  if (!mark || !hasWork) return false
  const compacted = track?.compactedTo
  const isCompactedSince = typeof compacted === 'number' && (track?.compactedAt ?? 0) >= mark.at
  const tokens = isCompactedSince ? compacted : mark.tokens

  return tokens >= threshold
}

/** The key the PM's held SendMessage is remembered by: the same message to the same session. */
export function sendKey(to: string, message: string): string {
  return `${to.trim()}\n${message.trim()}`
}

/**
 * Whether the PM's SendMessage to an idle session is held, once, for the PM to weigh what waking it costs: only a
 * session idle past the cache with a wake cost of WAKE_ASK or more, and not the same message sent again within RESEND_MS.
 */
export function holdsSend(cost: number, idleMs: number, heldAt: number | undefined, now: number): boolean {
  if (idleMs <= CACHE_MS || cost < WAKE_ASK) return false

  return heldAt === undefined || now - heldAt > RESEND_MS
}

/** The JSON of a `.claude/settings.local.json` with `autoCompactWindow` set, every other byte as it was (the button's fallback). */
export function withAutoCompact(text: string | null, window: number): string | null {
  if (text === null || text.trim() === '') return `{\n  "autoCompactWindow": ${window}\n}\n`
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const existing = /("autoCompactWindow"\s*:\s*)("[^"]*"|-?\d+(?:\.\d+)?)/
  if ('autoCompactWindow' in parsed) return existing.test(text) ? text.replace(existing, `$1${window}`) : null
  const open = text.indexOf('{')
  const isEmpty = Object.keys(parsed).length === 0
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '  '

  return isEmpty
    ? `${text.slice(0, open + 1)}\n${indent}"autoCompactWindow": ${window}\n${text.slice(open + 1).replace(/^\s*/, '')}`
    : `${text.slice(0, open + 1)}\n${indent}"autoCompactWindow": ${window},${text.slice(open + 1).replace(/^[ \t]*(?=\r?\n)/, '')}`
}

/** The settings text with `autoCompactWindow` as it was before the button: the old value back, or the key gone. */
export function withoutAutoCompact(text: string, previous: number | string | null): string {
  const existing = /("autoCompactWindow"\s*:\s*)("[^"]*"|-?\d+(?:\.\d+)?)/
  if (previous !== null) return text.replace(existing, `$1${JSON.stringify(previous)}`)

  // The button writes the key first, with a comma after it when other keys follow.
  return text.replace(/\r?\n[ \t]*"autoCompactWindow"\s*:\s*(?:"[^"]*"|-?\d+(?:\.\d+)?),?/, '')
}
