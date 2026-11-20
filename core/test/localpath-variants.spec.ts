/**
 * plainLocalPath against every spelling we can make (T-39 3). Tens of thousands of paths are built from prefixes,
 * slashes, letter case, . and .., doubled separators, trailing dots and spaces, 8.3 names, drive-relative paths,
 * GLOBALROOT, Volume{…} and host names; for each one plainLocalPath lets through, Node's own reading of it
 * (path.win32.toNamespacedPath(path.win32.resolve(…))) must be a plain drive path \\?\X:\…, and the very path
 * plainLocalPath gave. Runs on every system with path.win32. On Windows the system itself is asked too
 * ([System.IO.Path]::GetFullPath, which calls GetFullPathNameW, in one PowerShell): it must agree on every one.
 *
 * Every spelling the six QA rounds of T-37 found getting past the earlier checks is a fixed case below.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { win32 } from 'node:path'
import { describe, test } from 'node:test'

import { projectGuidelinesFile } from '../src/hook'
import { plainLocalPath } from '../src/localpath'
import { PROBE_HOST } from './helpers'

/**
 * The folders each spelling is read against. C:\Users\RUNNER~1 is the 8.3 name GitHub's Windows runners have, and
 * C:\PROGRA~1 the one most Windows machines have, so the system check meets a real short name on either (CI run
 * 44716640045 met it only on the runner).
 */
const CWDS = ['C:\\Users\\acme\\shop', 'C:\\Users\\RUNNER~1\\acme-shop', 'C:\\PROGRA~1\\acme-shop', 'd:\\work', `\\\\${PROBE_HOST}\\share\\shop`, '\\\\?\\C:\\Users\\acme']

/** Every combination of the parts below, with forward slashes and in upper case too. */
function variants(): string[] {
  const prefixes = ['', '\\', '/', '\\\\', '//', '\\/', '/\\', '\\\\?\\', '\\\\.\\', '\\??\\', '//?/', '//./', '\\\\\\', '  \\\\', ' ']
  const heads = [
    '',
    'C:',
    'c:',
    'Z:',
    'C:\\..',
    'C:\\..\\UNC',
    'UNC\\localhost\\C$',
    `UNC\\${PROBE_HOST}\\share`,
    'localhost\\C$',
    '127.0.0.1\\c$',
    `${PROBE_HOST}\\share`,
    'GLOBALROOT\\Device\\Mup\\localhost\\C$',
    'GLOBALROOT\\??\\C:',
    'Volume{00000000-0000-0000-0000-000000000000}',
    'pipe',
    'acme',
  ]
  const middles = ['', '\\Users', '\\.', '\\..', '\\..\\..', '\\x\\..\\..', '\\\\Users', '\\RUNNER~1', '\\acme.', '\\acme ', '\\acme. ', '\\...', '\\CON', '\\nul.txt', '\\COM1 .md', '\\a:b', '\\..\\UNC\\localhost\\C$']
  const tails = ['\\GUIDELINES.md', '', '\\', '\\GUIDELINES.md.', '\\GUIDELINES.md ', '\\GUIDELINES.md::$DATA', '\\GUIDELINES.md:hidden', '\\.\\GUIDELINES.md']
  const out = new Set<string>()
  for (const prefix of prefixes) {
    for (const head of heads) {
      for (const middle of middles) {
        for (const tail of tails) {
          const raw = `${prefix}${head}${middle}${tail}`
          out.add(raw)
          out.add(raw.replace(/\\/g, '/'))
          out.add(raw.toUpperCase())
        }
      }
    }
  }
  out.delete('')

  return [...out]
}

