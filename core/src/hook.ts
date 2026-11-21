/**
 * `project-pm hook claude-code <event>` (layer 3, docs/design/v1-core.md 7.1): Claude Code runs it on its hook
 * events with the event's JSON on stdin. It writes the session's actor record (its last instruction, task list,
 * background commands, last words), so the board knows where a terminal session stands without the AI reporting;
 * on UserPromptSubmit it hands the turn the PM's delivery ask and the development guidelines; on PreToolUse it keeps
 * the guidelines file from being edited unless the person asked about the guidelines this turn, and after a tool that
 * can write it warns when the file changed anyway (guard.ts: it never puts anything back). A hook never fails
 * the tool's turn: whatever goes wrong, it exits 0 and says nothing.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { MAX_CHARS, WRITING_TOOLS, asksForGuidelines, guidelinesPath, isSameFile } from '../../hooks/guidelines'
import { t } from '../../hooks/messages'
import { clip, finishedTasks, planFromTodos } from '../../hooks/sessions'
import type { BackgroundTask, Step } from '../../types'
import type { Run } from './host'
import type { GuidelinesSetting } from './guard'
import { GUARDED_TOOLS, alertText, watchGuidelines } from './guard'
import { dataHome, run as hostRun } from './host'
import { hostSessionId, isModInstalled } from './mod'
import { NotPlainPathError, localRealpath, plainLocalPath } from './localpath'
import { ct } from './messages'
import type { ProjectRef } from './project'
import { gitPath, resolveProject } from './project'
import { changeActor, loadActor, loadProject, readJsonFile } from './store'
import type { Actor } from './types'
import { REPORT_TOOL } from './tools'

export type HookInput = {
  session_id?: string
  cwd?: string
  hook_event_name?: string
  prompt?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  tool_use_id?: string
  last_assistant_message?: string
  background_tasks?: unknown
}

/** What the hook prints for Claude Code to read; null prints nothing. */
export type HookOutput = Record<string, unknown> | null

/**
 * An actor record's extras the hooks keep for themselves: when the turn began, when the person last spoke (a
 * notification starts a turn too), and the task tools' ids.
 */
type HookActor = Actor & { promptAt?: number; spokeAt?: number; askedGuidelinesAt?: number; taskIds?: string[] }

const TITLE_CHARS = 60

export async function runHook(tool: string, event: string, input: HookInput, env: NodeJS.ProcessEnv = process.env, now = Date.now(), run: Run = hostRun): Promise<HookOutput> {
  const session = input.session_id?.trim()
  if (!session || !/^[\w-]+$/.test(session)) return null
  const desktop = hostSessionId(env)
  // A desktop session with the mod installed: the mod keeps its record and hands its turns the delivery ask and the
  // guidelines (prompt.compose), so the hooks stand aside rather than say it all twice (E2).
  if (desktop && isModInstalled({ env, home: homedir() })) return null
  // In the desktop app the session's own id (local_…), as the mod and the core's MCP server name it.
  const id = desktop ?? `${tool}:${session}`
  const cwd = input.cwd || process.cwd()
  const ref = await resolveProject(cwd, run)
  // A folder outside git has no ledger and no board: nothing to keep.
  if (!ref) return null
  const base = (old: Actor | null): HookActor => ({ ...(old ?? { id, tool, title: '', cwd, lastSeenAt: now }), id, tool, cwd: old?.cwd ?? cwd, projectKey: ref.key, lastSeenAt: now })
  switch (event) {
    case 'UserPromptSubmit':
      return promptSubmit(id, ref, input, env, now, base, run)
    case 'PostToolUse':
      await postToolUse(id, input, env, now, base)
      return guardAfter(id, ref, input, env, now, run)
    case 'PreToolUse':
      return preToolUse(id, ref, input, env, run)
    case 'Stop':
    case 'SubagentStop':
      if (event === 'Stop') await stop(id, input, env, now, base)
      // A change made after the turn's last tool (a background command, say) is caught before the person speaks again.
      await guardAfter(id, ref, input, env, now, run, true)

      return null
    default:
      return null
  }
}

