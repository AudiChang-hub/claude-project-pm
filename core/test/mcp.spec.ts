/**
 * The MCP server over stdio, as a real MCP client (the official SDK's) sees it: the program is started as an AI tool
 * starts it, and every tool is called through the protocol. No model is involved.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { t } from '../../hooks/messages'
import { McpSession, isStructured } from '../src/mcp'
import { VERSION } from '../src/version'
import type { World } from './helpers'
import { LANGS, hostWith, serverCommand, world } from './helpers'

const SESSION = '1f0ba5e3-d73c-4a06-ab9f-283b7537d1be'

type Called = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }

for (const lang of LANGS) {
  describe(`MCP over stdio (${lang})`, () => {
    let w: World
    let client: Client
    const connect = async (cwd: string, env: NodeJS.ProcessEnv = {}) => {
      const { command, args } = serverCommand('mcp')
      const transport = new StdioClientTransport({ command, args, cwd, env: { ...(w.env as Record<string, string>), PROJECT_PM_LANG: lang, CLAUDE_CODE_SESSION_ID: SESSION, PROJECT_PM_STRUCTURED: '1', ...(env as Record<string, string>) }, stderr: 'pipe' })
      client = new Client({ name: 'claude-code', version: '2.1.326' })
      await client.connect(transport)

      return client
    }
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Called
    beforeEach(() => {
      w = world(lang)
    })
    afterEach(async () => {
      await client?.close()
      w.done()
    })

    test('initialize names the server and its version; the four tools carry both schemas', { timeout: 60_000 }, async () => {
      await connect(w.repo)
      assert.deepEqual(client.getServerVersion(), { name: 'project-pm', version: VERSION })
      const { tools } = await client.listTools()
      assert.deepEqual(tools.map(tool => tool.name).sort(), ['board', 'ledger', 'pm', 'report'])
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object')
        assert.equal(tool.outputSchema?.type, 'object')
      }
      assert.equal(tools.find(tool => tool.name === 'board')!.description, t('tool.board.description'))
      await client.ping()
    })

    test('the actor is the Claude Code session, so its hooks and its tools meet', { timeout: 60_000 }, async () => {
      await connect(w.repo)
      const out = await call('pm', { action: 'claim' })
      assert.equal(out.isError, false)
      assert.equal(out.structuredContent!.pmId, `claude-code:${SESSION}`)
      assert.ok(out.content[0]!.text.includes(`claude-code:${SESSION}`))
    })

    test('ledger, the QA gate and the board, through the protocol', { timeout: 60_000 }, async () => {
      await connect(w.repo)
      await call('pm', { action: 'claim' })
      const added = await call('ledger', { action: 'add', text: 'Add the Acme coupon field', criteria: 'ACME10 takes 10% off' })
      assert.equal((added.structuredContent!.item as { code: string }).code, 'T-01')
      const refused = await call('ledger', { action: 'update', id: 1, status: 'done' })
      assert.equal(refused.isError, false)
      assert.ok(refused.content[0]!.text.startsWith(t('ledger.qaNone', { code: 'T-01' }).slice(0, 12)), refused.content[0]!.text)
      const closed = await call('ledger', { action: 'update', id: 1, status: 'done', qa: 'pass', qa_by: 'agent:qa1' })
      // An update answers in one line; its structured part is the item's id and revisions alone (T-48).
      assert.deepEqual(Object.keys(closed.structuredContent!).sort(), ['id', 'rev', 'revision'])
      const listed = await call('ledger', { action: 'list', id: 1 })
      assert.equal((listed.structuredContent!.item as { status: string }).status, 'done')
      const board = await call('board', { include_done: true })
      assert.deepEqual(board.structuredContent!.progress, { done: 1, total: 1 })
      assert.ok(board.content[0]!.text.includes('Add the Acme coupon field'))
    })

    test('outside a git repository a tool call is an error, said in words', { timeout: 60_000 }, async () => {
      await connect(w.home)
      const out = await call('report', { status: 'done', summary: 'x' })
      assert.equal(out.isError, true)
      assert.ok(out.content[0]!.text.length > 0)
    })

    test('by default a tool answers in words only, without an output schema (Claude Code shows structured JSON to the model)', { timeout: 60_000 }, async () => {
      await connect(w.repo, { PROJECT_PM_STRUCTURED: '' })
      const { tools } = await client.listTools()
      assert.ok(tools.every(tool => tool.outputSchema === undefined))
      const out = await call('board', {})
      assert.equal(out.structuredContent, undefined)
      assert.ok(out.content[0]!.text.length > 0)
    })

    test('without a project, the client\'s roots name it; without roots, the folder the server started in (3.1)', { timeout: 60_000 }, async () => {
      // Started outside any repository, as a tool may start its MCP servers from the home folder.
      const { command, args } = serverCommand('mcp')
      const transport = new StdioClientTransport({ command, args, cwd: w.home, env: { ...(w.env as Record<string, string>), PROJECT_PM_LANG: lang, CLAUDE_CODE_SESSION_ID: SESSION }, stderr: 'pipe' })
      let roots = [{ uri: pathToFileURL(w.root).href, name: 'not a repository' }, { uri: pathToFileURL(w.repo).href, name: 'Acme shop' }]
      client = new Client({ name: 'claude-code', version: '2.1.326' }, { capabilities: { roots: { listChanged: true } } })
      client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots }))
      await client.connect(transport)
      const added = await call('ledger', { action: 'add', text: 'Add the Acme coupon field' })
      assert.equal(added.isError, false, added.content[0]!.text)
      assert.ok(added.content[0]!.text.includes('T-01'))
      // The roots change: the next call follows them.
      roots = [{ uri: pathToFileURL(w.home).href, name: 'home' }]
      await client.sendRootsListChanged()
      const out = await call('board', {})
      assert.equal(out.isError, true)
    })

    test('a client without roots: the folder the server started in', { timeout: 60_000 }, async () => {
      await connect(w.repo)
      const out = await call('ledger', { action: 'add', text: 'Add the Acme coupon field' })
      assert.equal(out.isError, false, out.content[0]!.text)
    })

    test('an unknown tool is a protocol error', { timeout: 60_000 }, async () => {
      await connect(w.repo)
      await assert.rejects(client.callTool({ name: 'deploy', arguments: {} }))
    })
  })
}

test('the version is the package\'s', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(VERSION, pkg.version)
})

describe('the structuredContent switch (3.1, decided 2026-11-19)', () => {
  let w: World
  beforeEach(() => {
    w = world('en')
  })
  afterEach(() => w.done())
  const callBoard = async (env: NodeJS.ProcessEnv) => {
    const session = new McpSession({ cwd: w.repo, env, run: hostWith() })
    await session.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } })
    const listed = (await session.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))!.result as { tools: { outputSchema?: unknown }[] }
    const called = (await session.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'board', arguments: {} } }))!.result as Called

    return { listed, called }
  }

  test('unset, or anything but 1, is off: words only, no output schema', async () => {
    const { PROJECT_PM_STRUCTURED: _, ...rest } = w.env
    for (const env of [rest, { ...rest, PROJECT_PM_STRUCTURED: '0' }, { ...rest, PROJECT_PM_STRUCTURED: 'true' }]) {
      assert.equal(isStructured(env), false)
      const { listed, called } = await callBoard(env)
      assert.ok(listed.tools.every(tool => tool.outputSchema === undefined))
      assert.equal(called.structuredContent, undefined)
      assert.ok(called.content[0]!.text.includes('acme-shop'))
    }
  })

  test('PROJECT_PM_STRUCTURED=1 is on: the same words, plus the JSON and the output schema', async () => {
    const env = { ...w.env, PROJECT_PM_STRUCTURED: '1' }
    assert.equal(isStructured(env), true)
    const { listed, called } = await callBoard(env)
    assert.ok(listed.tools.every(tool => (tool.outputSchema as { type?: string } | undefined)?.type === 'object'))
    assert.equal((called.structuredContent!.project as { name: string }).name, 'acme-shop')
    assert.ok(called.content[0]!.text.includes('acme-shop'))
  })
})

describe('roots the client gets wrong (T-37 QA round 2, 1)', () => {
  let w: World
  beforeEach(() => {
    w = world('en')
  })
  afterEach(() => w.done())

  /**
   * A client that speaks raw JSON lines (the SDK's would check the roots it sends): it answers roots/list with `roots`,
   * then calls the board. The server is started outside any repository, so the roots are all it has to go on.
   */
  const callWithRoots = (roots: unknown) =>
    new Promise<{ answer: JsonRpcLine | null; code: number | null; stderr: string }>((resolve, reject) => {
      const { command, args } = serverCommand('mcp')
      const child = spawn(command, args, { cwd: w.home, env: { ...w.env, PROJECT_PM_LANG: 'en', CLAUDE_CODE_SESSION_ID: SESSION }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let out = ''
      let stderr = ''
      let answer: JsonRpcLine | null = null
      const timer = setTimeout(() => child.kill(), 20_000)
      const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`)
      child.stderr.on('data', chunk => (stderr += chunk))
      child.stdout.on('data', chunk => {
        out += chunk
        let at: number
        while ((at = out.indexOf('\n')) >= 0) {
          const message = JSON.parse(out.slice(0, at)) as JsonRpcLine
          out = out.slice(at + 1)
          if (message.method === 'roots/list') send({ jsonrpc: '2.0', id: message.id, result: { roots } })
          else if (message.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'board', arguments: {} } })
          else if (message.id === 2) {
            answer = message
            child.stdin.end()
          }
        }
      })
      child.on('error', reject)
      child.on('close', code => {
        clearTimeout(timer)
        resolve({ answer, code, stderr })
      })
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'claude-code', version: '2.1.326' } } })
    })

  const repoUri = () => pathToFileURL(w.repo).href

  for (const bad of ['file:///C:/acme%2Fshop', 'file://acme-host/srv/acme-shop', 'file:///srv/acme%2Fshop']) {
    test(`a root the server cannot read (${bad}) is left out; the good one still names the project`, { timeout: 60_000 }, async () => {
      const { answer, code, stderr } = await callWithRoots([{ uri: bad, name: 'Acme, written wrong' }, { uri: repoUri(), name: 'Acme shop' }])
      assert.equal(code, 0, stderr)
      assert.ok(answer, stderr)
      const result = answer.result as Called
      assert.equal(result.isError, false, result.content[0]!.text)
      assert.ok(result.content[0]!.text.includes('acme-shop'), result.content[0]!.text)
    })
  }

  for (const [label, roots] of [
    ['not a list', { uri: 'file:///srv/acme-shop' }],
    ['a string', 'file:///srv/acme-shop'],
    ['entries that are not objects', [null, 7, 'file:///srv/acme-shop']],
  ] as const) {
    test(`roots that are ${label}: none, and the call is still answered`, { timeout: 60_000 }, async () => {
      const { answer, code, stderr } = await callWithRoots(roots)
      assert.equal(code, 0, stderr)
      assert.ok(answer, stderr)
      // No roots and a home folder that is no repository: an error said in words, not a crash and not a wait.
      const result = answer.result as Called
      assert.equal(result.isError, true)
      assert.ok(result.content[0]!.text.length > 0)
    })
  }

  test('a roots answer that throws inside still settles the question: the next call does not wait for ever', async () => {
    const session = new McpSession({ cwd: w.home, env: w.env, run: hostWith() })
    const sent: JsonRpcLine[] = []
    session.send = message => sent.push(message as JsonRpcLine)
    await session.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { roots: {} }, clientInfo: { name: 'claude-code' } } })
    const asked = session.roots()
    const id = sent.find(message => message.method === 'roots/list')!.id
    // A roots list whose getter throws: the server must still answer itself.
    const roots = Object.defineProperty({}, 'roots', {
      get() {
        throw new Error('Acme client bug')
      },
    })
    await session.handle({ jsonrpc: '2.0', id, result: roots })
    assert.deepEqual(await Promise.race([asked, new Promise(resolve => setTimeout(() => resolve('still waiting'), 1_000))]), [])
  })
})

type JsonRpcLine = { jsonrpc: '2.0'; id?: string | number; method?: string; result?: unknown; error?: unknown }