/** Spellings QA found getting past the checks of T-37 (reports a5793198…, a3180772…, a4d1d365…, acfffc5e…, a998fa25…). */
const QA_REFUSED = [
  // QA1–3: a drive-relative path, a URL for a folder.
  'C:Acme\\GUIDELINES.md',
  'C:x',
  'C:Windows',
  'C:相對\\GUIDELINES.md',
  'file:///C:/acme%2Fshop',
  'file://acme-host/srv/acme-shop',
  // QA5: shares, this machine's own disk as a share, long-path and device prefixes, streams, trimmed names.
  '\\\\192.0.2.1\\share\\GUIDELINES.md',
  '\\\\attacker\\share\\x.md',
  '\\\\localhost\\C$\\Users\\acme\\GUIDELINES.md',
  '\\\\127.0.0.1\\c$\\Users\\acme\\GUIDELINES.md',
  '\\\\?\\UNC\\localhost\\C$\\Users\\acme\\GUIDELINES.md',
  '\\\\?\\GLOBALROOT\\??\\C:\\Users\\acme\\GUIDELINES.md',
  '\\\\?\\C:\\Users\\acme\\GUIDELINES.md',
  '\\\\?\\C:\\Users\\acme\\GUIDELINES.md.',
  '\\\\.\\C:\\Users\\acme\\GUIDELINES.md',
  '\\\\?\\C:\\Users\\RUNNER~1\\GUIDELINES.md',
  'C:\\Users\\acme\\GUIDELINES.md::$DATA',
  'C:\\Users\\acme\\GUIDELINES.md.',
  'C:\\Users\\acme\\GUIDELINES.md ',
  // QA6: a drive device climbing out to a share, and the other device spellings.
  '\\\\.\\C:\\..\\UNC\\localhost\\C$\\Windows\\win.ini',
  '//./C:/../UNC/localhost/C$/Windows/win.ini',
  '\\\\.\\C:\\Windows\\..\\..\\UNC\\localhost\\C$\\x',
  '\\\\.\\C:\\x\\..\\..\\UNC\\localhost\\C$\\x',
  '\\\\?\\C:\\..\\UNC\\localhost\\C$\\x',
  `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
  '\\\\.\\UNC\\localhost\\C$\\x',
  '\\\\.\\pipe\\x',
  '\\\\.\\C:',
  '\\\\.\\C:\\',
  '\\\\?\\D:',
  '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\x',
  '\\\\?\\GLOBALROOT\\Device\\Mup\\localhost\\C$\\x',
  '  \\\\h\\s',
  '//h/s/x',
  '/\\h\\s',
  '\\/h/s',
  '//?/UNC/h/s',
  '//./C:/x',
  '\\??\\C:\\x',
  '\\??\\UNC\\h\\s',
  `\\\\${PROBE_HOST}\\s`,
]

/** The system's own reading of each path, on Windows: [System.IO.Path]::GetFullPath, in one PowerShell. */
function systemFullPaths(pairs: [string, string][]): string[] {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::InputEncoding = [Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$lines = [Console]::In.ReadToEnd() -split "`n"',
    'foreach ($line in $lines) { if (-not $line) { continue }; $p = $line | ConvertFrom-Json; try { [IO.Path]::GetFullPath([IO.Path]::Combine($p[0], $p[1])) } catch { "!error" } }',
  ].join('\n')
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: pairs.map(pair => JSON.stringify(pair)).join('\n'), encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  assert.equal(out.status, 0, out.stderr)

  return out.stdout.split(/\r?\n/).filter(line => line !== '')
}

