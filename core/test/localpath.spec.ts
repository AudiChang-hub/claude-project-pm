/**
 * Paths looked up on disk only when they are on this machine (T-37 QA5): on Windows, looking up \\host\share\x
 * connects to that host over SMB and offers the person's NTLM hash before anyone allowed anything.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { RemotePathError, isLocalPath, localRealpath, plainDrivePath } from '../src/localpath'
import { PROBE_HOST, shortPath, watchFs } from './helpers'

describe('which paths are on this machine', () => {
  test('on Windows: drives, relative paths and a drive written as a device are; shares and other devices are not', () => {
    const local = ['C:\\Users\\acme\\shop\\GUIDELINES.md', 'c:/Users/acme', 'GUIDELINES.md', '.\\docs\\x.md', '..\\x', '\\Users\\acme', 'C:relative', '\\\\?\\C:\\Users\\acme', '\\\\.\\C:\\Users\\acme', '//?/C:/Users/acme', '\\??\\C:\\Users\\acme', '\\\\?\\D:']
    const remote = [
      `\\\\${PROBE_HOST}\\share\\x`,
      `//${PROBE_HOST}/share/x`,
      `\\/${PROBE_HOST}/share/x`,
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
      // A drive written as a device, with . or .. in it: Windows folds them into the prefix (\\.\C:\..\UNC\host is
      // \\.\UNC\host), so nothing after a device prefix may climb (QA6).
      `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `//./C:/../UNC/${PROBE_HOST}/share/x`,
      `\\\\.\\C:\\x\\..\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\?\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\??\\C:\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\.\\C:\\.\\..\\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\.\\C:\\..`,
      `\\\\.\\C:\\x\\.`,
      `\\\\.\\C:\\.. \\UNC\\${PROBE_HOST}\\share\\x`,
      `\\\\.\\C:\\...\\UNC\\${PROBE_HOST}\\share\\x`,
    ]
    for (const path of local) assert.equal(isLocalPath(path, 'win32'), true, path)
    for (const path of remote) assert.equal(isLocalPath(path, 'win32'), false, path)
  })

  test('elsewhere every path is: a POSIX system reaches other machines only through folders the person mounted', () => {
    for (const path of ['/home/acme/x', '//host/share/x', '\\\\host\\share\\x']) assert.equal(isLocalPath(path, 'linux'), true, path)
  })

  test('a drive written as a device is read as the plain drive path', () => {
    assert.equal(plainDrivePath('\\\\?\\C:\\Users\\acme', 'win32'), 'C:\\Users\\acme')
    assert.equal(plainDrivePath('\\\\.\\C:\\Users\\acme', 'win32'), 'C:\\Users\\acme')
    assert.equal(plainDrivePath('//?/c:/Users/acme', 'win32'), 'c:/Users/acme')
    assert.equal(plainDrivePath('\\??\\C:\\Users\\acme', 'win32'), 'C:\\Users\\acme')
    assert.equal(plainDrivePath(`\\\\?\\UNC\\${PROBE_HOST}\\share`, 'win32'), `\\\\?\\UNC\\${PROBE_HOST}\\share`)
    assert.equal(plainDrivePath('C:\\Users\\acme', 'win32'), 'C:\\Users\\acme')
    // One that climbs out of its drive is not a drive path: it stays as written, for isLocalPath to refuse (QA6).
    for (const path of [`\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share`, `//?/C:/x/../../UNC/${PROBE_HOST}/share`]) assert.equal(plainDrivePath(path, 'win32'), path)
    assert.equal(plainDrivePath('\\\\?\\C:\\x', 'linux'), '\\\\?\\C:\\x')
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

  test('a chain of folder links is followed to its end, and a long-path spelling is the same file', async () => {
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real', 'GUIDELINES.md'), 'x\n')
    folderLink(join(root, 'real'), join(root, 'b'))
    folderLink(join(root, 'b'), join(root, 'a'))
    const real = realpathSync.native(join(root, 'real', 'GUIDELINES.md'))
    assert.equal(await localRealpath(join(root, 'a', 'GUIDELINES.md')), real)
    assert.equal(await localRealpath(join(root, 'a', 'NEW.md')), join(realpathSync.native(join(root, 'real')), 'NEW.md'))
    if (process.platform === 'win32') {
      assert.equal(await localRealpath(`\\\\?\\${join(root, 'a', 'GUIDELINES.md')}`), real)
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
        await assert.rejects(localRealpath(path), RemotePathError, path)
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
      await assert.rejects(localRealpath(join(root, 'shop', 'local', 'GUIDELINES.md')), RemotePathError)
      assert.deepEqual(fs.remote, [])
    } finally {
      fs.restore()
    }
    // A link whose target is a drive device that climbs out to a share (QA6).
    const climbing = watchFs({ [join(root, 'shop', 'up')]: `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share` })
    try {
      await assert.rejects(localRealpath(join(root, 'shop', 'up', 'GUIDELINES.md')), RemotePathError)
      assert.deepEqual(climbing.remote, [])
    } finally {
      climbing.restore()
    }
  })
})
