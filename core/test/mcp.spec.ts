/**
 * The MCP server over stdio, as a real MCP client (the official SDK's) sees it: the program is started as an AI tool
 * starts it, and every tool is called through the protocol. No model is involved.
 */
import assert from 'node:assert/strict'
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
      assert.equal((closed.structuredContent!.item as { status: string }).status, 'done')
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
