// One-click setup (T-51): a person who installed only the mod sets a project up with one button, and types no command.
// The mod gets the core's program of its own version from the project's GitHub release, checks it against the
// release's SHA256SUMS, shows what `init` would change, and runs `init --yes` on 設定; 移除設定 runs `uninstall --yes`.
//
// The mod's own `$.http.fetch` hands a body over as text and `$.fs.write` writes text only, so neither can carry a
// 100 MB program. The download goes through the system's own curl (by its full path: System32 on Windows, /usr/bin on
// macOS and Linux), one hop at a time: every address on the way must be https on one of GitHub's own hosts (GITHUB_HOSTS),
// so a redirect elsewhere stops it. Nothing is run before its SHA-256 matches; a file that does not match is emptied.
// What the core prints is never shown whole: only the list of changes and its notes, from `--json`.

import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { Notice, Setup, SetupError } from '../types'
import { CORE_SERVER, coreHome, forgetCore, markSetUpHere } from './core'
import { getLang, t } from './messages'
import { Sha256, fromBase64 } from './sha256'
import { isPlainProgram } from './webboard'

const notice = atom({ plugin: 'project-pm', key: 'notice' } as const, null as Notice | null)
/** Setup before it is checked. */
export const NO_SETUP: Setup = { phase: 'unknown', project: '', changes: [], notes: [], error: null, failed: [] }
const setup = atom({ plugin: 'project-pm', key: 'setup' } as const, NO_SETUP)

/** The release the program comes from. */
export const REPO = 'AudiChang-hub/claude-project-pm'
/** The only hosts a download may reach: the release's address, and the two GitHub serves its files from. */
export const GITHUB_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'] as const
/** The most redirects a download follows (GitHub uses one). */
const MAX_HOPS = 4
/** How long one download may take: the program is about 100 MB. */
const DOWNLOAD_MS = 9 * 60_000
/** How long `init` may take (it asks Claude Code for its MCP list) and `uninstall`. */
const INIT_MS = 3 * 60_000
/** How much of the program one read takes: `$.fs.read`'s most. */
const CHUNK = 4 * 1024 * 1024
/** The most a download may bring: the program (about 100 MB today), and SHA256SUMS (a few hundred bytes). */
export const MAX_PROGRAM_BYTES = 300 * 1024 * 1024
export const MAX_SUMS_BYTES = 64 * 1024

/** Whether `url` is https on one of GitHub's own hosts: no user part, no other port, nothing a shell would read. */
export function isGithubUrl(url: string): boolean {
  const at = /^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#][^\s"'`<>\\]*)?$/i.exec(url)

  return !!at && (GITHUB_HOSTS as readonly string[]).includes(at[1]!.toLowerCase())
}

/** The release file of the program for this computer, or null where the release has none. */
export function assetFor(platform: string | undefined, machine: string): string | null {
  const arm = /^(arm64|aarch64)$/i.test(machine.trim())
  if (platform === 'windows') return 'project-pm-windows-x64.exe'
  if (platform === 'macos') return arm ? 'project-pm-macos-arm64' : 'project-pm-macos-x64'
  if (platform === 'linux' || platform === 'wsl') return arm ? 'project-pm-linux-arm64' : /^(x86_64|amd64)$/i.test(machine.trim()) ? 'project-pm-linux-x64' : null

  return null
}

/** The SHA-256 SHA256SUMS gives for `asset` (sha256sum's lines: `<hex>  <name>`), or null. */
export function sumFor(sums: string, asset: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const at = /^([0-9a-f]{64}) [ *](\S+)$/i.exec(line.trim())
    if (at && at[2] === asset) return at[1]!.toLowerCase()
  }

  return null
}

/** What curl's exit code means for the person: it could not reach the network, or the download failed. */
export function curlFailure(exitCode: number): SetupError {
  // 5, 6: no name lookup (offline); 7: no connection; 28: timed out; 35, 56: the connection broke. 63 (over
  // --max-filesize) and the rest: the download failed.
  return [5, 6, 7, 28, 35, 56].includes(exitCode) ? 'offline' : 'download'
}

/** The JSON line `init --json` or `uninstall --json` printed last, or null. */
export function jsonOf(stdout: string): Record<string, unknown> | null {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? ''
  try {
    const value = JSON.parse(line) as unknown

    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])