async function promptSubmit(id: string, ref: ProjectRef, input: HookInput, env: NodeJS.ProcessEnv, now: number, base: (old: Actor | null) => HookActor, run: Run): Promise<HookOutput> {
  const prompt = input.prompt ?? ''
  // A notification or another session's message wakes the turn; it is not the person's instruction.
  const isOwn = !prompt.trimStart().startsWith('<')
  const finished = new Set(finishedTasks(prompt))
  const me = (await changeActor(
    id,
    old => {
      const next = base(old) as HookActor
      next.state = 'running'
      next.promptAt = now
      if (isOwn) {
        next.spokeAt = now
        next.lastPrompt = clip(prompt, 500)
        if (!next.title) next.title = clip(prompt.replace(/\s+/g, ' ').trim(), TITLE_CHARS)
        if (asksForGuidelines(prompt)) next.askedGuidelinesAt = now
        else delete next.askedGuidelinesAt
      }
      if (finished.size && next.background) next.background = next.background.filter(task => !finished.has(task.id))

      return next
    },
    env,
  )) as HookActor
  const project = await loadProject(ref, env)
  if (!project.pmId) return null
  const parts: string[] = []
  // The person speaking: the guidelines file as it is now is where this session's turn starts from (guard.ts). A
  // notification waking the turn is not the person: what changed since the session's last look is judged first, as of
  // the person's last word.
  const alert = await guidelinesSetting(ref, env, run)
    .then(setting => watchGuidelines(ref, id, setting, isOwn, !!me.askedGuidelinesAt, env, now))
    .catch(() => null)
  if (alert) parts.push(alertText(alert))
  const isPm = project.pmId === id
  if (!isPm && !project.isDismissed) parts.push(t('role.delivery', { project: ref.name, tool: REPORT_TOOL, template: t('handover.template') }), ct('hook.actorHint', { actor: id }))
  const found = await readGuidelines(ref, env, run)
  if (found && 'text' in found) {
    parts.push(t('guidelines.section', { file: found.file, project: ref.name }))
    if (isPm) parts.push(t('guidelines.pm'))
    parts.push(found.text)
    if (found.isClipped) parts.push(t('guidelines.clipped', { max: MAX_CHARS, file: found.file }))
  }
  if (!parts.length) return null

  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: parts.join('\n\n') } }
}

async function postToolUse(id: string, input: HookInput, env: NodeJS.ProcessEnv, now: number, base: (old: Actor | null) => HookActor) {
  const name = input.tool_name ?? ''
  const args = input.tool_input ?? {}
  const answer = (input.tool_response ?? {}) as Record<string, unknown>
  if (name === 'TodoWrite') {
    await changeActor(id, old => ({ ...base(old), plan: planFromTodos(args.todos), planAt: now }), env)
  } else if (name === 'TaskCreate') {
    const task = (answer.task ?? {}) as { id?: unknown; subject?: unknown }
    const subject = typeof args.subject === 'string' ? args.subject : typeof task.subject === 'string' ? task.subject : ''
    if (!subject) return
    await changeActor(
      id,
      old => {
        const next = base(old) as HookActor
        next.plan = [...(next.plan ?? []), { content: subject, status: 'pending' }]
        next.taskIds = [...(next.taskIds ?? []), String(task.id ?? next.plan.length)]
        next.planAt = now

        return next
      },
      env,
    )
  } else if (name === 'TaskUpdate') {
    const taskId = String(args.taskId ?? '')
    const status = args.status
    await changeActor(
      id,
      old => {
        const next = base(old) as HookActor
        const at = (next.taskIds ?? []).indexOf(taskId)
        const plan: Step[] = [...(next.plan ?? [])]
        if (at < 0 || !plan[at]) return next
        if (status === 'deleted') {
          plan.splice(at, 1)
          next.taskIds = (next.taskIds ?? []).filter((_, i) => i !== at)
        } else if (status === 'pending' || status === 'in_progress' || status === 'completed') plan[at] = { ...plan[at]!, status }
        if (typeof args.subject === 'string' && plan[at] && status !== 'deleted') plan[at] = { ...plan[at]!, content: args.subject }
        next.plan = plan
        next.planAt = now

        return next
      },
      env,
    )
  } else if (name === 'Bash' && args.run_in_background === true) {
    const taskId = typeof answer.backgroundTaskId === 'string' ? answer.backgroundTaskId : input.tool_use_id
    if (!taskId) return
    const label = clip(String(args.description || args.command || ''), 80)
    await changeActor(id, old => {
      const next = base(old)
      const task: BackgroundTask = { id: taskId, label, at: now }

      return { ...next, background: [...(next.background ?? []).filter(b => b.id !== taskId), task] }
    }, env)
  }
}

