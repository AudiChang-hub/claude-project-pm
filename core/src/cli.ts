/** `project-pm <command>` (docs/design/v1-core.md 1.2): one program for the MCP server, the board, the hooks and the checks. */
import { hookMain } from './hook'
import { McpSession, serveStdio } from './mcp'
import { ct, initLang } from './messages'
import { newCtx } from './context'
import type { Ctx, ToolResult } from './context'
import { boardTool } from './tools'
import { VERSION } from './version'

export type Command = (args: string[]) => Promise<number>

/** What a double-click on the program runs (commands.ts sets it, T-52). */
export const DOUBLE_CLICK: { run?: () => Promise<number> } = {}

/** Commands added by later parts of the core (serve, init, the git checks) register here. */
export const COMMANDS: Record<string, Command> = {
  mcp: async () => {
    await serveStdio(new McpSession())

    return 0
  },
  board: async args => {
    const out = await boardCommand(newCtx({ actor: 'cli', tool: 'cli' }), args)
    ;(out.isError ? process.stderr : process.stdout).write(`${out.text}\n`)

    return out.isError ? 1 : 0
  },
  hook: async args => hookMain(args[0] ?? 'claude-code', args[1] ?? ''),
}

/**
 * What `project-pm board` prints: in a terminal, the board as people read it (sessions by name, T-46); with --json,
 * the JSON the web board reads, ids included, for programs.
 */
export async function boardCommand(ctx: Ctx, args: string[]): Promise<{ text: string; isError: boolean }> {
  const isJson = args.includes('--json')
  const out: ToolResult = await boardTool(ctx, { scope: args.includes('--all') ? 'all' : 'project', include_done: args.includes('--done') }, !isJson)

  return { text: isJson ? JSON.stringify(out.structured, null, 2) : out.text, isError: out.isError === true }
}

/** `isTerminal`: stdin is a terminal, as in the console window a double-click on the program opens (T-52). */
export async function main(argv: string[], isTerminal = process.stdin.isTTY === true): Promise<number> {
  initLang()
  const [command, ...args] = argv
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${VERSION}\n`)

    return 0
  }
  if (!command && isTerminal && DOUBLE_CLICK.run) return DOUBLE_CLICK.run()
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
