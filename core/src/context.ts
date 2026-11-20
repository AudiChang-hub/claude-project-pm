/** What every tool call carries: who calls, from where, and the host it runs on (so tests can stand in for git and gh). */
import type { Facts } from './facts'
import { newFacts } from './facts'
import type { Run } from './host'
import { run as hostRun } from './host'
import { localRealpath, plainLocalPath } from './localpath'
import { initLang } from './messages'
import type { ProjectRef } from './project'
import { resolveProject } from './project'

export type Ctx = {
  /** The calling session's actor id (1.5). */
  actor: string
  /** Its tool: claude-code, codex, … */
  tool: string
  /** The folder the connection works in: a tool's `project` overrides it. */
  cwd: string
  env: NodeJS.ProcessEnv
  run: Run
  now: () => number
  facts: Facts
  /** The folders the MCP client says it works in (roots/list), when it says: they come before `cwd` (3.1). */
  roots?: () => Promise<string[]>
}

/** What a tool answers: the words for the model, the same as JSON for programs, and whether the core itself failed. */
export type ToolResult = { text: string; structured: Record<string, unknown>; isError?: boolean }

export function newCtx(part: Partial<Ctx> & { actor: string; tool: string }): Ctx {
  const run = part.run ?? hostRun
  const now = part.now ?? Date.now
  initLang(part.env ?? process.env)

  return { cwd: process.cwd(), env: process.env, facts: newFacts(run, now), ...part, run, now }
}

/**
 * The project a call is about (3.1): its `project` folder; else the first of the client's roots that is in a git
 * repository; else the folder the server runs in.
 */
export async function projectOf(ctx: Ctx, input: Record<string, unknown>): Promise<ProjectRef | null> {
  if (typeof input.project === 'string' && input.project.trim()) {
    // The model writes `project`: git starts only in a plain folder on this machine's disks, reached through no link
    // that leads off them (\\host\share would be connected to before the person allowed anything: localpath.ts).
    // Tools answer any other path with error.remotePath.
    const project = plainLocalPath(input.project.trim(), ctx.cwd)
    if (project === null || !(await localRealpath(project).then(() => true, () => false))) return null

    return resolveProject(project, ctx.run)
  }
  for (const folder of (await ctx.roots?.()) ?? []) {
    const ref = await resolveProject(folder, ctx.run)
    if (ref) return ref
  }

  return resolveProject(ctx.cwd, ctx.run)
}
