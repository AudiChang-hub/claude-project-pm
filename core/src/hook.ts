/**
 * `project-pm hook claude-code <event>` (layer 3, docs/design/v1-core.md 7.1): Claude Code runs it on its hook
 * events with the event's JSON on stdin. It writes the session's actor record (its last instruction, task list,
 * background commands, last words), so the board knows where a terminal session stands without the AI reporting;
 * on UserPromptSubmit it hands the turn the PM's delivery ask and the development guidelines; on PreToolUse it keeps
 * the guidelines file from being edited unless the person asked about the guidelines this turn. A hook never fails
 * the tool's turn: whatever goes wrong, it exits 0 and says nothing.
 */
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { MAX_CHARS, WRITING_TOOLS, asksForGuidelines, guidelinesPath, isSameFile } from '../../hooks/guidelines'
import { t } from '../../hooks/messages'
import { clip, finishedTasks, planFromTodos } from '../../hooks/sessions'
import type { BackgroundTask, Step } from '../../types'
import type { Run } from './host'
import { dataHome, run as hostRun } from './host'
import { ct } from './messages'
import type { ProjectRef } from './project'
import { resolveProject } from './project'
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

/** An actor record's extras the hooks keep for themselves: when the turn began, and the task tools' ids. */
type HookActor = Actor & { promptAt?: number; askedGuidelinesAt?: number; taskIds?: string[] }

const TITLE_CHARS = 60

export async function runHook(tool: string, event: string, input: HookInput, env: NodeJS.ProcessEnv = process.env, now = Date.now(), run: Run = hostRun): Promise<HookOutput> {
  const session = input.session_id?.trim()
  if (!session || !/^[\w-]+$/.test(session)) return null
  const id = `${tool}:${session}`
  const cwd = input.cwd || process.cwd()
  const ref = await resolveProject(cwd, run)
  // A folder outside git has no ledger and no board: nothing to keep.
  if (!ref) return null
  const base = (old: Actor | null): HookActor => ({ ...(old ?? { id, tool, title: '', cwd, lastSeenAt: now }), id, tool, cwd: old?.cwd ?? cwd, projectKey: ref.key, lastSeenAt: now })
  switch (event) {
    case 'UserPromptSubmit':
      return promptSubmit(id, ref, input, env, now, base)
    case 'PostToolUse':
      await postToolUse(id, input, env, now, base)
      return null
    case 'PreToolUse':
      return preToolUse(id, ref, input, env)
    case 'Stop':
    case 'SubagentStop':
      if (event === 'Stop') await stop(id, input, env, now, base)
      return null
    default:
      return null
  }
}

async function promptSubmit(id: string, ref: ProjectRef, input: HookInput, env: NodeJS.ProcessEnv, now: number, base: (old: Actor | null) => HookActor): Promise<HookOutput> {
  const prompt = input.prompt ?? ''
  // A notification or another session's message wakes the turn; it is not the person's instruction.
  const isOwn = !prompt.trimStart().startsWith('<')
  const finished = new Set(finishedTasks(prompt))
  await changeActor(
    id,
    old => {
      const next = base(old) as HookActor
      next.state = 'running'
      next.promptAt = now
      if (isOwn) {
        next.lastPrompt = clip(prompt, 500)
        if (!next.title) next.title = clip(prompt.replace(/\s+/g, ' ').trim(), TITLE_CHARS)
        if (asksForGuidelines(prompt)) next.askedGuidelinesAt = now
        else delete next.askedGuidelinesAt
      }
      if (finished.size && next.background) next.background = next.background.filter(task => !finished.has(task.id))

      return next
    },
    env,
  )
  const project = await loadProject(ref, env)
  if (!project.pmId) return null
  const parts: string[] = []
  const isPm = project.pmId === id
  if (!isPm && !project.isDismissed) parts.push(t('role.delivery', { project: ref.name, tool: REPORT_TOOL }), ct('hook.actorHint', { actor: id }))
  const found = await readGuidelines(ref, env)
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

async function preToolUse(id: string, ref: ProjectRef, input: HookInput, env: NodeJS.ProcessEnv): Promise<HookOutput> {
  const field = WRITING_TOOLS[input.tool_name ?? '']
  if (!field) return null
  const target = input.tool_input?.[field]
  if (typeof target !== 'string') return null
  const project = await loadProject(ref, env)
  if (!project.pmId) return null
  const found = await readGuidelines(ref, env)
  if (!found || !isSameFile(found.file, target.replace(/\\/g, '/'))) return null
  const actor = (await loadActor(id, env).catch(() => null)) as HookActor | null
  if (actor?.askedGuidelinesAt) return null

  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: t('guidelines.locked', { file: found.file }) } }
}

/**
 * The guidelines file a project's .project-pm.json names, or null when it is not a plain path inside the repository.
 * That file is committed with the code, so whoever can commit could aim it at ~/.aws/credentials and have it read
 * into every turn: no absolute path (C:\, C:x, /, \, \\server), no ~, no .. anywhere, and the result inside `repo`.
 */
export function projectGuidelinesFile(value: string, repo: string): string | null {
  const path = value.trim().replace(/^["']|["']$/g, '')
  if (!path || path.startsWith('~') || /^[a-z]:/i.test(path) || /^[\\/]/.test(path) || isAbsolute(path)) return null
  if (path.split(/[\\/]+/).includes('..')) return null
  const file = resolve(repo, path)

  return isInside(file, repo) ? file : null
}

function isInside(file: string, folder: string): boolean {
  const rel = relative(resolve(folder), resolve(file))

  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The development guidelines file: `guidelines` in the project's .project-pm.json (a file inside the repository,
 * where a link leads checked too), else in ~/.project-pm/config.json (the person's own: any path).
 */
export async function readGuidelines(ref: ProjectRef, env: NodeJS.ProcessEnv = process.env): Promise<{ file: string; text: string; isClipped: boolean } | { file: string; error: string } | null> {
  const fromProject = await readJsonFile<{ guidelines?: unknown }>(join(ref.path, '.project-pm.json')).catch(() => null)
  let file: string | null = null
  if (typeof fromProject?.guidelines === 'string' && fromProject.guidelines.trim()) {
    const named = projectGuidelinesFile(fromProject.guidelines, ref.path)
    // A link committed in the repository may lead anywhere: where it really goes must be inside too.
    if (named && isInside(await realpath(named).catch(() => named), await realpath(ref.path).catch(() => ref.path))) file = named
  }
  if (!file) {
    const fromUser = await readJsonFile<{ guidelines?: unknown }>(join(dataHome(env), 'config.json')).catch(() => null)
    if (typeof fromUser?.guidelines === 'string' && fromUser.guidelines.trim()) file = guidelinesPath(fromUser.guidelines, homedir().replace(/\\/g, '/'), ref.path.replace(/\\/g, '/'))
  }
  if (!file) return null
  try {
    const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim()
    if (!text) return { file, error: 'empty' }

    return text.length <= MAX_CHARS ? { file, text, isClipped: false } : { file, text: text.slice(0, MAX_CHARS), isClipped: true }
  } catch (err) {
    return { file, error: err instanceof Error ? err.message : String(err) }
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

