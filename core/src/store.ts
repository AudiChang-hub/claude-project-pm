/**
 * The core's files (docs/design/v1-core.md 1.3, 2.2, 2.4). Every write locks the file, reads it again, changes it,
 * writes a temporary file and renames it over the old one, so the many core processes of one machine (one per AI
 * session) never lose each other's writes. While the desktop mod (v0.9) still reads and writes its own folder
 * (migration E1), a project is read from the core's folder first, the mod's folder second, and written to both.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { emptyProject } from '../../hooks/sessions'
import type { Track } from '../../types'
import { actorFile, dataHome, legacyHome } from './host'
import { plainLocalPath } from './localpath'
import { mergeLegacy } from './merge'
import { ct } from './messages'
import type { ProjectRef } from './project'
import { projectRefOf } from './project'
import type { Actor, CoreProject } from './types'

/** A lock older than this was left by a process that died: it may be taken. */
export const STALE_LOCK_MS = 10_000
/** How long a write waits for a lock before it gives up. */
const LOCK_WAIT_MS = 15_000

/** The data could not be read (not JSON) or written: the core itself failed, not the caller (isError). */
export class StoreError extends Error {}

export function paths(env: NodeJS.ProcessEnv = process.env) {
  const home = dataHome(env)
  const legacy = legacyHome(env)

  return {
    home,
    legacy,
    project: (ref: ProjectRef) => join(home, 'projects', `${ref.file}.json`),
    legacyProject: (ref: ProjectRef) => join(legacy, 'projects', `${ref.file}.json`),
    actors: join(home, 'actors'),
    actor: (id: string) => join(home, 'actors', `${actorFile(id)}.json`),
    legacySession: (id: string) => join(legacy, 'sessions', `${id}.json`),
    report: (id: string, at: number) => join(home, 'reports', actorFile(id), `${new Date(at).toISOString().replace(/[:.]/g, '-')}.md`),
    server: join(home, 'server.json'),
    installLog: join(home, 'install-log.json'),
    bin: join(home, 'bin'),
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Runs `fn` holding `<file>.lock`, made with the exclusive flag; a lock older than STALE_LOCK_MS is cleared. */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`
  await mkdir(dirname(file), { recursive: true })
  const started = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, 'wx')
      await handle.writeFile(`${process.pid}\n`)
      await handle.close()
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // Windows answers EPERM (or EACCES, EBUSY) while another process is deleting the lock: it is still held.
      const isHeld = code === 'EEXIST' || code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!isHeld || Date.now() - started > LOCK_WAIT_MS) throw new StoreError(ct('error.cannotWrite', { reason: (err as Error).message }))
      try {
        const age = Date.now() - (await stat(lock)).mtimeMs
        if (age > STALE_LOCK_MS) await unlink(lock).catch(() => {})
      } catch {
        // Gone between the open and the stat: try again at once.
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new StoreError(ct('error.cannotWrite', { reason: `${lock} is held` }))
      await sleep(5 + Math.floor(Math.random() * Math.min(40, 5 + attempt * 2)))
    }
  }
  try {
    return await fn()
  } finally {
    await unlink(lock).catch(() => {})
  }
}

/** Writes `text` to a temporary file beside `file` and renames it over `file`: a reader sees the old file or the new one. */
export async function writeAtomic(file: string, text: string | Uint8Array) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, text, 'utf8')
    // Windows refuses a rename over a file another process has open for a moment: try a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, file)
        break
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (attempt >= 20 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err
        await sleep(10 + attempt * 5)
      }
    }
  } catch (err) {
    await unlink(temp).catch(() => {})
    throw new StoreError(ct('error.cannotWrite', { reason: (err as Error).message }))
  }
}

/** A JSON file, or null when there is none; a file that is not JSON is a StoreError (it is never overwritten). */
export async function readJsonFile<T>(file: string): Promise<T | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new StoreError(ct('error.corrupt', { file, reason: (err as Error).message }))
  }
  try {
    return JSON.parse(text.replace(/^﻿/, '')) as T
  } catch (err) {
    throw new StoreError(ct('error.corrupt', { file, reason: (err as Error).message }))
  }
}

async function mtimeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs
  } catch {
    return 0
  }
}

/** A project file with every field it must have, whatever an old or partial file left out. */
function filled(ref: ProjectRef, file: Partial<CoreProject> | null): CoreProject {
  const base = emptyProject(ref.key, ref.name, ref.path) as CoreProject

  return file ? { ...base, ...file, ledger: Array.isArray(file.ledger) ? file.ledger : [] } : base
}

export { mergeLegacy }

/** The project's file: the core's own, merged with the mod's (E1); the mod's alone while the core has none. */
export async function loadProject(ref: ProjectRef, env: NodeJS.ProcessEnv = process.env): Promise<CoreProject> {
  const p = paths(env)
  const coreFile = p.project(ref)
  const legacyFile = p.legacyProject(ref)
  const core = await readJsonFile<CoreProject>(coreFile)
  const legacy = await readLegacy(legacyFile)
  if (!core) return filled(ref, legacy)
  if (!legacy) return filled(ref, core)

  return mergeLegacy(filled(ref, core), filled(ref, legacy), (await mtimeOf(legacyFile)) > (await mtimeOf(coreFile)))
}

/**
 * Every project the core keeps: the core's projects and the mod's (a desktop user's ledger may be in the mod's folder
 * alone, T-47), each read as the board reads it, both merged (loadProject). Read only: nothing is written here.
 */
export async function keptProjects(env: NodeJS.ProcessEnv = process.env): Promise<CoreProject[]> {
  const p = paths(env)
  const found = new Map<string, string>()
  for (const dir of [join(p.home, 'projects'), join(p.legacy, 'projects')]) {
    const names = (await readdir(dir).catch(() => [] as string[])).filter(name => name.endsWith('.json'))
    for (const name of names) {
      const one = await readJsonFile<CoreProject>(join(dir, name)).catch(() => null)
      // A folder on this computer's own disks only, as everywhere a path is taken in.
      const path = typeof one?.path === 'string' ? plainLocalPath(one.path, one.path) : null
      if (!path || typeof one?.key !== 'string') continue
      const ref = projectRefOf(path)
      if (!found.has(ref.key)) found.set(ref.key, path)
    }
  }
  const kept: CoreProject[] = []
  for (const path of found.values()) kept.push(await loadProject(projectRefOf(path), env).catch(() => null as never))

  return kept.filter(Boolean)
}

/** The mod's copy of a project; one that cannot be read is passed over (the mod's file is the mod's to fix). */
async function readLegacy(file: string): Promise<CoreProject | null> {
  try {
    return await readJsonFile<CoreProject>(file)
  } catch {
    return null
  }
}

/**
 * Changes the project under its lock: `change` gets it as it stands now (read again inside the lock) and returns it
 * changed, with what the caller wants back. The project is written to the core's folder with `revision` one higher,
 * and to the mod's folder too while the mod keeps one (E1). `change` returning null writes nothing.
 */
export async function changeProject<R>(
  ref: ProjectRef,
  change: (project: CoreProject) => { project: CoreProject; result: R } | null | Promise<{ project: CoreProject; result: R } | null>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ project: CoreProject; result: R } | null> {
  const p = paths(env)
  const coreFile = p.project(ref)

  return withLock(coreFile, async () => {
    const current = await loadProject(ref, env)
    const changed = await change(current)
    if (!changed) return null
    const next: CoreProject = { ...changed.project, schema: 2, revision: (current.revision ?? 0) + 1 }
    await writeAtomic(coreFile, `${JSON.stringify(next, null, 2)}\n`)
    if (existsSync(p.legacy)) await writeAtomic(p.legacyProject(ref), JSON.stringify(next, null, 2))

    return { project: next, result: changed.result }
  })
}

/** An actor's record, or null. */
export async function loadActor(id: string, env: NodeJS.ProcessEnv = process.env): Promise<Actor | null> {
  return readJsonFile<Actor>(paths(env).actor(id))
}

/** Changes an actor's record under its lock (a hook and the MCP server of one session may write at once). */
export async function changeActor(id: string, change: (actor: Actor | null) => Actor, env: NodeJS.ProcessEnv = process.env): Promise<Actor> {
  const file = paths(env).actor(id)

  return withLock(file, async () => {
    const next = change(await readJsonFile<Actor>(file).catch(() => null))
    await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)

    return next
  })
}

/** Every actor record; one that cannot be read is skipped and named in `errors`. */
export async function loadActors(env: NodeJS.ProcessEnv = process.env): Promise<{ actors: Actor[]; errors: string[] }> {
  const dir = paths(env).actors
  let names: string[]
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { actors: [], errors: [] }

    return { actors: [], errors: [(err as Error).message] }
  }
  const actors: Actor[] = []
  const errors: string[] = []
  for (const name of names) {
    try {
      const one = await readJsonFile<Actor>(join(dir, name))
      if (one && typeof one.id === 'string') actors.push(one)
    } catch (err) {
      errors.push((err as Error).message)
    }
  }

  return { actors, errors }
}

/** A desktop session's track (the mod's sessions/<id>.json), read only: an owner the core's actors do not hold. */
export async function loadLegacyTrack(id: string, env: NodeJS.ProcessEnv = process.env): Promise<Track | null> {
  if (!/^local_[\w-]+$/.test(id)) return null
  try {
    return await readJsonFile<Track>(paths(env).legacySession(id))
  } catch {
    return null
  }
}
