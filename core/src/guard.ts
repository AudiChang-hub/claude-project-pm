/**
 * The guidelines file, checked after the fact (T-39 2): it only notices and says so, and never writes the file.
 *
 * The lock (hook.ts, PreToolUse) refuses an edit through the writing tools; anything it cannot see (a shell command, a
 * spelling it has no word for) shows here. Putting a change back would need to know, across sessions the person runs
 * at once, who changed the file and whether they had agreed; two rounds of QA found that guess wrong in both
 * directions, and a wrong guess wrote over the person's own change. So nothing is put back: a warning costs nothing
 * when it is wrong (T-39, option A).
 *
 * Each session keeps its own baseline: what the path the guidelines are set to looked like when the person last spoke
 * in it (the file's SHA-256, whether the path is a link and where to, where the file really is). It lives in the
 * person's data folder (~/.project-pm/guidelines/sessions/<hash of the session id>.json, never in the repository) and
 * names the setting it was taken for (the project's file, the person's own, none, or unreadable), so the pair
 * (session, setting) is what is compared. After a tool of the session's that can write, when a notification wakes
 * the session, and when its turn stops, both are looked at again. The setting changed (git rm or git mv of the file,
 * an edit of .project-pm.json, the guidelines turned off or on, a setting that cannot be read), or the file changed,
 * emptied, deleted, made a link or pointed elsewhere, or no longer a plain local path, without the person agreeing to
 * a guidelines change this turn: it is listed on the board, attributed to the session that saw it and worded so as not
 * to say who did it (another session, or the person, may have). A new setting's file is never compared with the old
 * file: the baseline follows the setting. For the person's own file, a
 * read-only copy of what the baseline held is kept for them to copy back by hand; a project's file is in git.
 *
 * What it cannot catch: a change made on purpose to get past it (running this hook by hand to take a new baseline,
 * deleting the baselines). It is a smoke alarm, not a lock.
 */
