/**
 * The MCP server's protocol (docs/design/v1-core.md 1.2, 3.1): JSON-RPC 2.0 messages in, answers out, shared by
 * the stdio and the Streamable HTTP transports. Written by hand, without the SDK, so the single executable carries
 * no dependency: the server only answers initialize, ping, tools/list and tools/call.
 */
import { fileURLToPath } from 'node:url'

import { t } from '../../hooks/messages'
import type { Ctx, ToolResult } from './context'
import { newCtx } from './context'
import { connectionActor, toolName } from './identity'
import { ct } from './messages'
import { boardTool, ledgerTool, pmTool, reportTool } from './tools'
import { VERSION } from './version'

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

type Json = Record<string, unknown>
export type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Json; result?: unknown; error?: unknown }

const OBJECT = { type: 'object', additionalProperties: true } as const
const project = () => ({ type: 'string', description: ct('tool.project') })

/**
 * Whether tools answer with structuredContent and declare outputSchema. Off by default: Claude Code 2.1.326 hands the
 * model the structured JSON instead of the text when both are there, and the text is what the board is written for
 * (measured 2026-11-19). The same JSON stays at the web board's /api/board and `project-pm board --json`;
 * PROJECT_PM_STRUCTURED=1 turns it back on for clients that want it.
 */
export function isStructured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROJECT_PM_STRUCTURED === '1'
}

/** The tools as tools/list shows them, in the language the core speaks. */
export function toolDefinitions(env: NodeJS.ProcessEnv = process.env) {
  const tools = [
    {
      name: 'board',
      description: t('tool.board.description'),
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['project', 'all'], description: t('tool.board.scope') },
          include_done: { type: 'boolean', description: t('tool.board.includeDone') },
          project: project(),
        },
      },
      outputSchema: OBJECT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'ledger',
      description: t('tool.ledger.description'),
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'list'] },
          id: { type: 'number', description: t('tool.ledger.id') },
          include_done: { type: 'boolean', description: t('tool.ledger.includeDone') },
          text: { type: 'string', description: t('tool.ledger.text') },
          owner: { type: 'string', description: t('tool.ledger.owner') },
          status: { type: 'string', enum: ['open', 'done', 'dropped'] },
          note: { type: 'string', description: t('tool.ledger.note') },
          criteria: { type: 'string', description: t('tool.ledger.criteria') },
          qa: { type: 'string', enum: ['pass', 'fail', 'skip'], description: t('tool.ledger.qa') },
          qa_by: { type: 'string', description: t('tool.ledger.qaBy') },
          qa_note: { type: 'string', description: t('tool.ledger.qaNote') },
          qa_sha: { type: 'string', description: ct('tool.ledger.qaSha') },
          commit: { type: 'string', description: ct('tool.ledger.commit') },
          force: { type: 'boolean', description: t('tool.ledger.force') },
          project: project(),
        },
        required: ['action'],
      },
      outputSchema: OBJECT,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: 'report',
      description: t('tool.report.description'),
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['done', 'in_progress', 'blocked', 'waiting_user', 'waiting_ci', 'waiting_release'], description: t('tool.report.status') },
          summary: { type: 'string', description: t('tool.report.summary') },
          delivery: { type: 'string', enum: ['not_needed', 'released', 'pending'], description: t('tool.report.delivery') },
          commit: { type: 'string', description: t('tool.report.commit') },
          ci: { type: 'string', description: t('tool.report.ci') },
          next: { type: 'string', description: t('tool.report.next') },
          detail: { type: 'string', description: t('tool.report.detail') },
          actor: { type: 'string', description: ct('tool.report.actor') },
          item: { type: 'number', description: ct('tool.report.item') },
          title: { type: 'string', description: ct('tool.report.title') },
          project: project(),
        },
        required: ['status', 'summary'],
      },
      outputSchema: OBJECT,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: 'pm',
      description: ct('tool.pm.description'),
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['claim', 'release', 'status'], description: ct('tool.pm.action') }, project: project() },
        required: ['action'],
      },
      outputSchema: OBJECT,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
  ]

  return isStructured(env) ? tools : tools.map(({ outputSchema, ...tool }) => (void outputSchema, tool))
}

const TOOLS: Record<string, (ctx: Ctx, input: Json) => Promise<ToolResult>> = { board: boardTool, ledger: ledgerTool, report: reportTool, pm: pmTool }

/** One MCP connection: who connected (initialize), and the tools it calls. */
export class McpSession {
  ctx: Ctx | null = null
  clientName = ''
  /** How a request reaches the client (stdio); without it the server asks the client nothing (HTTP). */
  send: ((message: JsonRpc) => void) | null = null
  private canAskRoots = false
  private rootsAsked: Promise<string[]> | null = null
  private readonly waiting = new Map<string, (message: JsonRpc) => void>()
  private asked = 0
  constructor(private readonly base: Partial<Ctx> = {}) {}

