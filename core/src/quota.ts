/**
 * The context a Claude Code session's last main-loop request read, from the tail of its transcript (T-48 A'): the CLI
 * has no mod to record it, so the Stop hook reads it here. Read only; nothing is kept but the figure.
 */

import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { thresholdsOf, usageTokens } from '../../hooks/context'
import type { Thresholds, UsageLike } from '../../hooks/context'
import { dataHome } from './host'
import { readJsonFile } from './store'

/** The hand-over and compaction thresholds: `context` in the person's ~/.project-pm/config.json (`{ handoff, compact }` or "200k 300k"), else the defaults. */
export async function coreThresholds(env: NodeJS.ProcessEnv = process.env): Promise<Thresholds> {
  const config = await readJsonFile<{ context?: unknown }>(join(dataHome(env), 'config.json')).catch(() => null)

  return thresholdsOf(config?.context)
}

/** How much of the transcript's end is read: the last request is in the last few lines. */
export const TAIL_BYTES = 256 * 1024

/**
 * The context of the last main-loop assistant line in a transcript's tail: subagents' lines (isSidechain) are skipped,
 * as are a partial last line, a line cut at the tail's start, and lines with no usage. Null when none has one.
 */
export function contextOfTail(tail: string): number | null {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    let row: { type?: unknown; isSidechain?: unknown; message?: { usage?: UsageLike } }
    try {
      row = JSON.parse(line) as typeof row
    } catch {
      continue
    }
    if (row.type !== 'assistant' || row.isSidechain === true) continue
    const tokens = usageTokens(row.message?.usage)
    if (tokens !== null) return tokens
  }

  return null
}

/** The context the transcript at `path` last read, or null when it cannot be read or holds none. */
export async function transcriptContext(path: string | undefined): Promise<number | null> {
  if (!path) return null
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)

    return contextOfTail(buffer.toString('utf8'))
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