/**
 * After a tool that can write, or when a turn stops (T-39 2): the guidelines setting and file now compared with what
 * this session's turn started from. Changed without the person agreeing to a guidelines change this turn (the file,
 * or the setting: turned off, another file, git no longer tracking it): the model is told and the board lists it.
 * Nothing is put back; a new setting's file is not compared with the old one.
 */
async function guardAfter(id: string, ref: ProjectRef, input: HookInput, env: NodeJS.ProcessEnv, now: number, run: Run, isStop = false): Promise<HookOutput> {
  if (!isStop && !GUARDED_TOOLS.has(input.tool_name ?? '')) return null
  const project = await loadProject(ref, env)
  if (!project.pmId) return null
  const setting = await guidelinesSetting(ref, env, run).catch(() => null)
  if (!setting) return null
  const actor = (await loadActor(id, env).catch(() => null)) as HookActor | null
  const alert = await watchGuidelines(ref, id, setting, false, !!actor?.askedGuidelinesAt, env, now).catch(() => null)
  if (!alert || isStop) return null

  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: alertText(alert) } }
}

async function stop(id: string, input: HookInput, env: NodeJS.ProcessEnv, now: number, base: (old: Actor | null) => HookActor) {
  const said = input.last_assistant_message ?? ''
  await changeActor(
    id,
    old => {
      const next = base(old) as HookActor
      next.state = 'idle'
      next.turnAt = now
      next.lastAnswer = clip(said, 2000)
      next.ask = null
      // A report from before this turn began spoke of the work as it stood then (the mod drops it the same way).
      if (next.report && (next.reportAt ?? 0) < (next.promptAt ?? 0)) {
        delete next.report
        delete next.reportAt
      }
      // Claude Code says which background commands still run; an empty list settles every one it had.
      if (Array.isArray(input.background_tasks)) {
        const running = new Set(input.background_tasks.map(task => String((task as { id?: unknown })?.id ?? task)))
        next.background = (next.background ?? []).filter(task => running.has(task.id))
      }

      return next
    },
    env,
  )
}

async function preToolUse(id: string, ref: ProjectRef, input: HookInput, env: NodeJS.ProcessEnv, run: Run): Promise<HookOutput> {
  const field = WRITING_TOOLS[input.tool_name ?? '']
  if (!field) return null
  const target = input.tool_input?.[field]
  if (typeof target !== 'string') return null
  const project = await loadProject(ref, env)
  if (!project.pmId) return null
  // Asked about this turn: the lock stands aside, and nothing about the target need be looked up.
  const actor = (await loadActor(id, env).catch(() => null)) as HookActor | null
  if (actor?.askedGuidelinesAt) return null
  const found = await readGuidelines(ref, env, run)
  if (!found) return null
  const which = await isGuidelinesFile(found.file, target, input.cwd || ref.cwd)
  if (which === 'other') return null
  const reason = which === 'unplain' ? t('guidelines.remote', { path: target, file: found.file }) : t('guidelines.locked', { file: found.file })

  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}

/**
 * Whether a tool's target is the guidelines file: written the same way, or the same file on disk however it is written
 * (an 8.3 short name such as C:\Users\RUNNER~1, a folder link, a subst drive, a path relative to the session's folder).
 * Git gives the repository's folder in one spelling and a tool may use another, so names alone let the lock be passed.
 *
 * `unplain` when the target is not a plain path on this machine's disks (plainLocalPath: \\host\share, \\?\…, a device
 * name, C:x, a stream) or a link on the way leads to one: looking it up could connect to another host before the
 * person allowed anything (localpath.ts), so it is never looked up, and since it cannot be told apart from the
 * guidelines file (\\localhost\C$\… is this machine's own disk), the lock refuses it.
 */
async function isGuidelinesFile(guidelines: string, target: string, cwd: string): Promise<'same' | 'other' | 'unplain'> {
  if (isSameFile(guidelines, target.replace(/\\/g, '/'))) return 'same'
  const where = plainLocalPath(target, cwd)
  if (where === null) return 'unplain'
  if (isSameFile(guidelines, where.replace(/\\/g, '/'))) return 'same'
  // Where each really is. The guidelines file is the person's or the repository's: one that is not a plain local path
  // is matched by its name alone, above.
  const [a, b] = await Promise.all([localRealpath(guidelines).catch(() => null), localRealpath(where).catch((err: unknown) => (err instanceof NotPlainPathError ? err : null))])
  if (b instanceof NotPlainPathError) return 'unplain'

  return !!a && !!b && isSameFile(a, b) ? 'same' : 'other'
}

