/**
 * init and uninstall as a person runs them: the built program (PROJECT_PM_BIN: the single executable or the bundle)
 * in an Acme repository, with a home folder of its own and Claude Code's real command line when it is installed.
 * Skipped without PROJECT_PM_BIN; core.yml runs it on Windows, macOS and Linux after building (design 8, ①).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { LANGS, git, serverCommand } from './helpers'

const BIN = process.env.PROJECT_PM_BIN
const hasClaude = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).status === 0

/** The files init may touch, with their bytes (and mode off Windows). */
function snapshot(home: string, repo: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (root: string, dir: string) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        out[`${relative(root, full)}/`] = ''
        walk(root, full)
      } else out[relative(root, full)] = `${process.platform === 'win32' ? '' : (stat.mode & 0o777).toString(8)}:${readFileSync(full).toString('base64')}`
    }
  }
  for (const file of ['AGENTS.md', 'CLAUDE.md', '.gitignore', join('.git', 'config')]) if (existsSync(join(repo, file))) out[`repo/${file}`] = readFileSync(join(repo, file)).toString('base64')
  walk(join(repo, '..'), join(repo, '.git', 'hooks'))
  walk(join(repo, '..'), join(repo, '.github'))
  walk(join(home, '..'), join(home, '.claude', 'skills'))
  if (existsSync(join(home, '.claude', 'settings.json'))) out['settings.json'] = readFileSync(join(home, '.claude', 'settings.json')).toString('base64')

  return out
}

for (const lang of LANGS) {
  describe(`init and uninstall with the built program (${lang})`, { skip: BIN ? false : 'PROJECT_PM_BIN is not set: build first (npm run build, npm run sea)' }, () => {
    let root: string
    let home: string
    let repo: string
    let env: NodeJS.ProcessEnv
    beforeEach(() => {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'pm-bin-')))
      home = join(root, 'home')
      repo = join(root, 'acme-shop')
      mkdirSync(join(home, '.claude'), { recursive: true })
      mkdirSync(repo)
      writeFileSync(join(home, '.claude', 'settings.json'), `${JSON.stringify({ model: 'opus' }, null, 2)}\n`)
      env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), PROJECT_PM_HOME: join(home, '.project-pm'), PROJECT_PM_LANG: lang, PROJECT_PM_NO_GH: '1' }
      git(repo, 'init', '-q', '-b', 'main')
      git(repo, 'config', 'user.name', 'Acme Dev')
      git(repo, 'config', 'user.email', 'dev@acme.example')
      writeFileSync(join(repo, 'CLAUDE.md'), '# Acme\n\nShip on Fridays.\n')
      writeFileSync(join(repo, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(repo, '.git', 'hooks', 'pre-push'), 0o755)
      git(repo, 'add', '-A')
      git(repo, 'commit', '-q', '-m', 'Start the Acme shop')
    })
    afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }))
    const pm = (...args: string[]) => {
      const { command, args: before } = serverCommand(...args)

      return spawnSync(command, before, { cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    }

    test('--version, then init lists and changes nothing, init --yes --ci sets up, uninstall --yes leaves the same files', { timeout: 300_000 }, () => {
      assert.match(pm('--version').stdout.trim(), /^\d+\.\d+\.\d+$/)
      const before = snapshot(home, repo)
      const dry = pm('init', '--ci')
      assert.equal(dry.status, 0, dry.stderr)
      assert.deepEqual(snapshot(home, repo), before)
      const done = pm('init', '--yes', '--ci')
      assert.equal(done.status, 0, `${done.stdout}\n${done.stderr}`)
      assert.ok(readFileSync(join(repo, 'AGENTS.md'), 'utf8').includes('<!-- project-pm:start v1 -->'))
      assert.ok(readFileSync(join(repo, '.git', 'hooks', 'pre-push'), 'utf8').includes('check pre-push'))
      assert.ok(existsSync(join(repo, '.git', 'hooks', 'pre-push.local')))
      assert.ok(existsSync(join(repo, '.github', 'workflows', 'project-pm-qa.yml')))
      if (hasClaude) assert.equal(spawnSync('claude', ['mcp', 'get', 'project-pm'], { env, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).status, 0)
      const skip = spawnSync('git', ['pm', 'skip', 'Acme docs only'], { cwd: repo, env, encoding: 'utf8', windowsHide: true })
      assert.equal(skip.status, 0, skip.stderr)
      const gone = pm('uninstall', '--yes')
      assert.equal(gone.status, 0, `${gone.stdout}\n${gone.stderr}`)
      assert.deepEqual(snapshot(home, repo), before)
      assert.ok(!existsSync(join(home, '.project-pm', 'install-log.json')))
      assert.ok(!existsSync(join(home, '.project-pm', 'bin')) || readdirSync(join(home, '.project-pm', 'bin')).length === 0)
      if (hasClaude) assert.notEqual(spawnSync('claude', ['mcp', 'get', 'project-pm'], { env, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).status, 0)
    })
  })
}