  /** The answer to one message, or null for a notification (and for an answer the client sent us). */
  async handle(message: JsonRpc): Promise<JsonRpc | null> {
    const id = message.id
    const isRequest = id !== undefined && id !== null && typeof message.method === 'string'
    if (!isRequest) {
      if (message.method === undefined && id !== undefined && id !== null) this.waiting.get(String(id))?.(message)
      // The client's folders changed: ask again when a call needs them.
      else if (message.method === 'notifications/roots/list_changed') this.rootsAsked = null

      return null
    }
    try {
      const result = await this.answer(message.method!, message.params ?? {})

      return { jsonrpc: '2.0', id, result }
    } catch (err) {
      const rpc = err instanceof RpcError ? err : new RpcError(-32603, err instanceof Error ? err.message : String(err))

      return { jsonrpc: '2.0', id, error: { code: rpc.code, message: rpc.message } }
    }
  }

  private context(): Ctx {
    this.ctx ??= this.newContext('mcp')

    return this.ctx
  }

  private newContext(name: string): Ctx {
    const tool = toolName(name)

    return newCtx({ roots: () => this.roots(), ...this.base, tool, actor: this.base.actor ?? connectionActor(tool, this.base.env ?? process.env) })
  }

  /** The client's roots as folders (3.1): asked once, and again after it says they changed; none within 3 s is none. */
  roots(): Promise<string[]> {
    if (!this.canAskRoots || !this.send) return Promise.resolve([])
    this.rootsAsked ??= new Promise<string[]>(resolve => {
      const id = `project-pm-${++this.asked}`
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        resolve([])
      }, 3_000)
      timer.unref?.()
      this.waiting.set(id, message => {
        clearTimeout(timer)
        this.waiting.delete(id)
        // Whatever the client sent, the question is settled here: a call waiting for the roots must not wait for ever.
        try {
          resolve(rootFolders(message.result))
        } catch {
          resolve([])
        }
      })
      this.send!({ jsonrpc: '2.0', id, method: 'roots/list' })
    })

    return this.rootsAsked
  }

  private async answer(method: string, params: Json): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const info = (params.clientInfo ?? {}) as { name?: string }
        this.clientName = info.name ?? ''
        this.canAskRoots = !!(params.capabilities as { roots?: unknown } | undefined)?.roots
        this.rootsAsked = null
        this.ctx = this.newContext(this.clientName)
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0]

        return { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'project-pm', version: VERSION } }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: toolDefinitions(this.context().env) }
      case 'tools/call': {
        const ctx = this.context()
        const name = typeof params.name === 'string' ? params.name : ''
        const tool = TOOLS[name]
        if (!tool) throw new RpcError(-32602, ct('error.unknownTool', { name }))
        const input = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Json) : {}
        const out = await tool(ctx, input)

        const answer = { content: [{ type: 'text', text: out.text }], isError: out.isError === true }

        return isStructured(ctx.env) ? { ...answer, structuredContent: out.structured } : answer
      }
      default:
        throw new RpcError(-32601, `Method not found: ${method}`)
    }
  }
}

/**
 * The folders in a roots/list answer: roots that are not a list are none, and a root that is not a file URL this
 * system can read (an encoded slash, a host on POSIX) is left out on its own.
 */
function rootFolders(result: unknown): string[] {
  const roots = result && typeof result === 'object' ? (result as { roots?: unknown }).roots : undefined
  if (!Array.isArray(roots)) return []

  return roots.flatMap(root => {
    try {
      const uri = root && typeof root === 'object' ? (root as { uri?: unknown }).uri : undefined

      return typeof uri === 'string' && uri.startsWith('file:') ? [fileURLToPath(uri)] : []
    } catch {
      return []
    }
  })
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

/** A line or a body as JSON-RPC: one message or a batch; a parse error answers as JSON-RPC does. */
export async function handleText(session: McpSession, text: string): Promise<JsonRpc | JsonRpc[] | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
  }
  if (Array.isArray(parsed)) {
    const answers = (await Promise.all(parsed.map(one => session.handle(one as JsonRpc)))).filter((a): a is JsonRpc => a !== null)

    return answers.length ? answers : null
  }
  if (!parsed || typeof parsed !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }

  return session.handle(parsed as JsonRpc)
}

/** Whether a line is an answer the client sent to a request of ours (no method, an id). */
function isAnswer(line: string): boolean {
  try {
    const one = JSON.parse(line) as JsonRpc

    return !!one && typeof one === 'object' && !Array.isArray(one) && one.method === undefined && one.id !== undefined && one.id !== null
  } catch {
    return false
  }
}

/** The stdio transport: one JSON message per line in, one per line out; nothing else is ever written to stdout. */
export function serveStdio(session: McpSession, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  return new Promise(resolve => {
    let buffer = ''
    let pending = Promise.resolve()
    input.setEncoding?.('utf8')
    session.send = message => output.write(`${JSON.stringify(message)}
`)
    input.on('data', (chunk: string) => {
      buffer += chunk
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (!line) continue
        // The client's answer to our own request (roots/list) is taken at once: a call queued below may wait for it.
        if (isAnswer(line)) {
          // An answer that goes wrong must not take the server down with it.
          handleText(session, line).catch(() => undefined)
          continue
        }
        // Answers go out in the order the messages came in.
        pending = pending
          .then(async () => {
            const answer = await handleText(session, line)
            if (answer) output.write(`${JSON.stringify(answer)}\n`)
          })
          // One message that goes wrong must not stop the ones after it.
          .catch(() => undefined)
      }
    })
    input.on('end', () => {
      void pending.then(() => resolve())
    })
  })
}
