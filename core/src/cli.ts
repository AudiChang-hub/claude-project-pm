/** `project-pm <command>` (docs/design/v1-core.md 1.2): one program for the MCP server, the board, the hooks and the checks. */
import { hookMain } from './hook'
import { McpSession, serveStdio } from './mcp'
import { ct, initLang } from './messages'
import { newCtx } from './context'
import { boardTool } from './tools'
import { VERSION } from './version'

export type Command = (args: string[]) => Promise<number>

/** Commands added by later parts of the core (serve, init, the git checks) register here. */
export const COMMANDS: Record<string, Command> = {
  mcp: async () => {
    await serveStdio(new McpSession())

    return 0
  },
  board: async args => {
    const ctx = newCtx({ actor: 'cli', tool: 'cli' })
    const out = await boardTool(ctx, { scope: args.includes('--all') ? 'all' : 'project', include_done: args.includes('--done') })
    const said = args.includes('--json') ? JSON.stringify(out.structured, null, 2) : out.text
    ;(out.isError ? process.stderr : process.stdout).write(`${said}\n`)

    return out.isError ? 1 : 0
  },
  hook: async args => hookMain(args[0] ?? 'claude-code', args[1] ?? ''),
}

export async function main(argv: string[]): Promise<number> {
  initLang()
  const [command, ...args] = argv
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${VERSION}\n`)

    return 0
  }
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${ct('cli.usage')}\n`)

    return command ? 0 : 1
  }
  const run = COMMANDS[command]
  if (!run) {
    process.stderr.write(`${ct('cli.unknown', { command })}\n\n${ct('cli.usage')}\n`)

    return 2
  }

  return run(args)
}