import { createHash } from 'node:crypto'
import { chmod, lstat, readFile, readdir, readlink, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { NotPlainPathError, localRealpath } from './localpath'
import { ct } from './messages'
import type { ProjectRef } from './project'
import { paths, readJsonFile, withLock, writeAtomic } from './store'

/** Larger than this, a file's bytes are not read (its size and time are compared) nor copied. */
export const MAX_GUIDELINES_BYTES = 1024 * 1024

/** How long the board lists a warning. */
export const ALERT_SHOWN_MS = 7 * 24 * 60 * 60 * 1000

/** A session's baseline unused this long is let go. */
const BASELINE_KEPT_MS = 30 * 24 * 60 * 60 * 1000

/** The tools after which the file is compared: every one that can write a file (the shells too). */
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'])

/**
 * Which guidelines file is set, and by whom: the project's .project-pm.json, or the person's own config; none; or a
 * setting that could not be read (`git` did not answer whether the file is tracked, a settings file is `corrupt`, or
 * .project-pm.json is `notPlain`).
 */
export type GuidelinesSetting = { from: 'project' | 'user'; file: string } | { from: 'none' } | { from: 'unreadable'; reason: 'git' | 'corrupt' | 'notPlain' }

/** A setting that names a file. */
type FileSetting = Extract<GuidelinesSetting, { file: string }>

const isFileSetting = (setting: GuidelinesSetting): setting is FileSetting => setting.from === 'project' || setting.from === 'user'

/** Whether two settings are the same: the same file by the same source, none twice, unreadable twice. */
function isSameSetting(a: GuidelinesSetting, b: GuidelinesSetting): boolean {
  if (a.from !== b.from) return false

  return isFileSetting(a) && isFileSetting(b) ? isSamePath(a.file, b.file) : true
}

/** What the set path looked like. `real` and `link` are null where nothing could be (or was) looked up. */
type Look = {
  kind: 'file' | 'missing' | 'unplain' | 'unreadable' | 'large'
  sha256: string | null
  size: number | null
  mtime: number | null
  real: string | null
  link: string | null
}

/** `look` is null when the setting names no file. */
type Baseline = { session: string; setting: GuidelinesSetting; at: number; look: Look | null; copy: string | null }

/** What happened to the file, in the words the board uses; `setting` when the setting itself changed. */
export type Change = 'changed' | 'emptied' | 'deleted' | 'linked' | 'unplain' | 'unreadable'

/** A change of the file (`file`, `from`, `copy`), or of the setting (`was` and `now`). */
export type GuidelinesAlert =
  | { at: number; by: string; repo: string; change: Change; file: string; from: FileSetting['from']; copy: string | null }
  | { at: number; by: string; repo: string; change: 'setting'; was: GuidelinesSetting; now: GuidelinesSetting }

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

/** Two real paths, as the system compares them: letter case aside on Windows. */
const isSamePath = (a: string | null, b: string | null) => (a === null || b === null ? a === b : process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

const home = (env: NodeJS.ProcessEnv) => join(paths(env).home, 'guidelines')

function baselineFile(session: string, env: NodeJS.ProcessEnv): string {
  return join(home(env), 'sessions', `${sha256(session).slice(0, 40)}.json`)
}

/** The warnings for a project, for its board. */
function alertsFile(ref: ProjectRef, env: NodeJS.ProcessEnv): string {
  return join(home(env), `${ref.file}.json`)
}

/**
 * What `file` looks like now, read only. Nothing is asked about a path that is not a plain local path, or that a link
 * on the way leads off this machine's disks from (localRealpath throws before asking).
 */
async function lookAt(file: string): Promise<{ look: Look; bytes: Buffer | null }> {
  const none = { sha256: null, size: null, mtime: null }
  let real: string | null
  try {
    real = await localRealpath(file)
  } catch (err) {
    return { look: { kind: err instanceof NotPlainPathError ? 'unplain' : 'unreadable', ...none, real: null, link: null }, bytes: null }
  }
  if (!real) return { look: { kind: 'missing', ...none, real: null, link: null }, bytes: null }
  // Every link on the way was checked above: the path itself may now be looked at, not followed.
  const self = await lstat(file).catch(() => null)
  const link = self?.isSymbolicLink() ? await readlink(file).catch(() => '?') : null
  const base = { real, link }
  try {
    const stats = await stat(real)
    if (!stats.isFile()) return { look: { kind: 'unreadable', ...none, ...base }, bytes: null }
    if (stats.size > MAX_GUIDELINES_BYTES) return { look: { kind: 'large', sha256: null, size: stats.size, mtime: stats.mtimeMs, ...base }, bytes: null }
    const bytes = await readFile(real)

    return { look: { kind: 'file', sha256: sha256(bytes), size: bytes.length, mtime: null, ...base }, bytes }
  } catch (err) {
    const kind = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'

    return { look: { kind, ...none, ...base }, bytes: null }
  }
}

/** What changed between two looks at one path, or null when nothing did. */
function changeOf(was: Look, now: Look): Change | null {
  const isSame = was.kind === now.kind && was.sha256 === now.sha256 && was.size === now.size && was.mtime === now.mtime && was.link === now.link && isSamePath(was.real, now.real)
  if (isSame) return null
  if (now.kind === 'unplain') return 'unplain'
  if (now.link !== was.link) return 'linked'
  if (now.kind === 'missing') return 'deleted'
  if (now.kind === 'unreadable') return 'unreadable'
  // The file really is somewhere else now (a folder on the way made a link). From a share or an unreadable path back
  // to a readable one (no real path before) is a change of its text.
  if (was.real !== null && !isSamePath(was.real, now.real)) return 'linked'
  if (now.size === 0) return 'emptied'

  return 'changed'
}

/**
 * A read-only copy of the person's own guidelines, named by its SHA-256, in their data folder: what they can copy back
 * by hand. Never written over once there.
 */
async function keepCopy(bytes: Buffer, sha: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const copy = join(home(env), 'copies', `${sha}.md`)
  try {
    if (await stat(copy).then(() => true, () => false)) return copy
    await writeAtomic(copy, bytes)
    await chmod(copy, 0o444)

    return copy
  } catch {
    // Another session wrote the same copy at the same moment, or the folder cannot be written: it is there or it is not.
    return (await stat(copy).then(() => true, () => false)) ? copy : null
  }
}

/** Baselines no session has used in a month: the sessions are long gone. */
async function dropOldBaselines(env: NodeJS.ProcessEnv, now: number): Promise<void> {
  const folder = join(home(env), 'sessions')
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (!name.endsWith('.json')) continue
    const at = await stat(join(folder, name)).then(s => s.mtimeMs, () => now)
    if (now - at > BASELINE_KEPT_MS) await rm(join(folder, name), { force: true })
  }
}

/**
 * Looks at the guidelines for `session` (the actor id). `isStart`: the person has just spoken, so the setting and the
 * file as they are now are what the session's turn starts from; nothing is judged. Otherwise they are compared with
 * the session's baseline, which then moves on: a setting changed since (none set, another file, the project's file
 * given up for the person's own, one that cannot be read) is a change of its own, and the new file is not compared
 * with the old one; the same file is compared with how it looked. A change the person did not agree to this turn
 * (`isAsked` false) becomes a warning on the project's board, and is returned. No baseline yet: nothing to judge.
 * Nothing here writes, renames or deletes the guidelines file.
 */
export async function watchGuidelines(ref: ProjectRef, session: string, setting: GuidelinesSetting, isStart: boolean, isAsked: boolean, env: NodeJS.ProcessEnv, now: number): Promise<GuidelinesAlert | null> {
  const file = baselineFile(session, env)
  const alert = await withLock(file, async (): Promise<GuidelinesAlert | null> => {
    const kept = isStart ? null : await readJsonFile<Baseline>(file).catch(() => null)
    // A baseline from before the setting was kept in it (or another session's, were two ids to share a hash) is none.
    const was = kept && kept.session === session && kept.setting && typeof kept.setting.from === 'string' ? kept : null
    const seen = isFileSetting(setting) ? await lookAt(setting.file) : null
    const look = seen?.look ?? null
    const isSame = !!was && isSameSetting(was.setting, setting)
    const change = isSame && was.look && look ? changeOf(was.look, look) : null
    if (isSame && !change) return null
    const copy = setting.from === 'user' && seen?.bytes && look?.sha256 ? await keepCopy(seen.bytes, look.sha256, env) : null
    const next: Baseline = { session, setting, at: now, look, copy }
    await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    if (!was || isAsked) return null
    if (!isSame) return { at: now, by: session, repo: ref.path, change: 'setting', was: was.setting, now: setting }
    if (!change || !isFileSetting(setting)) return null

    return { at: now, by: session, repo: ref.path, change, file: setting.file, from: setting.from, copy: was.copy }
  })
  if (isStart) await dropOldBaselines(env, now).catch(() => {})
  if (!alert) return null
  const list = alertsFile(ref, env)
  await withLock(list, async () => {
    const kept = (await readJsonFile<{ alerts?: GuidelinesAlert[] }>(list).catch(() => null)) ?? {}
    await writeAtomic(list, `${JSON.stringify({ alerts: [...(kept.alerts ?? []), alert].slice(-10) }, null, 2)}\n`)
  })

  return alert
}

/** The warnings of the last week, for the board's attention section. */
export async function guidelinesAlerts(ref: ProjectRef, env: NodeJS.ProcessEnv, now: number): Promise<GuidelinesAlert[]> {
  const kept = await readJsonFile<{ alerts?: GuidelinesAlert[] }>(alertsFile(ref, env)).catch(() => null)
  const isAlert = (a: GuidelinesAlert) =>
    typeof a?.at === 'number' && typeof a.by === 'string' && typeof a.repo === 'string' && (a.change === 'setting' ? !!a.was?.from && !!a.now?.from : typeof a.file === 'string')

  return (kept?.alerts ?? []).filter(a => isAlert(a) && now - a.at < ALERT_SHOWN_MS)
}

/** A setting in plain words. */
function settingWords(setting: GuidelinesSetting): string {
  if (isFileSetting(setting)) return ct(setting.from === 'project' ? 'guidelines.setting.project' : 'guidelines.setting.user', { file: setting.file })
  if (setting.from === 'none') return ct('guidelines.setting.none')
  const reason = setting.reason === 'git' ? 'guidelines.reason.git' : setting.reason === 'notPlain' ? 'guidelines.reason.notPlain' : 'guidelines.reason.corrupt'

  return ct('guidelines.setting.unreadable', { reason: ct(reason) })
}

/**
 * A warning in plain words, for the model, or with `when` for the board: what happened, and how the person can see
 * or undo it themselves.
 */
export function alertText(alert: GuidelinesAlert, when?: string): string {
  if (alert.change === 'setting') {
    const words = { was: settingWords(alert.was), now: settingWords(alert.now), fix: ct('guidelines.fix.setting', { repo: alert.repo }) }

    return when === undefined ? ct('guidelines.settingAlert', words) : ct('board.guidelinesSettingAlert', { ...words, when, by: alert.by })
  }
  // A project's file is in git; the person's own has the read-only copy taken when the turn began, if there was one.
  const fix =
    alert.from === 'project'
      ? ct('guidelines.fix.project', { repo: alert.repo, rel: relative(alert.repo, alert.file).replace(/\\/g, '/') })
      : alert.copy
        ? ct('guidelines.fix.copy', { copy: alert.copy })
        : ct('guidelines.fix.noCopy')
  const words = { file: alert.file, what: ct(`guidelines.what.${alert.change}`), fix }

  return when === undefined ? ct('guidelines.alert', words) : ct('board.guidelinesAlert', { ...words, when, by: alert.by })
}
