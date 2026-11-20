/**
 * The guidelines file, checked after the fact (T-39 2). The lock (hook.ts, PreToolUse) refuses an edit through the
 * writing tools; anything it cannot see (a shell command, a spelling it has no word for) is caught here: after every
 * tool that can write, the file is compared with the snapshot taken when the person last spoke. Changed without the
 * person having asked about the guidelines this turn, it is put back, the changed text kept, and the board says so.
 * Changed with their asking, the snapshot follows it.
 *
 * The snapshot lives in the person's own data folder (~/.project-pm/guidelines), never in the repository.
 */
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { localRealpath } from './localpath'
import type { ProjectRef } from './project'
import { paths, readJsonFile, withLock, writeAtomic } from './store'

/** Larger than this, a file is not a guidelines file to keep a copy of. */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024

/** How long the board lists a restore. */
export const RESTORE_SHOWN_MS = 7 * 24 * 60 * 60 * 1000

/** The tools after which the file is compared: every one that can write a file (the shells too). */
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'])

export type Restore = { at: number; file: string; backup: string | null; by: string; isRestored: boolean }

type Kept = {
  /** Where the file really is (localRealpath), and what it held: base64 of its bytes, or null when there was none. */
  snapshot?: { file: string; sha256: string | null; bytes: string | null; at: number }
  restored?: Restore[]
}

function keptFile(ref: ProjectRef, env: NodeJS.ProcessEnv): string {
  return join(paths(env).home, 'guidelines', `${ref.file}.json`)
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** The file's bytes now: null when it is not there, undefined when it cannot be read safely or is too large to keep. */
async function bytesOf(file: string): Promise<Buffer | null | undefined> {
  try {
    // The path may have become a link since (to a share, say): checked as any other before it is read.
    const real = await localRealpath(file)
    if (!real) return null
    const bytes = await readFile(real)

    return bytes.length <= MAX_SNAPSHOT_BYTES ? bytes : undefined
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined
  }
}

/**
 * When the person speaks: what the guidelines file holds now is what they let stand (an edit of their own between
 * turns included). `real` is where readGuidelines found it.
 */
export async function keepGuidelines(ref: ProjectRef, real: string, env: NodeJS.ProcessEnv, now: number): Promise<void> {
  const bytes = await bytesOf(real)
  if (bytes === undefined) return
  const file = keptFile(ref, env)
  await withLock(file, async () => {
    const kept = (await readJsonFile<Kept>(file).catch(() => null)) ?? {}
    const sha = bytes === null ? null : sha256(bytes)
    if (kept.snapshot?.file === real && kept.snapshot.sha256 === sha) return
    await writeAtomic(file, `${JSON.stringify({ ...kept, snapshot: { file: real, sha256: sha, bytes: bytes?.toString('base64') ?? null, at: now } }, null, 2)}\n`)
  })
}

/**
 * After a tool that can write: the file compared with the snapshot. Asked about (`isAsked`), a change is kept as the
 * new snapshot; not asked about, the file is put back as the snapshot has it, the changed text saved beside the
 * snapshot, and the restore recorded for the board. The restore, or null when nothing changed.
 */
export async function checkGuidelines(ref: ProjectRef, by: string, isAsked: boolean, env: NodeJS.ProcessEnv, now: number): Promise<Restore | null> {
  const file = keptFile(ref, env)

  return withLock(file, async () => {
    const kept = (await readJsonFile<Kept>(file).catch(() => null)) ?? {}
    const snapshot = kept.snapshot
    if (!snapshot) return null
    const bytes = await bytesOf(snapshot.file)
    const sha = bytes ? sha256(bytes) : null
    if (bytes !== undefined && sha === snapshot.sha256) return null
    if (isAsked) {
      if (bytes !== undefined) await writeAtomic(file, `${JSON.stringify({ ...kept, snapshot: { ...snapshot, sha256: sha, bytes: bytes?.toString('base64') ?? null, at: now } }, null, 2)}\n`)

      return null
    }
    // Not asked: the changed text is kept for the person, then the file goes back as it was. A rename puts a plain file
    // in place even where a link was left; a file that was not there before goes again.
    let backup: string | null = null
    if (bytes) {
      backup = join(paths(env).home, 'guidelines', 'changed', `${ref.file}-${new Date(now).toISOString().replace(/[:.]/g, '-')}.txt`)
      await writeAtomic(backup, bytes)
    }
    // Written only into the folder where it really is, checked as any path: a folder swapped for a link to a share
    // since is not written through (the change is then reported, not undone).
    const folder = await localRealpath(dirname(snapshot.file)).catch(() => null)
    const isRestored = folder !== null
    if (folder !== null) {
      const target = join(folder, basename(snapshot.file))
      if (snapshot.bytes === null) await rm(target, { force: true })
      else await writeAtomic(target, Buffer.from(snapshot.bytes, 'base64'))
    }
    const restore: Restore = { at: now, file: snapshot.file, backup, by, isRestored }
    await writeAtomic(file, `${JSON.stringify({ ...kept, restored: [...(kept.restored ?? []), restore].slice(-10) }, null, 2)}\n`)

    return restore
  })
}

/** The restores of the last week, for the board's attention section. */
export async function guidelinesRestores(ref: ProjectRef, env: NodeJS.ProcessEnv, now: number): Promise<Restore[]> {
  const kept = await readJsonFile<Kept>(keptFile(ref, env)).catch(() => null)

  return (kept?.restored ?? []).filter(r => typeof r.at === 'number' && typeof r.file === 'string' && now - r.at < RESTORE_SHOWN_MS)
}
