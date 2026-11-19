/** The commands beyond the MCP server, the board and the hooks: serve and open (the web board). */
import { spawn } from 'node:child_process'

import { COMMANDS } from './cli'
import { run } from './host'
import { boardAddress, runningServer, serve } from './http'
import { resolveProject } from './project'

/** How this program starts itself again: the single executable alone, or Node with its loader and the script. */
export function selfCommand(...args: string[]): { command: string; args: string[] } {
  let isSea = false
  try {
    // node:sea exists from Node 20; isSea() is true only inside a single executable.
    isSea = (process as unknown as { getBuiltinModule?: (id: string) => { isSea?: () => boolean } | undefined }).getBuiltinModule?.('node:sea')?.isSea?.() ?? false
  } catch {
    isSea = false
  }
  if (isSea) return { command: process.execPath, args }

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
