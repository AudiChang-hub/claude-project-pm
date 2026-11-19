/**
 * Every step of the QA workflow, as GitHub would run it (bash -eo pipefail, in order), on an Acme demo project that
 * should fail each check: a made-up AWS key, an old lodash with known high-risk advisories, a private word. The
 * secrets and package steps download gitleaks and osv-scanner (Linux builds) and read their JSON with jq, so this
 * runs on Linux with the network only: core.yml sets PROJECT_PM_TEMPLATE_LIVE=1 on ubuntu (design 6.3 and 8, ①).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { parse } from 'yaml'

import { setLang } from '../../hooks/messages'
import { ct } from '../src/messages'
import { ciTemplate } from '../src/templates'
import { LANGS, git } from './helpers'

type Step = { name?: string; id?: string; uses?: string; run?: string; env?: Record<string, string> }
type Job = { env?: Record<string, string>; steps: Step[] }

const LIVE = process.env.PROJECT_PM_TEMPLATE_LIVE === '1' && process.platform === 'linux'

for (const lang of LANGS) {
  describe(`the QA workflow on the Acme demo, every step (${lang})`, { skip: LIVE ? false : 'needs Linux and the network: PROJECT_PM_TEMPLATE_LIVE=1 (core.yml)' }, () => {
    let root: string
    let repo: string
    beforeEach(() => {
      setLang(lang)
      root = realpathSync(mkdtempSync(join(tmpdir(), 'pm-ci-live-')))
      repo = join(root, 'acme-demo')
      mkdirSync(repo)
      git(repo, 'init', '-q', '-b', 'main')
      git(repo, 'config', 'user.name', 'Acme Dev')
      git(repo, 'config', 'user.email', 'dev@acme.example')
      // Put together here, so no key-shaped text sits in this repository.
      const key = ['AKIA', 'Q4ZJ7KXM', '2P5WNRTY'].join('')
      const secret = ['tR8vKx2LmQ9pW3nZ7yB4', 'cF6hJ1dS5gA0eU8iO2rT'].join('')
      writeFileSync(join(repo, 'config.js'), `module.exports = {\n  region: 'us-east-1',\n  awsKey: '${key}',\n  awsSecret: '${secret}',\n}\n`)
      writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'acme-demo', version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2))
      writeFileSync(join(repo, 'test.js'), 'console.log("acme ok")\n')
      writeFileSync(
        join(repo, 'package-lock.json'),
        JSON.stringify({ name: 'acme-demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'acme-demo', version: '1.0.0', dependencies: { lodash: '4.17.15' } }, 'node_modules/lodash': { version: '4.17.15', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz' } } }, null, 2),
      )
      writeFileSync(join(repo, 'customers.md'), 'Acme customers\nCall ACME VIP CLIENT on Monday\n')
      git(repo, 'add', '-A')
      git(repo, 'commit', '-q', '-m', 'Acme demo')
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    test('the tests pass; the key, the old package and the private word are each held, marked and explained', { timeout: 600_000 }, () => {
      const flow = parse(ciTemplate()) as { jobs: Record<string, Job> }
      const results: Record<string, { code: number | null; stdout: string; summary: string }> = {}
      for (const job of Object.values(flow.jobs)) {
        const temp = mkdtempSync(join(root, 'runner-'))
        const summary = join(temp, 'summary.md')
        const output = join(temp, 'output.txt')
        writeFileSync(summary, '')
        const outputs: Record<string, string> = {}
        for (const step of job.steps) {
          if (step.uses) continue
          writeFileSync(output, '')
          const values: Record<string, string> = { KIND: outputs.kind ?? '', BLOCKED_TERMS: 'Acme VIP Client\nAcme Partner Zeta\n' }
          const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, RUNNER_TEMP: temp }
          for (const [key, value] of Object.entries({ ...(job.env ?? {}), ...(step.env ?? {}) })) env[key] = String(value).startsWith('${{') ? (values[key] ?? '') : String(value)
          const script = join(temp, 'step.sh')
          writeFileSync(script, step.run!)
          const out = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { cwd: repo, env, encoding: 'utf8', timeout: 300_000 })
          for (const line of readFileSync(output, 'utf8').split('\n')) if (line.includes('=')) outputs[line.split('=')[0]!] = line.slice(line.indexOf('=') + 1)
          results[step.name ?? step.id ?? ''] = { code: out.status, stdout: out.stdout + out.stderr, summary: readFileSync(summary, 'utf8') }
        }
      }
      const tests = results[ct('ci.tests.step')]!
      assert.equal(tests.code, 0, tests.stdout)
      assert.ok(tests.summary.includes(ct('ci.tests.passed')))
      const keys = results[ct('ci.secrets.step')]!
      assert.equal(keys.code, 1, keys.stdout)
      assert.match(keys.stdout, /::error file=config\.js,line=3,/)
      assert.ok(!keys.stdout.includes('AKIA'), 'gitleaks shows the key')
      assert.ok(keys.summary.includes(ct('ci.secrets.failed')))
      const packages = results[ct('ci.deps.step')]!
      assert.equal(packages.code, 1, packages.stdout)
      assert.ok(packages.stdout.includes('lodash'), packages.stdout)
      assert.ok(packages.summary.includes(ct('ci.deps.failed')))
      const words = results[ct('ci.terms.step')]!
      assert.equal(words.code, 1, words.stdout)
      assert.match(words.stdout, /::error file=customers\.md,line=2,/)
      assert.ok(!/acme vip client|acme partner zeta/i.test(words.stdout + words.summary))
    })
  })
}
