/**
 * The guidelines file, checked after the fact (T-39 2). The lock (hook.ts, PreToolUse) refuses an edit through the
 * writing tools; anything it cannot see (a shell command, a spelling it has no word for) is caught here.
 *
 * One snapshot per file, not per project: the person's own guidelines file serves every project, so a change they
 * ask for in one project is what every other project's sessions are checked against (T-39 QA 1). It is keyed by
 * where the file really is, taken again whenever the person speaks in any project (an edit, clearing or deletion of
 * their own between turns thereby stands), and followed when they ask for a change. After a tool that can write, and
 * when a turn stops, the file the project names now is compared with it; a snapshot from before the person last spoke
 * in this session is not a judgment of this turn and is only taken again. A file no longer named is not looked at,
 * so turning the guidelines off, or naming another file, ends the checking of the old one (T-39 QA 2).
 *
 * Changed without the person having asked about the guidelines this turn: the changed bytes are kept, the file is
 * written back, and the board says so. Snapshots live in the person's own data folder (~/.project-pm/guidelines),
 * never in the repository.
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

/** What a file held when the snapshot was taken: base64 of its bytes, or null when there was no file. */
type Snapshot = { file: string; sha256: string | null; bytes: string | null; at: number }

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

/** Two real paths, as the system compares them: letter case aside on Windows. */
const isSamePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** One snapshot per file, wherever it is named from. */
function snapshotFile(real: string, env: NodeJS.ProcessEnv): string {
  return join(paths(env).home, 'guidelines', 'files', `${sha256(process.platform === 'win32' ? real.toLowerCase() : real).slice(0, 40)}.json`)
}

/** The restores made for a project, for its board. */
function restoresFile(ref: ProjectRef, env: NodeJS.ProcessEnv): string {
  return join(paths(env).home, 'guidelines', `${ref.file}.json`)
}

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

const snapshotOf = (real: string, bytes: Buffer | null, now: number): Snapshot => ({ file: real, sha256: bytes === null ? null : sha256(bytes), bytes: bytes?.toString('base64') ?? null, at: now })

async function writeSnapshot(file: string, snapshot: Snapshot | null): Promise<void> {
  if (snapshot) await writeAtomic(file, `${JSON.stringify(snapshot, null, 2)}\n`)
  else await rm(file, { force: true })
}

/**
 * When the person speaks: what the guidelines file (`real`, where readGuidelines found it) holds now is what they let
 * stand, an edit, clearing or deletion of their own between turns included. A file that cannot be read safely, or is
 * too large to keep, has no snapshot, so nothing is judged against an old one.
 */
export async function keepGuidelines(real: string, env: NodeJS.ProcessEnv, now: number): Promise<void> {
  const file = snapshotFile(real, env)
  await withLock(file, async () => {
    const bytes = await bytesOf(real)
    await writeSnapshot(file, bytes === undefined ? null : snapshotOf(real, bytes, now))
  })
}

/**
 * After a tool that can write, or when a turn stops: the file the project names now (`real`) compared with its
 * snapshot. `since` is when the person last spoke in this session: a snapshot from before then (or none) judges
 * nothing and is only taken again. Asked about (`isAsked`), a change becomes the snapshot every project checks against;
 * not asked about, the changed bytes are kept beside the snapshot, the file is written back, and the restore is
 * recorded for the board. The restore, or null when nothing was put back or reported.
 */
export async function checkGuidelines(ref: ProjectRef, real: string, by: string, isAsked: boolean, since: number, env: NodeJS.ProcessEnv, now: number): Promise<Restore | null> {
  const file = snapshotFile(real, env)

  const restore = await withLock(file, async (): Promise<Restore | null> => {
    const snapshot = await readJsonFile<Snapshot>(file).catch(() => null)
    const bytes = await bytesOf(real)
    if (!snapshot || !isSamePath(snapshot.file, real) || !(snapshot.at >= since)) {
      await writeSnapshot(file, bytes === undefined ? null : snapshotOf(real, bytes, now))

      return null
    }
    const sha = bytes ? sha256(bytes) : null
    if (bytes !== undefined && sha === snapshot.sha256) return null
    if (isAsked) {
      await writeSnapshot(file, bytes === undefined ? null : snapshotOf(real, bytes, now))

      return null
    }
    // Not asked: the changed bytes are kept for the person first, then the file goes back as it was.
    let backup: string | null = null
    if (bytes) {
      backup = join(paths(env).home, 'guidelines', 'changed', `${ref.file}-${new Date(now).toISOString().replace(/[:.]/g, '-')}.txt`)
      await writeAtomic(backup, bytes)
    }
    // Written only into the folder the file was found in, and only while that folder still is where it was: one
    // swapped since for a link (to a share, or to another folder here, whose file of the same name would be
    // overwritten) is not written through; the change is then reported, not undone. A rename puts a plain file in
    // place even where a link to the file itself was left.
    const folder = dirname(real)
    const now_ = await localRealpath(folder).catch(() => null)
    const isRestored = now_ !== null && isSamePath(now_, folder)
    if (isRestored) {
      const target = join(folder, basename(real))
      if (snapshot.bytes === null) await rm(target, { force: true })
      else await writeAtomic(target, Buffer.from(snapshot.bytes, 'base64'))
    }

    return { at: now, file: real, backup, by, isRestored }
  })
  if (!restore) return null
  const list = restoresFile(ref, env)
  await withLock(list, async () => {
    const kept = (await readJsonFile<{ restored?: Restore[] }>(list).catch(() => null)) ?? {}
    await writeAtomic(list, `${JSON.stringify({ restored: [...(kept.restored ?? []), restore].slice(-10) }, null, 2)}\n`)
  })

  return restore
}

/** The restores of the last week, for the board's attention section. */
export async function guidelinesRestores(ref: ProjectRef, env: NodeJS.ProcessEnv, now: number): Promise<Restore[]> {
  const kept = await readJsonFile<{ restored?: Restore[] }>(restoresFile(ref, env)).catch(() => null)

  return (kept?.restored ?? []).filter(r => typeof r.at === 'number' && typeof r.file === 'string' && now - r.at < RESTORE_SHOWN_MS)
}
