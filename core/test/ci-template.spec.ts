/**
 * The QA workflow init --ci writes (docs/design/v1-core.md 6.3). The YAML is parsed as GitHub would; the steps that
 * need no network (finding the tests, running them, the private words) run here in bash, as GitHub runs them
 * (`bash -eo pipefail`), on Acme projects. gitleaks and osv-scanner download Linux programs: they run on GitHub only.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { parse } from 'yaml'

import { setLang } from '../../hooks/messages'
import { ct } from '../src/messages'
import { ciTemplate } from '../src/templates'
import { LANGS, git } from './helpers'

type Step = { name?: string; id?: string; if?: string; uses?: string; run?: string; env?: Record<string, string> }
type Job = { env?: Record<string, string>; steps: Step[] }
type Workflow = { name: string; on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> }

/** git's own bash on Windows (not WSL's), bash elsewhere. */
function bashPath(): string {
  if (process.platform !== 'win32') return 'bash'
  const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()

  return join(exec, '..', '..', '..', 'bin', 'bash.exe')
}

for (const lang of LANGS) {
  describe(`the CI template (${lang})`, () => {
    let root: string
    let flow: Workflow
    beforeEach(() => {
      setLang(lang)
      flow = parse(ciTemplate()) as Workflow
      root = realpathSync(mkdtempSync(join(tmpdir(), 'pm-ci-')))
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    const jobOf = (name: string) => Object.values(flow.jobs).find(job => job.steps.some(s => s.name === name || s.id === name))!
    const step = (name: string) => jobOf(name).steps.find(s => s.name === name || s.id === name)!
    /** An Acme project with these files, committed. */
    const project = (files: Record<string, string>) => {
      const dir = join(root, 'acme-shop')
      mkdirSync(dir, { recursive: true })
      git(dir, 'init', '-q', '-b', 'main')
      git(dir, 'config', 'user.name', 'Acme Dev')
      git(dir, 'config', 'user.email', 'dev@acme.example')
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        writeFileSync(join(dir, file), text)
      }
      git(dir, 'add', '-A')
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'Acme')

      return dir
    }
    /** Runs one step's script in `dir` as GitHub would, with `${{ … }}` given by `values`. */
    const runStep = (s: Step, dir: string, values: Record<string, string> = {}) => {
      const temp = mkdtempSync(join(root, 'runner-'))
      const summary = join(temp, 'summary.md')
      const output = join(temp, 'output.txt')
      writeFileSync(summary, '')
      writeFileSync(output, '')
      const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, RUNNER_TEMP: temp }
      for (const [key, value] of Object.entries({ ...(Object.values(flow.jobs).find(job => job.steps.includes(s))!.env ?? {}), ...(s.env ?? {}) })) env[key] = String(value).startsWith('${{') ? (values[key] ?? '') : String(value)
      const script = join(temp, 'step.sh')
      writeFileSync(script, s.run!)
      const out = spawnSync(bashPath(), ['--noprofile', '--norc', '-eo', 'pipefail', script], { cwd: dir, env, encoding: 'utf8', windowsHide: true })

      return { code: out.status, stdout: out.stdout, stderr: out.stderr, summary: readFileSync(summary, 'utf8'), output: readFileSync(output, 'utf8') }
    }

    test('parses, reads only, pins every action to a commit, and speaks the language', () => {
      assert.ok(ciTemplate().startsWith('# project-pm:start v1'))
      assert.ok(!ciTemplate().includes('{{pm:'))
      assert.deepEqual(flow.permissions, { contents: 'read' })
      assert.ok('pull_request' in flow.on)
      const uses = Object.values(flow.jobs).flatMap(job => job.steps).filter(s => s.uses).map(s => s.uses!)
      assert.ok(uses.length >= 3)
      for (const one of uses) assert.match(one, /^[\w-]+\/[\w-]+@[0-9a-f]{40}$/)
      assert.ok(ciTemplate().includes(ct('ci.tests.why')))
      for (const name of ['ci.tests.step', 'ci.secrets.step', 'ci.terms.step', 'ci.deps.step'] as const) assert.ok(step(ct(name)), name)
      // Every check after the tests runs even when the tests fail.
      for (const name of ['ci.secrets.step', 'ci.deps.step'] as const) assert.equal(step(ct(name)).if, '${{ !cancelled() }}')
    })

    test('the private words are read in a job of their own, where no package is installed', () => {
      // A package's install script runs with the job's rights; it must never share a job with the BLOCKED_TERMS secret.
      const jobs = Object.entries(flow.jobs)
      const seeing = jobs.filter(([, job]) => JSON.stringify(job).includes('secrets.BLOCKED_TERMS'))
      assert.equal(seeing.length, 1, seeing.map(([name]) => name).join(', '))
      const [, job] = seeing[0]!
      for (const s of job.steps) {
        if (s.uses) assert.match(s.uses, /^actions\/checkout@/, `${s.uses} in the job that reads BLOCKED_TERMS`)
        assert.doesNotMatch(s.run ?? '', /\b(npm|npx|pnpm|yarn|corepack|pip|pytest|python)\b/, `an install or a test run in the job that reads BLOCKED_TERMS: ${s.name}`)
      }
    })

    test('finds npm, pnpm, yarn and pytest, and no tests where there are none', () => {
      const cases: [Record<string, string>, string][] = [
        [{ 'package.json': '{"scripts":{"test":"node test.js"}}' }, 'npm'],
        [{ 'package.json': '{"scripts":{"test":"vitest"}}', 'pnpm-lock.yaml': '' }, 'pnpm'],
        [{ 'package.json': '{"scripts":{"test":"jest"}}', 'yarn.lock': '' }, 'yarn'],
        [{ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }, 'none'],
        [{ 'pyproject.toml': '[project]\nname = "acme"\n' }, 'pytest'],
        [{ 'README.md': '# Acme\n' }, 'none'],
      ]
      for (const [files, kind] of cases) {
        rmSync(join(root, 'acme-shop'), { recursive: true, force: true })
        const out = runStep(step('find'), project(files))
        assert.equal(out.code, 0, out.stderr)
        assert.equal(out.output.trim(), `kind=${kind}`, JSON.stringify(files))
      }
    })

    test('no tests: the step says so in the summary and does not fail', () => {
      const out = runStep(step(ct('ci.tests.step')), project({ 'README.md': '# Acme\n' }), { KIND: 'none' })
      assert.equal(out.code, 0, out.stderr)
      assert.ok(out.summary.includes(`| ${ct('ci.tests.step')} | ${ct('ci.skip')} | ${ct('ci.tests.none')} |`), out.summary)
    })

    test('tests that fail are marked and explained; tests that pass say so', { timeout: 120_000 }, () => {
      const failing = runStep(step(ct('ci.tests.step')), project({ 'package.json': '{"name":"acme","version":"1.0.0","scripts":{"test":"node test.js"}}', 'test.js': 'process.exit(1)\n' }), { KIND: 'npm' })
      assert.equal(failing.code, 1)
      assert.ok(failing.stdout.includes(`::error title=${ct('ci.tests.step')}::${ct('ci.tests.failed')}`), failing.stdout)
      assert.ok(failing.summary.includes(ct('ci.fail')) && failing.summary.includes(ct('ci.tests.fix')), failing.summary)
      rmSync(join(root, 'acme-shop'), { recursive: true, force: true })
      const passing = runStep(step(ct('ci.tests.step')), project({ 'package.json': '{"name":"acme","version":"1.0.0","scripts":{"test":"node test.js"}}', 'test.js': 'console.log("ok")\n' }), { KIND: 'npm' })
      assert.equal(passing.code, 0, passing.stderr)
      assert.ok(passing.summary.includes(`| ${ct('ci.pass')} | ${ct('ci.tests.passed')} |`), passing.summary)
    })

    test('a private word is held and located, and never printed', () => {
      const dir = project({ 'README.md': '# Acme Shop\n', 'notes/customers.md': 'Acme customers\nCall GLOBEX Corp on Monday\n' })
      const out = runStep(step(ct('ci.terms.step')), dir, { BLOCKED_TERMS: '  Globex Corp \r\n\r\nInitech\n' })
      assert.equal(out.code, 1)
      assert.ok(out.stdout.includes(`::error file=notes/customers.md,line=2,title=${ct('ci.terms.step')}::${ct('ci.terms.hit')}`), out.stdout)
      assert.ok(out.summary.includes(ct('ci.terms.failed').replace('%s', '1')), out.summary)
      for (const said of [out.stdout, out.stderr, out.summary]) assert.ok(!/globex|initech/i.test(said))
    })

    test('no private word, or no list: the step passes or says it was skipped', () => {
      const dir = project({ 'README.md': '# Acme Shop\n' })
      const clean = runStep(step(ct('ci.terms.step')), dir, { BLOCKED_TERMS: 'Globex Corp\n' })
      assert.equal(clean.code, 0, clean.stderr)
      assert.ok(clean.summary.includes(ct('ci.terms.passed')))
      const unset = runStep(step(ct('ci.terms.step')), dir, { BLOCKED_TERMS: '' })
      assert.equal(unset.code, 0, unset.stderr)
      assert.ok(unset.summary.includes(`| ${ct('ci.skip')} | ${ct('ci.terms.none')} |`), unset.summary)
    })
  })
}