describe('plainLocalPath against generated spellings (T-39)', () => {
  const all = variants()
  const accepted: [string, string, string][] = []

  test(`every path it lets through is a plain drive path as Node reads it (${all.length} spellings × ${CWDS.length} folders)`, t => {
    assert.ok(all.length >= 1000, `${all.length}`)
    let refused = 0
    for (const cwd of CWDS) {
      for (const raw of all) {
        const plain = plainLocalPath(raw, cwd, 'win32')
        if (plain === null) {
          refused++
          continue
        }
        const full = win32.resolve(cwd, raw)
        const namespaced = win32.toNamespacedPath(full)
        assert.match(namespaced, /^\\\\\?\\[A-Za-z]:\\/, JSON.stringify({ raw, cwd, namespaced }))
        assert.doesNotMatch(namespaced, /^\\\\\?\\UNC\\/i, JSON.stringify({ raw, cwd }))
        assert.equal(plain, full, JSON.stringify({ raw, cwd }))
        accepted.push([cwd, raw, plain])
      }
    }
    // Both answers occur: the generator is not all one kind.
    assert.ok(accepted.length >= 100 && refused >= 1000, `accepted ${accepted.length}, refused ${refused}`)
    t.diagnostic(`${all.length * CWDS.length} checked: ${accepted.length} plain, ${refused} refused`)
  })

  test('on Windows the system reads every path it lets through as the very same drive path', t => {
    if (process.platform !== 'win32') return t.skip('GetFullPathNameW is Windows\'')
    // One of each different spelling is enough to ask about.
    const unique = [...new Map(accepted.map(([cwd, raw, plain]) => [`${cwd}|${raw}`, [cwd, raw, plain] as const])).values()]
    const system = systemFullPaths(unique.map(([cwd, raw]) => [cwd, raw]))
    // The system's reading of the plain path itself: .NET Framework's GetFullPath writes a short (8.3) name of a
    // folder that exists out long (C:\Users\RUNNER~1 -> C:\Users\runneradmin), for both alike.
    const ofPlain = systemFullPaths(unique.map(([, , plain]) => [plain, '']))
    assert.equal(system.length, unique.length)
    assert.equal(ofPlain.length, unique.length)
    const bare = (path: string) => path.replace(/\\$/, '').toLowerCase()
    unique.forEach(([cwd, raw, plain], i) => {
      const full = system[i]!
      assert.match(full, /^[A-Za-z]:\\/, JSON.stringify({ raw, cwd, full }))
      // The very place the plain path names, as the system reads both.
      assert.equal(bare(full), bare(ofPlain[i]!), JSON.stringify({ raw, cwd }))
      // And the plain path as it stands, part for part, but for a short name (RUNNER~1) written out long: nothing
      // else may differ.
      const want = bare(plain).split('\\')
      const got = bare(full).split('\\')
      assert.equal(got.length, want.length, JSON.stringify({ raw, cwd, full }))
      want.forEach((part, at) => {
        if (!/~\d/.test(part)) assert.equal(got[at], part, JSON.stringify({ raw, cwd, full }))
      })
    })
  })

  test('every spelling QA found past the earlier checks is refused, in every folder', () => {
    for (const cwd of CWDS) {
      for (const raw of QA_REFUSED) assert.equal(plainLocalPath(raw, cwd, 'win32'), null, JSON.stringify({ raw, cwd }))
    }
  })

  test('what QA found that is a plain path is read as Windows reads it, and the repository check still holds', () => {
    // C:\..\UNC\… is C:\UNC\… to Windows too (a drive's root has no parent): an ordinary folder on C:.
    assert.equal(plainLocalPath('C:\\..\\UNC\\localhost\\C$\\x', 'C:\\Users\\acme', 'win32'), 'C:\\UNC\\localhost\\C$\\x')
    // \Windows is the root of whatever drive the reading process is on, not the folder's: refused, as C:x.
    assert.equal(plainLocalPath('\\Windows', 'C:\\Users\\acme', 'win32'), null)
    assert.equal(plainLocalPath('bin/../x', 'C:\\Users\\acme', 'win32'), 'C:\\Users\\acme\\x')
    // A repository's own setting may still not leave it (QA1–3), plain or not.
    for (const named of ['../acme-secret.txt', 'C:\\Windows', 'C:Windows', '\\Windows', '\\\\h\\s\\x', '.git/config', '.GIT./config', '.GIT/config', '.Git/config', '.git /config', '.git../HEAD']) assert.equal(projectGuidelinesFile(named, 'C:\\Users\\acme\\shop'), null, named)
  })
})
