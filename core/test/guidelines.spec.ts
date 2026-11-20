/**
 * Where the development guidelines may come from. A project's .project-pm.json is part of the repository, so anyone
 * who can commit to it could aim it at a file outside (~/.aws/credentials) and have it read into every turn: a
 * project may only name a file inside itself. Any path stays open to the person's own ~/.project-pm/config.json.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { projectGuidelinesFile, readGuidelines } from '../src/hook'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import type { World } from './helpers'
import { PROBE_HOST, git, watchFs, world } from './helpers'

describe('guidelines named by the project', () => {
  let w: World
  let ref: ProjectRef
  beforeEach(async () => {
    w = world('en')
    ref = (await resolveProject(w.repo))!
    writeFileSync(join(w.root, 'acme-secret.txt'), 'ACME-SECRET-TOKEN\n')
    writeFileSync(join(w.repo, 'GUIDELINES.md'), 'Acme rule 1: tests first.\n')
  })
  afterEach(() => w.done())
  const aim = (guidelines: string) => writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines }))

  /**
   * A file link. Only Windows may refuse one (it needs Developer Mode or admin rights there): then there is nothing to
   * test. Linux and macOS always can, so there a failure to make one fails the test instead of skipping it.
   */
  const fileLink = (target: string, link: string, t: { skip: (why: string) => void }): boolean => {
    try {
      symlinkSync(target, link, 'file')

      return true
    } catch (err) {
      if (process.platform !== 'win32') throw err
      t.skip('this Windows user cannot make file links (no Developer Mode); Linux and macOS CI run it')

      return false
    }
  }

  /** A folder link: a junction on Windows (no admin rights needed), a symbolic link elsewhere; only Windows may refuse one. */
  const folderLink = (target: string, link: string, t: { skip: (why: string) => void }): boolean => {
    try {
      symlinkSync(target, link, 'junction')

      return true
    } catch (err) {
      if (process.platform !== 'win32') throw err
      t.skip('this Windows user cannot make links here; Linux and macOS CI run it')

      return false
    }
  }

  test('a path outside the repository is refused, written the Windows way or the POSIX way', () => {
    for (const path of [
      '../acme-secret.txt',
      '..\\acme-secret.txt',
      'docs/../../acme-secret.txt',
      'docs\\..\\..\\acme-secret.txt',
      '/etc/passwd',
      '\\Windows\\win.ini',
      'C:\\Users\\Acme Dev\\.aws\\credentials',
      'c:/Users/Acme Dev/.aws/credentials',
      'C:acme-secret.txt',
      '\\\\acme-files\\share\\secret.txt',
      '~/.aws/credentials',
      '~\\.aws\\credentials',
      '~',
      join(w.root, 'acme-secret.txt'),
    ]) {
      assert.equal(projectGuidelinesFile(path, ref.path), null, path)
    }
  })

  test('a path inside the repository is taken, with either slash', () => {
    assert.equal(projectGuidelinesFile('GUIDELINES.md', ref.path), join(ref.path, 'GUIDELINES.md'))
    assert.equal(projectGuidelinesFile('docs/rules.md', ref.path), join(ref.path, 'docs', 'rules.md'))
    assert.equal(projectGuidelinesFile('docs\\rules.md', ref.path), process.platform === 'win32' ? join(ref.path, 'docs', 'rules.md') : join(ref.path, 'docs\\rules.md'))
    assert.equal(projectGuidelinesFile('"./GUIDELINES.md"', ref.path), join(ref.path, 'GUIDELINES.md'))
  })

  test('a project aimed outside itself reads nothing from there', async () => {
    for (const path of [join(w.root, 'acme-secret.txt'), '../acme-secret.txt', '..\\acme-secret.txt']) {
      aim(path)
      const found = await readGuidelines(ref, w.env)
      assert.ok(!found || !('text' in found) || !found.text.includes('ACME-SECRET'), path)
    }
  })

  test('a link in the repository that leads outside it is refused too', async t => {
    // A folder link: a junction on Windows (no admin rights needed), a symbolic link elsewhere.
    mkdirSync(join(w.root, 'acme-private'))
    writeFileSync(join(w.root, 'acme-private', 'rules.md'), 'ACME-SECRET-TOKEN\n')
    if (!folderLink(join(w.root, 'acme-private'), join(w.repo, 'docs'), t)) return
    aim('docs/rules.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found) || !found.text.includes('ACME-SECRET'))
  })

  test('a link to a single file outside the repository is refused, even when the link itself is in git (T-37 QA2 6)', async t => {
    if (!fileLink(join(w.root, 'acme-secret.txt'), join(w.repo, 'RULES.md'), t)) return
    git(w.repo, 'add', 'RULES.md')
    aim('RULES.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found) || !found.text.includes('ACME-SECRET'))
  })

  test('a committed link to an untracked file in the repository is refused: RULES.md -> .env (T-37 QA3 1)', async t => {
    writeFileSync(join(w.repo, '.env'), 'ACME_API_KEY=ACME-SECRET-TOKEN\n')
    if (!fileLink('.env', join(w.repo, 'RULES.md'), t)) return
    git(w.repo, 'add', 'RULES.md')
    git(w.repo, 'commit', '-q', '-m', 'Acme rules')
    assert.equal(git(w.repo, 'ls-files', '--', '.env'), '')
    aim('RULES.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found), found && 'text' in found ? found.text : '')
  })

  test('a chain of committed links to an untracked file is refused: RULES.md -> a.md -> .env (T-37 QA4 2)', async t => {
    writeFileSync(join(w.repo, '.env'), 'ACME_API_KEY=ACME-SECRET-TOKEN\n')
    if (!fileLink('.env', join(w.repo, 'a.md'), t)) return
    if (!fileLink('a.md', join(w.repo, 'RULES.md'), t)) return
    git(w.repo, 'add', 'RULES.md', 'a.md')
    git(w.repo, 'commit', '-q', '-m', 'Acme rules')
    assert.equal(git(w.repo, 'ls-files', '--', '.env'), '')
    aim('RULES.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found), found && 'text' in found ? found.text : '')
  })

  test('a tracked name whose real file, through a folder link, is one git does not track is refused (T-37 QA3 1)', async t => {
    // The same hole on any system: a folder link (a junction on Windows) to an ignored folder, and an index entry for the
    // name, as a commit would leave it. The name is tracked; the file read through it is not.
    writeFileSync(join(w.repo, '.gitignore'), 'private/\n')
    mkdirSync(join(w.repo, 'private'))
    writeFileSync(join(w.repo, 'private', 'rules.md'), 'ACME-SECRET-TOKEN\n')
    if (!folderLink(join(w.repo, 'private'), join(w.repo, 'docs'), t)) return
    const blob = git(w.repo, 'hash-object', '-w', join(w.repo, 'private', 'rules.md'))
    git(w.repo, 'update-index', '--add', '--cacheinfo', `100644,${blob},docs/rules.md`)
    assert.equal(git(w.repo, 'ls-files', '--', 'docs/rules.md'), 'docs/rules.md')
    aim('docs/rules.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found), found && 'text' in found ? found.text : '')
  })

  test('nothing inside .git is read, however the folder is written (T-37 QA2 6)', async () => {
    const names = ['.git/config', '.git\\config', '.GIT/config', './.git/config', '.git/hooks/pre-push.sample']
    if (process.platform === 'win32') names.push('.git./config', '.git /config')
    for (const name of names) {
      aim(name)
      const found = await readGuidelines(ref, w.env)
      assert.ok(!found || !('text' in found), `${name}: ${found && 'text' in found ? found.text.slice(0, 40) : ''}`)
    }
  })

  test('a file git does not track is not read: a .env, an ignored file, a new file not yet added (T-37 QA2 6)', async () => {
    writeFileSync(join(w.repo, '.env'), 'ACME_API_KEY=ACME-SECRET-TOKEN\n')
    writeFileSync(join(w.repo, '.gitignore'), 'secrets/\n')
    mkdirSync(join(w.repo, 'secrets'))
    writeFileSync(join(w.repo, 'secrets', 'rules.md'), 'ACME-SECRET-TOKEN\n')
    git(w.repo, 'add', '.gitignore')
    for (const name of ['.env', 'secrets/rules.md', 'GUIDELINES.md']) {
      aim(name)
      const found = await readGuidelines(ref, w.env)
      assert.ok(!found || !('text' in found), `${name}: ${found && 'text' in found ? found.text.slice(0, 40) : ''}`)
    }
    // Once it is in git, the same file is read.
    git(w.repo, 'add', 'GUIDELINES.md')
    aim('GUIDELINES.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(found && 'text' in found && found.text.includes('Acme rule 1'))
  })

  test('a committed link that leads to a network share is refused without looking there (T-37 QA5)', async t => {
    // Windows connects to the host (SMB, with the person's NTLM hash) the moment anything follows such a link.
    if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
    writeFileSync(join(w.repo, 'RULES.md'), 'Acme rule 1: tests first.\n')
    git(w.repo, 'add', 'RULES.md')
    aim('RULES.md')
    for (const target of [`\\\\${PROBE_HOST}\\share\\RULES.md`, `\\\\?\\UNC\\${PROBE_HOST}\\share\\RULES.md`, `//${PROBE_HOST}/share/RULES.md`]) {
      const fs = watchFs({ [join(w.repo, 'RULES.md')]: target })
      try {
        const found = await readGuidelines(ref, w.env)
        assert.deepEqual(fs.remote, [], `followed the link to ${target}`)
        assert.equal(found, null, target)
      } finally {
        fs.restore()
      }
    }
    // A folder link on the way counts the same: docs -> \\host\share.
    aim('docs/RULES.md')
    const fs = watchFs({ [join(w.repo, 'docs')]: `\\\\${PROBE_HOST}\\share` })
    try {
      assert.equal(await readGuidelines(ref, w.env), null)
      assert.deepEqual(fs.remote, [])
    } finally {
      fs.restore()
    }
  })

  test('a real committed link to a network share is refused (Windows with link rights: GitHub\'s runners)', async t => {
    if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
    const target = `\\\\${PROBE_HOST}\\share\\RULES.md`
    if (!fileLink(target, join(w.repo, 'RULES.md'), t)) return
    // Recorded in git as a link without git reading it (git add would follow it where links are off).
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: w.repo, input: target.replace(/\\/g, '/'), encoding: 'utf8' }).trim()
    git(w.repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},RULES.md`)
    aim('RULES.md')
    const started = Date.now()
    assert.equal(await readGuidelines(ref, w.env), null)
    // Following it would have waited on name lookups for the host: refusing it reads nothing.
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`)
  })

  test('the project\'s own file is read', async () => {
    git(w.repo, 'add', 'GUIDELINES.md')
    aim('GUIDELINES.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(found && 'text' in found && found.text.includes('Acme rule 1'))
  })

  test('the person\'s own config may name any file, and stands when the project\'s path is refused', async () => {
    const mine = join(w.root, 'my-rules.md')
    writeFileSync(mine, 'Acme personal rule.\n')
    mkdirSync(w.env.PROJECT_PM_HOME!, { recursive: true })
    writeFileSync(join(w.env.PROJECT_PM_HOME!, 'config.json'), JSON.stringify({ guidelines: mine }))
    let found = await readGuidelines(ref, w.env)
    assert.ok(found && 'text' in found && found.text.includes('Acme personal rule'))
    aim('../acme-secret.txt')
    found = await readGuidelines(ref, w.env)
    assert.ok(found && 'text' in found && found.text.includes('Acme personal rule'))
  })
})
