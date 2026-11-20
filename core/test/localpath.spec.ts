/**
 * Paths looked up on disk only when they are on this machine (T-37 QA5): on Windows, looking up \\host\share\x
 * connects to that host over SMB and offers the person's NTLM hash before anyone allowed anything.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { NotPlainPathError, localRealpath, plainLocalPath } from '../src/localpath'
import { PROBE_HOST, shortPath, watchFs } from './helpers'

describe('which paths are plain paths on this machine (T-39: only what is listed passes)', () => {
  const cwd = 'C:\\Users\\acme\\shop'

  test('on Windows: a full drive path, or one relative to the folder or to its drive\'s root', () => {
    const plain: [string, string][] = [
      ['C:\\Users\\acme\\shop\\GUIDELINES.md', 'C:\\Users\\acme\\shop\\GUIDELINES.md'],
      ['c:/Users/acme', 'c:\\Users\\acme'],
      ['GUIDELINES.md', 'C:\\Users\\acme\\shop\\GUIDELINES.md'],
      ['.\\docs\\x.md', 'C:\\Users\\acme\\shop\\docs\\x.md'],
      ['..\\x', 'C:\\Users\\acme\\x'],
      ['\\Users\\acme', 'C:\\Users\\acme'],
      ['C:\\..\\..\\Users', 'C:\\Users'],
      ['D:\\RUNNER~1\\x.md', 'D:\\RUNNER~1\\x.md'],
      ['C:\\Users\\acme\\.github\\x.yml', 'C:\\Users\\acme\\.github\\x.yml'],
      ['C:\\Users\\acme\\console.md', 'C:\\Users\\acme\\console.md'],
    ]
    for (const [raw, full] of plain) assert.equal(plainLocalPath(raw, cwd, 'win32'), full, raw)
  })

  test('on Windows: shares, devices, long-path prefixes, drive-relative paths, streams, trimmed names and device names are not', () => {
    const refused = [
      `\\\\${PROBE_HOST}\\share\\x`,
      `//${PROBE_HOST}/share/x`,
      `\\/${PROBE_HOST}/share/x`,
      `/\\${PROBE_HOST}/share/x`,
      `  \\\\${PROBE_HOST}\\share\\x`,
      '\\\\localhost\\C$\\Users',
      '\\\\127.0.0.1\\c$\\Users',
      `\\\\?\\UNC\\${PROBE_HOST}\\share\\x`,
      `//?/UNC/${PROBE_HOST}/share/x`,
      `\\\\.\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\??\\UNC\\${PROBE_HOST}\\share\\x`,
      '\\\\?\\GLOBALROOT\\Device\\Mup\\host\\share',
      '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\x',
      '\\\\.\\pipe\\acme',
      '\\\\.\\PhysicalDrive0',
      '\\\\?\\',
      '\\\\',
      `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `//./C:/../UNC/${PROBE_HOST}/share/x`,
      `\\\\.\\C:\\x\\..\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\?\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\??\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\.\\C:\\.\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      '\\\\.\\C:\\..',
      '\\\\.\\C:\\x\\.',
      `\\\\.\\C:\\.. \\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\.\\C:\\...\\UNC\\${PROBE_HOST}\\share\\x`,
      // Long-path spellings of a drive: refused too now, however plain what follows (T-39).
      '\\\\?\\C:\\Users\\acme',
      '\\\\.\\C:\\Users\\acme',
      '//?/C:/Users/acme',
      '\\??\\C:\\Users\\acme',
      '\\\\?\\D:',
      // A drive-relative path: the folder that process last used on that drive, not one the hook knows.
      'C:relative',
      'C:',
      'c:..\\x',
      // Streams and colons anywhere but a drive's.
      'C:\\Users\\acme\\GUIDELINES.md::$DATA',
      'C:\\Users\\acme\\GUIDELINES.md:hidden',
      'GUIDELINES.md:$DATA',
      'x\\C:\\y',
      // Names Windows trims, so another name is opened.
      'C:\\Users\\acme\\GUIDELINES.md.',
      'C:\\Users\\acme\\GUIDELINES.md ',
      'C:\\Users\\acme\\...\\x',
      'C:\\Users\\acme. \\x',
      // Device names, with any extension.
      'C:\\Users\\acme\\CON',
      'C:\\Users\\acme\\nul.md',
      'C:\\Users\\acme\\COM1\\x',
      'C:\\Users\\acme\\lpt9 .txt',
      'C:\\Users\\acme\\CONIN$',
      'C:\\Users\\acme\\COM¹',
      'NUL',
      // Characters no file name holds.
      'C:\\Users\\acme\\a?b',
      'C:\\Users\\acme\\a*',
      'C:\\Users\\acme\\a<b',
      'C:\\Users\\acme\\a\0b',
      '',
      '   ',
    ]
    for (const path of refused) assert.equal(plainLocalPath(path, cwd, 'win32'), null, JSON.stringify(path))
    // Relative to a session folder that is itself a share: not plain either.
    assert.equal(plainLocalPath('GUIDELINES.md', `\\\\${PROBE_HOST}\\share\\shop`, 'win32'), null)
  })

  test('elsewhere: any path but one starting with //, which a POSIX system may read as another machine', () => {
    assert.equal(plainLocalPath('/home/acme/x', '/home/acme', 'linux'), '/home/acme/x')
    assert.equal(plainLocalPath('x/../y', '/home/acme', 'darwin'), '/home/acme/y')
    assert.equal(plainLocalPath('\\\\host\\share\\x', '/home/acme', 'linux'), '/home/acme/\\\\host\\share\\x')
    for (const path of ['//host/share/x', '///x', 'a\0b', '']) assert.equal(plainLocalPath(path, '/home/acme', 'linux'), null, JSON.stringify(path))
  })
})

describe('where a local path really is', () => {
  let root: string
  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pm-localpath-')))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /** A folder link: a junction on Windows (no rights needed), a symbolic link elsewhere. */
  const folderLink = (target: string, link: string) => symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')

  test('a file is where the system says it is; a name not there yet keeps its name after its folder', async () => {
    mkdirSync(join(root, 'shop'))
    writeFileSync(join(root, 'shop', 'GUIDELINES.md'), 'x\n')
    assert.equal(await localRealpath(join(root, 'shop', 'GUIDELINES.md')), realpathSync.native(join(root, 'shop', 'GUIDELINES.md')))
    assert.equal(await localRealpath(join(root, 'shop', 'NEW.md')), join(root, 'shop', 'NEW.md'))
  })

  test('a chain of folder links is followed to its end; a long-path spelling of it is refused', async () => {
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real', 'GUIDELINES.md'), 'x\n')
    folderLink(join(root, 'real'), join(root, 'b'))
    folderLink(join(root, 'b'), join(root, 'a'))
    const real = realpathSync.native(join(root, 'real', 'GUIDELINES.md'))
    assert.equal(await localRealpath(join(root, 'a', 'GUIDELINES.md')), real)
    assert.equal(await localRealpath(join(root, 'a', 'NEW.md')), join(realpathSync.native(join(root, 'real')), 'NEW.md'))
    if (process.platform === 'win32') {
      // A long-path spelling of the same file is not a plain path (T-39): refused before anything is looked up.
      await assert.rejects(localRealpath(`\\\\?\\${join(root, 'a', 'GUIDELINES.md')}`), NotPlainPathError)
      const short = shortPath(join(root, 'real', 'GUIDELINES.md'))
      if (short) assert.equal(await localRealpath(short), real)
    }
  })

  test('links in a loop are an error, not a path to take as it is written (Windows)', async t => {
    if (process.platform !== 'win32') return t.skip('elsewhere the system\'s own realpath answers, as before')
    folderLink(join(root, 'a'), join(root, 'b'))
    folderLink(join(root, 'b'), join(root, 'a'))
    await assert.rejects(localRealpath(join(root, 'a', 'GUIDELINES.md')), /too many links/)
  })

  test('a network path is refused without asking the file system anything (Windows)', async t => {
    if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
    const fs = watchFs()
    try {
      for (const path of [`\\\\${PROBE_HOST}\\share\\x`, `//${PROBE_HOST}/share/x`, `\\\\?\\UNC\\${PROBE_HOST}\\share\\x`, '\\\\.\\pipe\\acme', `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`, `\\\\?\\C:\\x\\..\\..\\UNC\\${PROBE_HOST}\\share\\x`]) {
        await assert.rejects(localRealpath(path), NotPlainPathError, path)
      }
      assert.deepEqual(fs.remote, [])
    } finally {
      fs.restore()
    }
  })

  test('a link on the way that leads to another machine is read, not followed, and refused (Windows)', async t => {
    if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
    mkdirSync(join(root, 'shop'))
    // shop\local -> shop\far -> \\host\share: the second hop is the one that leaves the machine.
    const fs = watchFs({ [join(root, 'shop', 'local')]: join(root, 'shop', 'far'), [join(root, 'shop', 'far')]: `\\\\?\\UNC\\${PROBE_HOST}\\share` })
    try {
      await assert.rejects(localRealpath(join(root, 'shop', 'local', 'GUIDELINES.md')), NotPlainPathError)
      assert.deepEqual(fs.remote, [])
    } finally {
      fs.restore()
    }
    // A link whose target is a drive device that climbs out to a share (QA6).
    const climbing = watchFs({ [join(root, 'shop', 'up')]: `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share` })
    try {
      await assert.rejects(localRealpath(join(root, 'shop', 'up', 'GUIDELINES.md')), NotPlainPathError)
      assert.deepEqual(climbing.remote, [])
    } finally {
      climbing.restore()
    }
  })
})
