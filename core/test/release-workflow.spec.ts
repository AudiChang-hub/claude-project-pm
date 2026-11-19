/**
 * The release workflow, read as GitHub reads it. A version tag builds, tests and publishes; started by hand
 * (workflow_dispatch) it only builds and tests, and leaves the five programs and SHA256SUMS as the run's artifacts, so
 * someone can download one from the web and see what Windows and macOS really say, before anything is published.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import { parse } from 'yaml'

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> }
type Job = { if?: string; needs?: string | string[]; permissions?: Record<string, string>; strategy?: { matrix?: { include?: { asset: string }[] } }; steps: Step[] }
type Workflow = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> }

const flow = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')) as Workflow
/** The condition that holds only for a pushed version tag: never for a run started by hand, whatever ref it names. */
const isTagPush = (condition: string | undefined) => !!condition && /github\.event_name\s*==\s*'push'/.test(condition) && /startsWith\(\s*github\.ref\s*,\s*'refs\/tags\/v'\s*\)/.test(condition)
const publishes = (job: Job) => job.steps.some(s => /\bgh\s+release\b|\bnpm\s+publish\b/.test(s.run ?? ''))

describe('the release workflow (T-37: a build to try before publishing)', () => {
  test('starts on a version tag, and by hand', () => {
    assert.deepEqual((flow.on.push as { tags: string[] }).tags, ['v*'])
    assert.ok('workflow_dispatch' in flow.on, Object.keys(flow.on).join(', '))
    assert.deepEqual(flow.permissions, { contents: 'read' })
  })

  test('only a pushed tag publishes: the GitHub release and npm', () => {
    const publishing = Object.entries(flow.jobs).filter(([, job]) => publishes(job))
    assert.deepEqual(publishing.map(([name]) => name).sort(), ['npm', 'release'])
    for (const [name, job] of publishing) assert.ok(isTagPush(job.if), `${name}: if is ${job.if}`)
    // Write rights only where it publishes.
    for (const [name, job] of Object.entries(flow.jobs)) {
      const rights = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write')
      if (!publishing.some(([n]) => n === name)) assert.deepEqual(rights, [], name)
    }
  })

  test('by hand, the five programs and SHA256SUMS are left as artifacts', () => {
    const build = flow.jobs.build!
    assert.equal(build.if, undefined)
    const assets = build.strategy!.matrix!.include!.map(one => one.asset)
    assert.deepEqual(assets.sort(), ['project-pm-linux-arm64', 'project-pm-linux-x64', 'project-pm-macos-arm64', 'project-pm-macos-x64', 'project-pm-windows-x64.exe'])
    assert.ok(build.steps.some(s => s.uses?.startsWith('actions/upload-artifact@') && s.with?.name === '${{ matrix.asset }}'))
    const sums = Object.entries(flow.jobs).find(([, job]) => job.steps.some(s => s.uses?.startsWith('actions/upload-artifact@') && s.with?.name === 'SHA256SUMS'))
    assert.ok(sums, 'no job uploads SHA256SUMS')
    const [name, job] = sums
    assert.equal(job.if, undefined, `${name} must run by hand too`)
    assert.ok(job.steps.some(s => /sha256sum\b.*>\s*SHA256SUMS/.test(s.run ?? '')), name)
    assert.ok(!publishes(job), name)
  })

  test('a run by hand is not held by the tag check: the tag is checked only on a tag, the program against package.json', () => {
    const build = flow.jobs.build!
    for (const s of build.steps.filter(one => /GITHUB_REF_NAME/.test(one.run ?? ''))) assert.match(s.if ?? '', /github\.ref_type\s*==\s*'tag'/, s.name)
    const tested = build.steps.find(s => /--version/.test(s.run ?? ''))
    assert.ok(tested?.run?.includes('package.json'), tested?.run)
  })
})
