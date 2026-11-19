/** The commands beyond the MCP server, the board and the hooks: serve and open (the web board), init and uninstall, and the git checks. */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

import { COMMANDS } from './cli'
import { run } from './host'
import { boardAddress, runningServer, serve } from './http'
import type { InstallEnv } from './install'
import { init, uninstall } from './install'
import { ct } from './messages'
import { checkPrePush, skipPush } from './prepush'
import { resolveProject } from './project'
import { VERSION } from './version'

/** How this program starts itself again: the single executable alone, or Node with its loader and the script. */
export function selfCommand(...args: string[]): { command: string; args: string[] } {
  if (isSea()) return { command: process.execPath, args }

  return { command: process.execPath, args: [...process.execArgv, process.argv[1]!, ...args] }
}

/** Opens a URL in the person's browser; false when no opener ran. */
export async function openBrowser(url: string): Promise<boolean> {
  const argv =
    process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url]

  return (await run(argv, process.cwd(), 10_000)) !== null
}

COMMANDS.serve = async args => {
  const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : undefined
  const served = await serve({ port, onIdle: () => process.exit(0) })
  const ref = await resolveProject(process.cwd())
  process.stdout.write(`${boardAddress(served.info, ref?.key)}\n`)
  const stop = () => void served.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  await new Promise(() => {})

  return 0
}

COMMANDS.open = async () => {
  let info = await runningServer()
  if (!info) {
    const self = selfCommand('serve')
    const child = spawn(self.command, self.args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd() })
    child.unref()
    for (let i = 0; i < 50 && !info; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      info = await runningServer()
    }
  }
  if (!info) {
    process.stderr.write('project-pm: the board server did not start.\n')

    return 1
  }
  const ref = await resolveProject(process.cwd())
  const url = boardAddress(info, ref?.key)
  process.stdout.write(`${url}\n`)
  await openBrowser(url)

  return 0
}

// ── init, uninstall, and the git checks (docs/design/v1-core.md 5, 6.2) ──

/** Whether this program runs as the single executable (node:sea, from Node 20). */
export function isSea(): boolean {
  try {
    return (process as unknown as { getBuiltinModule?: (id: string) => { isSea?: () => boolean } | undefined }).getBuiltinModule?.('node:sea')?.isSea?.() ?? false
  } catch {
    return false
  }
}

/**
 * How Claude Code's settings and git's hooks start this program: the single executable (init copies it into
 * ~/.project-pm/bin first); from npm, npx with this exact version (5.2), since npx's cache folder may move; from
 * the source, Node with its loader and the script.
 */
export function installSelf(): { self: string[]; exe: string | null } {
  if (isSea()) return { self: [process.execPath], exe: process.execPath }
  const script = process.argv[1] ?? ''
  if (/[\/]node_modules[\/]|[\/]_npx[\/]/.test(script)) return { self: ['npx', '-y', `project-pm@${VERSION}`], exe: null }
  const self = selfCommand()

  return { self: [self.command, ...self.args], exe: null }
}

function installEnv(): InstallEnv {
  const { self, exe } = installSelf()

  return { env: process.env, run, home: homedir(), self, exe, now: Date.now() }
}

const say = (text: string) => process.stdout.write(`${text}\n`)

COMMANDS.init = async args => {
  const ref = await resolveProject(process.cwd())
  if (!ref) {
    process.stderr.write(`${ct('error.notGit', { path: process.cwd() })}\n`)

    return 1
  }
  const out = await init(ref, installEnv(), { yes: args.includes('--yes') || args.includes('-y'), ci: args.includes('--ci') }, say)

  return out.failed.length ? 1 : 0
}

COMMANDS.uninstall = async args => {
  const ref = await resolveProject(process.cwd())
  await uninstall(ref, installEnv(), { yes: args.includes('--yes') || args.includes('-y'), hooksOnly: args.includes('--hooks') }, say)

  return 0
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

  return Buffer.concat(chunks).toString('utf8')
}

COMMANDS.check = async args => {
  if (args[0] !== 'pre-push') {
    process.stderr.write(`${ct('cli.unknown', { command: `check ${args[0] ?? ''}`.trim() })}\n`)

    return 2
  }
  const input = await readStdin()
  try {
    const ref = await resolveProject(process.cwd())
    if (!ref) return 0
    const checked = await checkPrePush(ref, input, run)
    if (checked.ok) return 0
    process.stderr.write(`\n${checked.message}\n\n`)

    return 1
  } catch (err) {
    // The PM itself failing never holds a push: the board names unchecked commits afterwards.
    process.stderr.write(`${ct('push.checkFailed', { reason: err instanceof Error ? err.message : String(err) })}\n`)

    return 0
  }
}

COMMANDS.skip = async args => {
  const reason = args.join(' ').trim()
  if (!reason) {
    process.stderr.write(`${ct('cli.skipNeedsReason')}\n`)

    return 2
  }
  const ref = await resolveProject(process.cwd())
  if (!ref) {
    process.stderr.write(`${ct('error.notGit', { path: process.cwd() })}\n`)

    return 1
  }
  const done = await skipPush(ref, reason, run)
  say(ct(done.isNew ? 'skip.recordedNew' : 'skip.recorded', { code: done.code, sha: done.sha.slice(0, 7), reason }))

  return 0
}
