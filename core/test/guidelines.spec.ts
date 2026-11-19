/**
 * Where the development guidelines may come from. A project's .project-pm.json is part of the repository, so anyone
 * who can commit to it could aim it at a file outside (~/.aws/credentials) and have it read into every turn: a
 * project may only name a file inside itself. Any path stays open to the person's own ~/.project-pm/config.json.
 */
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { projectGuidelinesFile, readGuidelines } from '../src/hook'
import type { ProjectRef } from '../src/project'
import { resolveProject } from '../src/project'
import type { World } from './helpers'
import { git, world } from './helpers'

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
    try {
      symlinkSync(join(w.root, 'acme-private'), join(w.repo, 'docs'), 'junction')
    } catch {
      t.skip('this system does not let this user make links')

      return
    }
    aim('docs/rules.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found) || !found.text.includes('ACME-SECRET'))
  })

  test('a link to a single file outside the repository is refused, even when the link itself is in git (T-37 QA2 6)', async t => {
    // A file link needs Developer Mode or admin rights on Windows: where this user cannot make one, there is nothing to test.
    try {
      symlinkSync(join(w.root, 'acme-secret.txt'), join(w.repo, 'RULES.md'), 'file')
    } catch {
      t.skip('this system does not let this user make file links')

      return
    }
    git(w.repo, 'add', 'RULES.md')
    aim('RULES.md')
    const found = await readGuidelines(ref, w.env)
    assert.ok(!found || !('text' in found) || !found.text.includes('ACME-SECRET'))
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
