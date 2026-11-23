/** The commands beyond the MCP server, the board and the hooks: serve and open (the web board), init and uninstall, and the git checks. */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { COMMANDS, DOUBLE_CLICK } from './cli'
import { run, systemProgram } from './host'
import { boardAddress, runningServer, serve } from './http'
import type { InstallEnv } from './install'
import { describe, init, readLog, uninstall } from './install'
import { ct } from './messages'
import { prePushHook, skipPush } from './prepush'
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
    process.platform === 'win32' ? [systemProgram('rundll32.exe'), 'url.dll,FileProtocolHandler', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url]

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

/** One JSON line, for a program that runs init or uninstall for the person (the desktop mod's one-click setup, T-51). */
const sayJson = (value: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(value)}\n`)

COMMANDS.init = async args => {
  const isJson = args.includes('--json')
  const ref = await resolveProject(process.cwd())
  if (!ref) {
    if (isJson) sayJson({ error: 'notGit' })
    else process.stderr.write(`${ct('error.notGit', { path: process.cwd() })}\n`)

    return 1
  }
  const out = await init(ref, installEnv(), { yes: args.includes('--yes') || args.includes('-y'), ci: args.includes('--ci') }, isJson ? () => undefined : say)
  // --json: the list of changes (each as init words it), its notes, and what failed, in one line; else the words.
  if (isJson) sayJson({ project: ref.path, changes: out.changes, notes: out.notes, applied: out.applied.length, failed: out.failed })

  return out.failed.length ? 1 : 0
}

/** Whether two paths name the same file (Windows: in any case). */
function isSameFile(a: string, b: string): boolean {
  const norm = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))

  return norm(a) === norm(b)
}

/** The console window a double-click opens: a line written, and Enter pressed (true) or stdin ended (false). */
export type ClickConsole = { write: (text: string) => void; enter: () => Promise<boolean> }

/**
 * A double-click on the program (T-52): Windows closes its console window as soon as the program ends, so it waits.
 * Not set up: what init would change (init's own list), then Enter to set up (init --yes) or the window closed to
 * cancel. Set up already (this project, or outside a project any): the board (open). Outside a git project with
 * nothing set up: init's own words for that, and how to go on. Set up from a downloaded program: it is copied to
 * ~/.project-pm/bin, so the download can be deleted. Each ends waiting for Enter, so the words stay.
 */
export async function doubleClick(cwd: string, ie: InstallEnv, console: ClickConsole, open: () => Promise<number> = () => COMMANDS.open!([])): Promise<number> {
  const ref = await resolveProject(cwd)
  const { entries } = await readLog(ie.env)
  let code: number
  if (ref ? entries.some(e => e.project === ref.key) : entries.length > 0) {
    console.write(ct('click.setUp'))
    code = await open()
  } else if (!ref) {
    console.write(ct('error.notGit', { path: cwd }))
    console.write(ct('click.notGit'))
    code = 1
  } else {
    // init's list as a dry run prints it, but its last line (run init --yes): Enter stands for that here.
    const dryRun = ct('init.dryRun')
    await init(ref, ie, { yes: false, ci: false }, text => text !== dryRun && console.write(text))
    console.write(ct('click.ask'))
    if (!(await console.enter())) return 1
    // The list is on screen already: of the run, only its last words (done, or what did not work).
    const said: string[] = []
    const out = await init(ref, ie, { yes: true, ci: false }, text => said.push(text))
    console.write(said.at(-1) ?? '')
    code = out.failed.length ? 1 : 0
    // The copy in ~/.project-pm/bin is the one that runs from now on: the downloaded file can go, and is not committed.
    const copy = out.applied.find(done => done.kind === 'copy')
    if (!code && copy && ie.exe && !isSameFile(copy.file, ie.exe)) console.write(ct('click.copied', { folder: dirname(copy.file) }))
  }
  console.write(ct('click.close'))
  await console.enter()

  return code
}

DOUBLE_CLICK.run = async () => {
  const lines = createInterface({ input: process.stdin })
  const waiting: ((isPressed: boolean) => void)[] = []
  let isClosed = false
  lines.on('line', () => waiting.shift()?.(true))
  lines.on('close', () => {
    isClosed = true
    for (const done of waiting.splice(0)) done(false)
  })
  const console: ClickConsole = {
    write: say,
    enter: () => (isClosed ? Promise.resolve(false) : new Promise(done => waiting.push(done))),
  }
  try {
    return await doubleClick(process.cwd(), installEnv(), console)
  } finally {
    lines.close()
  }
}

COMMANDS.uninstall = async args => {
  const isJson = args.includes('--json')
  const ref = await resolveProject(process.cwd())
  const ie = installEnv()
  const notes: string[] = []
  const collect = (text: string) => {
    if (text.startsWith('! ')) notes.push(text.slice(2))
  }
  const undone = await uninstall(ref, ie, { yes: args.includes('--yes') || args.includes('-y'), hooksOnly: args.includes('--hooks') }, isJson ? collect : say)
  if (!isJson) return 0
  // --json: what is still in the log for this project could not be undone.
  const left = ref ? (await readLog(ie.env)).entries.filter(e => e.project === ref.key).map(e => describe(e).split('\n')[0]!) : []
  sayJson({ undone, notes, failed: left })

  return left.length ? 1 : 0
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
  const ref = await resolveProject(process.cwd())
  if (!ref) {
    // Nowhere to keep it for the board, but never in silence.
    process.stderr.write(`${ct('push.noProject')}\n`)

    return 0
  }
  // A push the PM cannot check goes through, said here and kept for the board (prePushHook).
  const out = await prePushHook(ref, input, run)
  if (out.stderr) process.stderr.write(`${out.stderr}\n`)

  return out.code
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
