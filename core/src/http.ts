/**
 * `project-pm serve` (docs/design/v1-core.md 1.2, 4): the web board and Streamable HTTP MCP on one local server.
 *
 * Security (4.2): it listens on 127.0.0.1 only; every API and MCP request needs the token kept in server.json (only
 * the person can read it); the Host header must name this server (DNS rebinding); /mcp and /api refuse a foreign
 * Origin; answers carry a strict CSP and nosniff, never CORS. The page reads the token from the URL's fragment, which
 * never reaches a server or a Referer, and sends it as a header.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, readdir } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { getLang } from '../../hooks/messages'
import type { Ctx } from './context'
import { newCtx } from './context'
import { run as hostRun } from './host'
import { McpSession, handleText } from './mcp'
import { projectRefOf } from './project'
import { paths, readJsonFile, writeAtomic } from './store'
import { boardOf } from './tools'
import type { CoreProject } from './types'
import { VERSION } from './version'
import { ASSETS } from './web/assets.generated'

export const DEFAULT_PORT = 47130
const PORT_TRIES = 20
/** A server nobody has asked anything for this long stops (4.3). */
export const IDLE_MS = 30 * 60_000
const MAX_BODY = 1024 * 1024

export type ServerInfo = { port: number; token: string; pid: number; startedAt: number; version: string }

export type Served = { server: Server; info: ServerInfo; close: () => Promise<void> }

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra })
  res.end(body)
}