/**
 * The guidelines file a project's .project-pm.json names, or null when it is not a plain path inside the repository.
 * That file is committed with the code, so whoever can commit could aim it at ~/.aws/credentials and have it read
 * into every turn: no absolute path (C:\, C:x, /, \, \\server), no ~, no .. anywhere, nothing in .git, and the result
 * inside `repo`.
 */
export function projectGuidelinesFile(value: string, repo: string): string | null {
  const path = value.trim().replace(/^["']|["']$/g, '')
  if (!path || path.startsWith('~') || /^[a-z]:/i.test(path) || /^[\\/]/.test(path) || isAbsolute(path)) return null
  if (path.split(/[\\/]+/).includes('..')) return null
  const file = resolve(repo, path)

  return isInside(file, repo) && !isInGit(file, repo) ? file : null
}

function isInside(file: string, folder: string): boolean {
  const rel = relative(resolve(folder), resolve(file))

  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Whether `file` is in the repository's .git folder, or might be. Windows drops a name's trailing dots and spaces and
 * ignores case, so ".git." and ".GIT " are .git there; macOS ignores case by default, so ".GIT" is .git there. Read the
 * same way on every system (CI run 44716640045: on Linux and macOS ".GIT./config" and ".GIT/config" got through): a
 * folder that only looks like .git, on a system where it is not, is refused too, which costs nothing.
 */
function isInGit(file: string, repo: string): boolean {
  const first = relative(resolve(repo), resolve(file)).split(/[\\/]+/)[0] ?? ''

  return first.replace(/[. ]+$/, '').toLowerCase() === '.git'
}

/** Whether git tracks `file` (in its index): a .env, an ignored file or one never added is not the project's. */
async function isTracked(file: string, repo: string, run: Run): Promise<boolean> {
  return (await trackedBy(file, repo, run)) === true
}

/** Whether git tracks `file`; null when git did not answer (it failed, or took too long). */
async function trackedBy(file: string, repo: string, run: Run): Promise<boolean | null> {
  // As git names it: a backslash is a separator only on Windows (T-39 QA6).
  const rel = gitPath(repo, file)
  // Literal: a name with * or : in it is that name, not a pattern matching some other file git tracks. -z: each name as
  // it is, ended by NUL; without it git quotes and escapes a name with " or \, a control character, or (core.quotepath,
  // on by default) any non-ASCII letter, so 開發準則.md was never found tracked (CI run 44716640045, `say "hi".md`).
  const listed = await run(['git', '--literal-pathspecs', 'ls-files', '-z', '--', rel], repo)
  if (listed === null) return null

  return listed.split('\0').some(name => name === rel)
}

/** A guidelines setting that could not be read: why. */
class SettingError extends Error {
  constructor(readonly reason: 'git' | 'corrupt' | 'notPlain') {
    super(reason)
  }
}

/**
 * The file a project's .project-pm.json names, when it is a plain path inside the repository that git tracks by that
 * name; null otherwise. Where a link there leads is not looked at here. Throws SettingError when it cannot be told:
 * .project-pm.json is not a plain local path or not JSON, or git does not answer.
 */
async function projectNamed(ref: ProjectRef, run: Run): Promise<string | null> {
  // .project-pm.json is the repository's: a committed link there may lead to another machine.
  const settings = await localRealpath(join(ref.path, '.project-pm.json')).catch(err => {
    throw new SettingError(err instanceof NotPlainPathError ? 'notPlain' : 'corrupt')
  })
  const fromProject = settings
    ? await readJsonFile<{ guidelines?: unknown }>(settings).catch(() => {
        throw new SettingError('corrupt')
      })
    : null
  if (typeof fromProject?.guidelines !== 'string' || !fromProject.guidelines.trim()) return null
  const named = projectGuidelinesFile(fromProject.guidelines, ref.path)
  if (!named) return null
  const tracked = await trackedBy(named, ref.path, run)
  if (tracked === null) throw new SettingError('git')

  return tracked ? named : null
}

/** The file the person's own ~/.project-pm/config.json names (any path; nothing about it is looked up here). */
async function userNamed(ref: ProjectRef, env: NodeJS.ProcessEnv): Promise<string | null> {
  const fromUser = await readJsonFile<{ guidelines?: unknown }>(join(dataHome(env), 'config.json')).catch(() => {
    throw new SettingError('corrupt')
  })
  if (typeof fromUser?.guidelines !== 'string' || !fromUser.guidelines.trim()) return null

  return guidelinesPath(fromUser.guidelines, homedir().replace(/\\/g, '/'), ref.path.replace(/\\/g, '/'))
}

/**
 * The guidelines setting the after-the-fact check watches (guard.ts): the file the project names (by its name,
 * wherever a link there now leads, so a file swapped for a link is noticed rather than passed over), else the person's
 * own, else none; or unreadable, with why, so that a setting nobody can read is a change too, not "none".
 */
export async function guidelinesSetting(ref: ProjectRef, env: NodeJS.ProcessEnv = process.env, run: Run = hostRun): Promise<GuidelinesSetting> {
  try {
    const named = await projectNamed(ref, run)
    if (named) return { from: 'project', file: named }
    const mine = await userNamed(ref, env)

    return mine ? { from: 'user', file: mine } : { from: 'none' }
  } catch (err) {
    return { from: 'unreadable', reason: err instanceof SettingError ? err.reason : 'corrupt' }
  }
}

/**
 * The development guidelines file: `guidelines` in the project's .project-pm.json (a file git tracks inside the
 * repository, not in .git, where a link leads checked too), else in ~/.project-pm/config.json (the person's own: any
 * plain local path). `real` is where the file really is, the one read. Nothing is read through a path that is not a
 * plain local path or a link that leads to one (localpath.ts): .project-pm.json, the file it names, the person's file.
 */
export async function readGuidelines(ref: ProjectRef, env: NodeJS.ProcessEnv = process.env, run: Run = hostRun): Promise<{ file: string; real: string; text: string; isClipped: boolean } | { file: string; real?: string; error: string } | null> {
  let file: string | null = null
  const named = await projectNamed(ref, run).catch(() => null)
  if (named) {
    // A link committed in the repository may lead anywhere: where it really goes must be inside too, and not in .git.
    // One that leads off this machine's disks (\\host\share) is refused unfollowed: following it connects there.
    const real = await localRealpath(named).then(
      found => found ?? named,
      () => null,
    )
    const repo = real && (await localRealpath(ref.path).then(
      found => found ?? ref.path,
      () => null,
    ))
    // Only what the project keeps in git: never a .env or another file the person keeps beside the code. Both the
    // name (projectNamed) and the file it really is: a committed link (RULES.md -> .env) is tracked, the file it leads
    // to may not be.
    if (real && repo && isInside(real, repo) && !isInGit(real, repo) && (await isTracked(real, repo, run))) file = named
  }
  if (!file) file = await userNamed(ref, env).catch(() => null)
  if (!file) return null
  const failed = (err: unknown) => (err instanceof Error ? err.message : String(err))
  // The person's file may be named relative to the project, through a link the repository holds: checked the same.
  let real: string | null
  try {
    real = await localRealpath(file)
  } catch (err) {
    return { file, error: failed(err) }
  }
  if (!real) return { file, error: 'not found' }
  // From here `real` is where the file is, or would be: an empty or missing file is still the one named.
  try {
    const text = (await readFile(real, 'utf8')).replace(/^\uFEFF/, '').trim()
    if (!text) return { file, real, error: 'empty' }

    return text.length <= MAX_CHARS ? { file, real, text, isClipped: false } : { file, real, text: text.slice(0, MAX_CHARS), isClipped: true }
  } catch (err) {
    return { file, real, error: failed(err) }
  }
}

/** Reads the event from stdin, runs the hook and prints its answer; never fails the tool. */
export async function hookMain(tool: string, event: string): Promise<number> {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as HookInput
    const out = await runHook(tool, event || input.hook_event_name || '', input)
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`)
  } catch (err) {
    if (process.env.PROJECT_PM_DEBUG) process.stderr.write(`project-pm hook: ${err instanceof Error ? err.message : String(err)}\n`)
  }

  return 0
}