/** Whether the core's install log records a change init made for this project (its key, as the core and the mod share it). */
export function isProjectSetUp(log: unknown, projectKey: string): boolean {
  const entries = log && typeof log === 'object' ? (log as { entries?: unknown }).entries : null

  return Array.isArray(entries) && entries.some(entry => !!entry && typeof entry === 'object' && (entry as { project?: unknown }).project === projectKey)
}

async function homeOf($: EngineInterface): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
}

/** This mod's version: the core's release of the same number is the one it gets. */
async function modVersion($: EngineInterface): Promise<string | null> {
  try {
    const { version } = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }

    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null
  } catch {
    return null
  }
}

/** The system's own curl, by its full path, or null. */
async function curlOf($: EngineInterface, platform: string | undefined): Promise<string | null> {
  if (platform === 'windows') {
    const root = (await $.env.get('SystemRoot'))?.trim()
    const file = root && isPlainProgram(root) ? `${root.replace(/[\\/]+$/, '')}\\System32\\curl.exe` : null

    return file && (await $.fs.exists(file)) ? file : null
  }

  return (await $.fs.exists('/usr/bin/curl')) ? '/usr/bin/curl' : null
}

/** This computer's processor, as uname names it (Windows: its program is x64, which ARM runs too). */
async function machineOf($: EngineInterface, platform: string | undefined): Promise<string> {
  if (platform === 'windows') return 'x86_64'
  const ran = await $.process.run(['/usr/bin/uname', '-m'], { timeoutMs: 10_000 }).catch(() => null)

  return ran?.exitCode === 0 ? ran.stdout.trim() : ''
}

/**
 * Downloads `url` to `file` with curl, one hop at a time: each address must be https on GitHub's hosts, and only a
 * 200 answer is kept, of at most `maxBytes` (curl stops past it, and what arrived is measured again). Null when it
 * arrived; else what went wrong.
 */
export async function download($: EngineInterface, curl: string, url: string, file: string, maxBytes: number): Promise<SetupError | null> {
  let at = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isGithubUrl(at)) return 'download'
    const argv = [curl, '--proto', '=https', '--tlsv1.2', '--silent', '--show-error', '--max-redirs', '0', '--connect-timeout', '20', '--max-time', String(DOWNLOAD_MS / 1000), '--max-filesize', String(maxBytes), '--create-dirs', '--output', file, '--write-out', '%{http_code} %{redirect_url}', at]
    const ran = await $.process.run(argv, { timeoutMs: DOWNLOAD_MS + 30_000 }).catch(() => null)
    if (!ran) return 'download'
    if (ran.exitCode !== 0) return curlFailure(ran.exitCode)
    const [code = '', next = ''] = ran.stdout.trim().split(/\s+/)
    if (code === '200') {
      const size = (await $.fs.stat(file).catch(() => null))?.size

      return size !== undefined && size <= maxBytes ? null : 'download'
    }
    if (!/^30[12378]$/.test(code) || !next) return 'download'
    at = next
  }

  return 'download'
}

/**
 * Whether the host's own network rules (the organization's web-fetch policy, which `$.http.fetch` is under and curl is
 * not) let the mod reach the release: the same address asked through `$.http.fetch`. A refusal there while curl gets
 * through is the policy's, and the download keeps to it (SetupError 'blocked').
 */
async function isReachableByHost($: EngineInterface, url: string): Promise<boolean> {
  return $.http.fetch(url).then(
    () => true,
    () => false,
  )
}

/** The SHA-256 of `file`, read in ranges (`$.fs.read` hands over 4 MiB at most). */
export async function sha256Of($: EngineInterface, file: string): Promise<string> {
  const { size } = await $.fs.stat(file)
  const hash = new Sha256()
  const decode = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64 ?? fromBase64
  for (let offset = 0; offset < size; offset += CHUNK) {
    const piece = await $.fs.read(file, { as: 'bytes', offset, length: Math.min(CHUNK, size - offset) })
    hash.update(decode(piece.base64))
  }

  return hash.hex()
}

/** A program checked against SHA256SUMS, kept in the store by its path, size and time, so it is not read again. */
type Checked = Record<string, { size: number; mtimeMs: number; sha: string }>
const CHECKED_KEY = 'coreChecked'

async function isStillChecked($: EngineInterface, file: string): Promise<boolean> {
  const checked = ((await $.store.get(CHECKED_KEY).catch(() => undefined)) ?? {}) as Checked
  const one = checked[file]
  if (!one) return false
  const now = await $.fs.stat(file).catch(() => null)

  return !!now && now.kind === 'file' && now.size === one.size && now.mtimeMs === one.mtimeMs
}