function json(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}) {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8', extra)
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(token)

  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Makes server.json readable by the person alone: mode 600, or on Windows an ACL that grants only them. */
async function lockDown(file: string) {
  if (process.platform !== 'win32') {
    await chmod(file, 0o600)

    return
  }
  const user = process.env.USERNAME
  if (!user) return
  const who = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user
  await hostRun(['icacls', file, '/inheritance:r', '/grant:r', `${who}:F`], process.cwd(), 10_000)
}

/** The project the page asks about (its key), or every project the core keeps. */
async function projectsKept(ctx: Ctx): Promise<CoreProject[]> {
  const dir = join(paths(ctx.env).home, 'projects')
  const names = (await readdir(dir).catch(() => [] as string[])).filter(name => name.endsWith('.json'))
  const kept: CoreProject[] = []
  for (const name of names) {
    const one = await readJsonFile<CoreProject>(join(dir, name)).catch(() => null)
    if (one?.path && one.key) kept.push(one)
  }

  return kept
}

export type ServeOptions = { port?: number; env?: NodeJS.ProcessEnv; idleMs?: number; ctx?: Partial<Ctx>; onIdle?: () => void }

/** Starts the server, writes server.json, and answers until closed (or idle for IDLE_MS). */
export async function serve(options: ServeOptions = {}): Promise<Served> {
  const env = options.env ?? process.env
  const ctx = newCtx({ actor: 'web', tool: 'web', env, ...options.ctx })
  const token = randomBytes(32).toString('base64url')
  const sessions = new Map<string, McpSession>()
  let lastUsed = Date.now()
  let port = 0

  const isOwnHost = (host: string | undefined) => host === `127.0.0.1:${port}` || host === `localhost:${port}`
  const isOwnOrigin = (origin: string | undefined) => !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
  const tokenOf = (req: IncomingMessage) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? ''

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    lastUsed = Date.now()
    if (!isOwnHost(req.headers.host)) return send(res, 403, 'Forbidden host', 'text/plain; charset=utf-8')
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const path = url.pathname
    const asset = ASSETS[path === '/' ? '/index.html' : path]
    if (req.method === 'GET' && asset) return send(res, 200, asset.body, asset.type, { 'Cache-Control': 'no-cache' })
    if (path === '/mcp' || path.startsWith('/api/')) {
      if (!isOwnOrigin(req.headers.origin as string | undefined)) return json(res, 403, { error: 'forbidden_origin' })
      if (!sameToken(tokenOf(req), token)) return json(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' })
    }
    if (path === '/mcp') return mcp(req, res)
    if (path === '/api/projects' && req.method === 'GET') {
      const kept = await projectsKept(ctx)

      return json(res, 200, { lang: getLang(), version: VERSION, projects: kept.map(p => ({ key: p.key, name: p.name, path: p.path, revision: p.revision ?? 0, open: p.ledger.filter(i => i.status === 'open').length })) })
    }
    if (path === '/api/board' && req.method === 'GET') {
      const kept = await projectsKept(ctx)
      const key = url.searchParams.get('p')
      const chosen = kept.find(p => p.key === key) ?? (key ? undefined : kept[0])
      if (!chosen) return json(res, 404, { error: 'no_project', lang: getLang() })
      const { json: board } = await boardOf(ctx, projectRefOf(chosen.path), url.searchParams.get('done') === '1')
      const body = JSON.stringify({ ...board, lang: getLang() })
      const tag = `"${createHash('sha1').update(body).digest('base64url')}"`
      if (req.headers['if-none-match'] === tag) {
        res.writeHead(304, { ...SECURITY_HEADERS, ETag: tag, 'Cache-Control': 'no-cache' })

        return res.end()
      }

      return send(res, 200, body, 'application/json; charset=utf-8', { ETag: tag, 'Cache-Control': 'no-cache' })
    }

    return send(res, 404, 'Not found', 'text/plain; charset=utf-8')
  }

  /** Streamable HTTP: POST answers in JSON (never an SSE stream), GET is 405, DELETE ends the session. */
  const mcp = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') return send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8', { Allow: 'POST, DELETE' })
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (req.method === 'DELETE') {
      if (sessionId) sessions.delete(sessionId)

      return send(res, 200, '', 'text/plain; charset=utf-8')
    }
    if (req.method !== 'POST') return send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8', { Allow: 'POST, DELETE' })
    let body: string
    try {
      body = await readBody(req)
    } catch {
      return json(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } })
    }
    let session = sessionId ? sessions.get(sessionId) : undefined
    let newId: string | null = null
    if (!session) {
      const isInitialize = /"method"\s*:\s*"initialize"/.test(body)
      if (sessionId || !isInitialize) return json(res, sessionId ? 404 : 400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: sessionId ? 'Session not found' : 'Missing Mcp-Session-Id' } })
      newId = randomBytes(16).toString('hex')
      session = new McpSession({ env, run: options.ctx?.run, now: options.ctx?.now })
      sessions.set(newId, session)
    }
    const answer = await handleText(session, body)
    const headers: Record<string, string> = newId ? { 'Mcp-Session-Id': newId } : {}
    if (!answer) {
      res.writeHead(202, { ...SECURITY_HEADERS, ...headers })

      return res.end()
    }

    return json(res, 200, answer, headers)
  }

  const server = createServer((req, res) => {
    handler(req, res).catch(err => {
      if (!res.headersSent) json(res, 500, { error: 'internal', message: err instanceof Error ? err.message : String(err) })
      else res.end()
    })
  })
  server.keepAliveTimeout = 5_000

  const start = options.port ?? (Number(env.PROJECT_PM_PORT) || DEFAULT_PORT)
  for (let attempt = 0; ; attempt++) {
    const tryPort = start === 0 ? 0 : start + attempt
    let failure: NodeJS.ErrnoException | null = null
    const ok = await new Promise<boolean>(resolve => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') failure = err
        resolve(false)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(tryPort, '127.0.0.1')
    })
    if (ok) break
    if (failure) throw failure
    if (start === 0 || attempt >= PORT_TRIES) throw new Error(`no free port from ${start}`)
  }
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : start
  const info: ServerInfo = { port, token, pid: process.pid, startedAt: Date.now(), version: VERSION }
  const file = paths(env).server
  await writeAtomic(file, JSON.stringify(info))
  await lockDown(file).catch(() => {})

  const idleMs = options.idleMs ?? IDLE_MS
  const timer = setInterval(() => {
    if (Date.now() - lastUsed >= idleMs) {
      void close()
      options.onIdle?.()
    }
  }, Math.min(60_000, Math.max(1_000, idleMs / 4)))
  timer.unref()
  let isClosed = false
  const close = async () => {
    if (isClosed) return
    isClosed = true
    clearInterval(timer)
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
    // Leave server.json to the next server unless it is still ours.
    const kept = await readJsonFile<ServerInfo>(file).catch(() => null)
    if (kept?.token === token) await writeAtomic(file, JSON.stringify({ ...kept, pid: 0 })).catch(() => {})
  }

  return { server, info, close }
}

/** The running server's details, when its process is still alive. */
export async function runningServer(env: NodeJS.ProcessEnv = process.env): Promise<ServerInfo | null> {
  const info = await readJsonFile<ServerInfo>(paths(env).server).catch(() => null)
  if (!info?.pid || !info.port || !info.token) return null
  try {
    process.kill(info.pid, 0)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return null
  }
  // The process id may have gone to another program since: the server itself must answer.
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/favicon.svg`, { signal: AbortSignal.timeout(1500) })

    return res.ok ? info : null
  } catch {
    return null
  }
}

export function boardAddress(info: ServerInfo, key?: string): string {
  return `http://127.0.0.1:${info.port}/#t=${info.token}${key ? `&p=${encodeURIComponent(key)}` : ''}`
}
