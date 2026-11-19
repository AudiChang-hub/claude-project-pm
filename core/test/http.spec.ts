/**
 * `project-pm serve`: the web board's API and Streamable HTTP MCP, and the rules that keep them to the person
 * (docs/design/v1-core.md 4.2). Requests are made the way a browser or another program on the machine would.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { Served } from '../src/http'
import { boardAddress, runningServer, serve } from '../src/http'
import { paths } from '../src/store'
import { ledgerTool, pmTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, hostWith, world } from './helpers'

type Raw = { status: number; headers: Record<string, string | string[] | undefined>; body: string }

/** A raw request, so headers a browser would never let a page set (Host) can be forged. */
function raw(port: number, path: string, headers: Record<string, string>, method = 'GET', body?: string): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

for (const lang of LANGS) {
  describe(`serve (${lang})`, () => {
    let w: World
    let served: Served
    let port: number
    let token: string
    const host = () => ({ Host: `127.0.0.1:${port}` })
    const auth = () => ({ ...host(), Authorization: `Bearer ${token}` })
    beforeEach(async () => {
      w = world(lang)
      served = await serve({ port: 0, env: w.env, ctx: { run: hostWith(), cwd: w.repo } })
      port = served.info.port
      token = served.info.token
      await pmTool(w.ctx(), { action: 'claim' })
      await ledgerTool(w.ctx(), { action: 'add', text: 'Acme coupon field' })
    })
    afterEach(async () => {
      await served.close()
      w.done()
    })

    test('it listens on 127.0.0.1 only and keeps its token in server.json', async () => {
      const address = served.server.address()
      assert.equal(typeof address === 'object' && address?.address, '127.0.0.1')
      const kept = JSON.parse(readFileSync(paths(w.env).server, 'utf8'))
      assert.equal(kept.token, token)
      assert.equal(kept.port, port)
      assert.ok(token.length >= 43)
      assert.deepEqual(await runningServer(w.env), kept)
      assert.equal(boardAddress(kept, 'k'), `http://127.0.0.1:${port}/#t=${token}&p=k`)
    })

    test('without the token the API and MCP answer 401', async () => {
      assert.equal((await raw(port, '/api/board', host())).status, 401)
      assert.equal((await raw(port, '/api/board', { ...host(), Authorization: 'Bearer wrong' })).status, 401)
      assert.equal((await raw(port, '/mcp', host(), 'POST', '{}')).status, 401)
    })

    test('a forged Host is refused (DNS rebinding)', async () => {
      assert.equal((await raw(port, '/api/board', { ...auth(), Host: `evil.example:${port}` })).status, 403)
      assert.equal((await raw(port, '/', { Host: 'evil.example' })).status, 403)
    })

    test('a foreign Origin is refused on /mcp and /api', async () => {
      assert.equal((await raw(port, '/mcp', { ...auth(), Origin: 'https://evil.example', 'Content-Type': 'application/json' }, 'POST', '{}')).status, 403)
      assert.equal((await raw(port, '/api/board', { ...auth(), Origin: 'https://evil.example' })).status, 403)
      assert.equal((await raw(port, '/api/board', { ...auth(), Origin: `http://127.0.0.1:${port}` })).status, 200)
    })

    test('the page is served with a strict CSP, nosniff and no CORS', async () => {
      const page = await raw(port, '/', host())
      assert.equal(page.status, 200)
      assert.match(String(page.headers['content-security-policy']), /default-src 'self'.*frame-ancestors 'none'/)
      assert.equal(page.headers['x-content-type-options'], 'nosniff')
      assert.equal(page.headers['access-control-allow-origin'], undefined)
      assert.ok(page.body.includes('/app.js'))
      assert.ok(!/<script>[^<]/.test(page.body), 'no inline script')
    })

    test('the board answers JSON, and 304 while nothing changed', async () => {
      const first = await raw(port, '/api/board', auth())
      assert.equal(first.status, 200)
      const board = JSON.parse(first.body)
      assert.equal(board.lang, lang)
      assert.equal(board.items[0].text, 'Acme coupon field')
      const tag = String(first.headers.etag)
      assert.equal((await raw(port, '/api/board', { ...auth(), 'If-None-Match': tag })).status, 304)
      await ledgerTool(w.ctx(), { action: 'add', text: 'Shipping rates' })
      assert.equal((await raw(port, '/api/board', { ...auth(), 'If-None-Match': tag })).status, 200)
    })

    test('GET /mcp is 405; a request without a session is 400', async () => {
      assert.equal((await raw(port, '/mcp', auth())).status, 405)
      const res = await raw(port, '/mcp', { ...auth(), 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
      assert.equal(res.status, 400)
    })

    test('MCP over Streamable HTTP, through the official client', { timeout: 30_000 }, async () => {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
      const client = new Client({ name: 'codex', version: '1.0' })
      await client.connect(transport)
      try {
        const { tools } = await client.listTools()
        assert.deepEqual(tools.map(tool => tool.name).sort(), ['board', 'ledger', 'pm', 'report'])
        const out = (await client.callTool({ name: 'ledger', arguments: { action: 'list', project: w.repo } })) as { content: { text: string }[] }
        assert.ok(out.content[0]!.text.includes('Acme coupon field'))
      } finally {
        await client.close()
      }
    })
  })
}