async function markChecked($: EngineInterface, file: string, sha: string) {
  const now = await $.fs.stat(file)
  const checked = ((await $.store.get(CHECKED_KEY)) ?? {}) as Checked
  await $.store.set(CHECKED_KEY, { ...checked, [file]: { size: now.size, mtimeMs: now.mtimeMs, sha } })
}

/** Where things are: the core's installed program (init's ~/.project-pm/bin), and where the mod downloads its own. */
type Places = { version: string; asset: string; installed: string; downloaded: string; curl: string | null; platform: string | undefined }

async function placesOf($: EngineInterface): Promise<Places | SetupError> {
  const version = await modVersion($)
  const info = await $.session.info().catch(() => null)
  const platform = info?.platform
  if (!version || info?.isHosted) return 'platform'
  const asset = assetFor(platform, await machineOf($, platform))
  if (!asset) return 'platform'
  const ext = platform === 'windows' ? '.exe' : ''
  const data = (await $.process.hookEnv().catch(() => ({}) as Record<string, string>)).CLAUDE_PLUGIN_DATA
  const folder = (data || `${await homeOf($)}/.claude/plugins/data/project-pm`).replace(/\\/g, '/').replace(/\/+$/, '')

  return {
    version,
    asset,
    installed: `${await coreHome($)}/bin/project-pm-${version}${ext}`,
    downloaded: `${folder}/core/project-pm-${version}${ext}`,
    curl: await curlOf($, platform),
    platform,
  }
}

/**
 * The program to run, checked: the installed one when it is there, else the downloaded one, downloaded now when it is
 * not there yet. Each is run only once its SHA-256 matches the release's SHA256SUMS.
 */
async function programOf($: EngineInterface, places: Places): Promise<string | SetupError> {
  for (const file of [places.installed, places.downloaded]) if (await isStillChecked($, file)) return file
  if (!places.curl) return 'download'
  const base = `https://github.com/${REPO}/releases/download/v${places.version}`
  const sumsFile = `${places.downloaded.replace(/[^/]+$/, '')}SHA256SUMS`
  const isAllowed = await isReachableByHost($, `${base}/SHA256SUMS`)
  const failed = await download($, places.curl, `${base}/SHA256SUMS`, sumsFile, MAX_SUMS_BYTES)
  if (failed) return failed
  // The network works (curl got through) but the host refused the address: its policy, which the download keeps to.
  if (!isAllowed) return 'blocked'
  const expected = sumFor(await $.fs.read(sumsFile).catch(() => ''), places.asset)
  if (!expected) return 'download'
  // The installed program (init copied it from a download of its own) is taken when it matches; else ours.
  if ((await $.fs.exists(places.installed)) && (await sha256Of($, places.installed).catch(() => '')) === expected) {
    await markChecked($, places.installed, expected)

    return places.installed
  }
  const got = await download($, places.curl, `${base}/${places.asset}`, places.downloaded, MAX_PROGRAM_BYTES)
  if (got) {
    // Whatever part of it came is never run (it is not checked), and is emptied.
    await $.fs.write(places.downloaded, '').catch(() => undefined)

    return got
  }
  if ((await sha256Of($, places.downloaded).catch(() => '')) !== expected) {
    // Never run, and nothing left that could be: what came is emptied.
    await $.fs.write(places.downloaded, '').catch(() => undefined)

    return 'checksum'
  }
  if (places.platform !== 'windows') {
    const made = await $.process.run(['/bin/chmod', '755', places.downloaded], { timeoutMs: 10_000 }).catch(() => null)
    if (made?.exitCode !== 0) return 'download'
  }
  await markChecked($, places.downloaded, expected)

  return places.downloaded
}

/** Runs the core with `args`, in the project's folder and the mod's language. */
async function runCore($: EngineInterface, program: string, args: string[], projectPath: string) {
  return $.process.run([program, ...args], { cwd: projectPath, env: { PROJECT_PM_LANG: getLang() }, timeoutMs: INIT_MS }).catch(() => null)
}

const busyPhases = new Set<Setup['phase']>(['fetching', 'applying', 'removing'])

/**
 * Where setup stands for this project: set up (init's log names it), or not, and then the program is got and init's
 * list read, so the pane can show what 設定 would change. Asked again for another project, or with `isRetry`.
 */
export async function checkSetup($: EngineInterface, projectPath: string, projectKey: string, isRetry = false): Promise<void> {
  const now = await read($, setup)
  if (busyPhases.has(now.phase)) return
  if (!isRetry && now.project === projectKey && now.phase !== 'unknown') return
  const log = await $.fs.read(`${await coreHome($)}/install-log.json`).then(text => JSON.parse(text) as unknown, () => null)
  if (isProjectSetUp(log, projectKey)) {
    await update($, setup, (): Setup => ({ phase: 'set', project: projectKey, changes: [], notes: [], error: null, failed: [] }))

    return
  }
  await preview($, projectPath, projectKey)
}

async function fail($: EngineInterface, projectKey: string, error: SetupError, failed: string[] = []) {
  await update($, setup, (s): Setup => ({ ...s, phase: 'failed', project: projectKey, error, failed }))
}

/** Gets the program and reads what init would change (`init --json`, which changes nothing). */
async function preview($: EngineInterface, projectPath: string, projectKey: string) {
  await update($, setup, (): Setup => ({ phase: 'fetching', project: projectKey, changes: [], notes: [], error: null, failed: [] }))
  const places = await placesOf($)
  if (typeof places === 'string') return fail($, projectKey, places)
  const program = await programOf($, places)
  if (program !== places.installed && program !== places.downloaded) return fail($, projectKey, program as SetupError)
  const ran = await runCore($, program, ['init', '--json'], projectPath)
  const out = ran ? jsonOf(ran.stdout) : null
  if (!out) return fail($, projectKey, 'init')
  if (out.error === 'notGit') return fail($, projectKey, 'notGit')
  await update($, setup, (): Setup => ({ phase: 'ready', project: projectKey, changes: texts(out.changes), notes: texts(out.notes), error: null, failed: [] }))
}

/** 設定: runs `init --yes`. The core's MCP server joins sessions started after it; this one keeps the mod's own tools. */
export async function applySetup($: EngineInterface, projectPath: string, projectKey: string): Promise<void> {
  const now = await read($, setup)
  if (now.phase !== 'ready' || now.project !== projectKey) return
  await update($, setup, (s): Setup => ({ ...s, phase: 'applying' }))
  const places = await placesOf($)
  if (typeof places === 'string') return fail($, projectKey, places)
  const program = await programOf($, places)
  if (program !== places.installed && program !== places.downloaded) return fail($, projectKey, program as SetupError)
  markSetUpHere()
  const ran = await runCore($, program, ['init', '--yes', '--json'], projectPath)
  const out = ran ? jsonOf(ran.stdout) : null
  forgetCore()
  const failed = texts(out?.failed)
  if (!out || failed.length || ran?.exitCode !== 0) return fail($, projectKey, 'init', failed)
  await update($, setup, (): Setup => ({ phase: 'done', project: projectKey, changes: [], notes: [], error: null, failed: [] }))
  // Claude Code may take the new server into this session too; when it does not, new sessions have it.
  await $.mcp.connect(CORE_SERVER).catch(() => undefined)
}

/** 移除設定: runs `uninstall --yes` with the installed program, which undoes everything init recorded for this project. */
export async function removeSetup($: EngineInterface, projectPath: string, projectKey: string): Promise<void> {
  const now = await read($, setup)
  if (busyPhases.has(now.phase)) return
  await update($, setup, (s): Setup => ({ ...s, phase: 'removing', project: projectKey, error: null, failed: [] }))
  const places = await placesOf($)
  if (typeof places === 'string') return fail($, projectKey, places)
  // The downloaded copy when it is checked (Windows does not let a running program delete itself), else as setup gets one.
  const program = (await isStillChecked($, places.downloaded)) ? places.downloaded : await programOf($, places)
  if (program !== places.installed && program !== places.downloaded) return fail($, projectKey, program as SetupError)
  const ran = await runCore($, program, ['uninstall', '--yes', '--json'], projectPath)
  const out = ran ? jsonOf(ran.stdout) : null
  forgetCore()
  const left = texts(out?.failed)
  if (!out || left.length) return fail($, projectKey, 'remove', left)
  await update($, notice, () => ({ tone: 'good', text: t('setup.removed') }))
  // Not set up any more: what 設定 would change is shown again.
  await preview($, projectPath, projectKey)
}
