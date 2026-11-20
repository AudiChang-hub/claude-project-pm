/**
 * `project-pm hook claude-code <event>`, fed the events Claude Code 2.1.326 sent in a real `claude -p` run (recorded
 * 2026-11-19; the folders swapped for the Acme demo's): what each writes to the session's record, and what it says.
 */
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import { runHook } from '../src/hook'
import type { HookInput } from '../src/hook'
import { loadActor } from '../src/store'
import { boardTool, pmTool, reportTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, NOW, PROBE_HOST, git, hostWith, shortPath, watchFs, world } from './helpers'

const SESSION = '1f0ba5e3-d73c-4a06-ab9f-283b7537d1be'
const ID = `claude-code:${SESSION}`
/** `t`, under a name a test's own `t` does not hide. */
const tr = t

for (const lang of LANGS) {
  describe(`hooks (${lang})`, () => {
    let w: World
    beforeEach(() => {
      w = world(lang)
    })
    afterEach(() => w.done())

    const event = (name: string, extra: Partial<HookInput>): HookInput => ({ session_id: SESSION, cwd: w.repo, hook_event_name: name, ...extra })
    const hook = (name: string, extra: Partial<HookInput>, at = NOW) => runHook('claude-code', name, event(name, extra), w.env, at, hostWith())
    const actor = async () => (await loadActor(ID, w.env))!

    test('UserPromptSubmit keeps the instruction and names the session after it', async () => {
      const out = await hook('UserPromptSubmit', { prompt: 'Add a coupon field to the Acme checkout' })
      assert.equal(out, null)
      const one = await actor()
      assert.equal(one.state, 'running')
      assert.equal(one.lastPrompt, 'Add a coupon field to the Acme checkout')
      assert.equal(one.title, 'Add a coupon field to the Acme checkout')
    })

    test('with a PM, another session is asked to report and told its actor id; the PM is not', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      const out = (await hook('UserPromptSubmit', { prompt: 'Add a coupon field' })) as { hookSpecificOutput: { additionalContext: string } }
      const said = out.hookSpecificOutput.additionalContext
      assert.ok(said.includes(t('role.delivery', { project: 'acme-shop', tool: 'mcp__project-pm__report' }).slice(0, 20)), said)
      assert.ok(said.includes(ID), said)
      const asPm = await runHook('claude-code', 'UserPromptSubmit', { session_id: 'pm1', cwd: w.repo, prompt: 'status?' }, w.env, NOW, hostWith())
      assert.equal(asPm, null)
    })

    test('the guidelines go into every turn of a project with a PM, and their file is locked unless asked about', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      writeFileSync(join(w.repo, 'GUIDELINES.md'), '1. Tests first.\n')
      // The project's guidelines must be a file git tracks (T-37 QA2 6).
      git(w.repo, 'add', 'GUIDELINES.md')
      writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines: 'GUIDELINES.md' }))
      const out = (await hook('UserPromptSubmit', { prompt: 'Add a coupon field' })) as { hookSpecificOutput: { additionalContext: string } }
      assert.ok(out.hookSpecificOutput.additionalContext.includes('1. Tests first.'))
      const file = join(w.repo, 'GUIDELINES.md')
      const denied = (await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: file } })) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }
      assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
      assert.ok(denied.hookSpecificOutput.permissionDecisionReason.startsWith(t('guidelines.locked', { file: '' }).slice(0, 6)))
      await hook('UserPromptSubmit', { prompt: lang === 'en' ? 'Please update the guidelines: add rule 2' : '請改準則，加一條' })
      assert.equal(await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: file } }), null)
      assert.equal(await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: join(w.repo, 'coupon.js') } }), null)
    })

    test('the guidelines file is locked however its path is written: through a folder link, by its 8.3 name (T-37 Windows CI)', async t => {
      await pmTool(w.ctx(), { action: 'claim' })
      const name = 'Acme Development Guidelines.md'
      writeFileSync(join(w.repo, name), '1. Tests first.\n')
      git(w.repo, 'add', name)
      writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines: name }))
      const spellings: string[] = []
      // The same folder through a link: a junction on Windows, a symbolic link elsewhere.
      const alias = join(w.root, 'acme-alias')
      try {
        symlinkSync(w.repo, alias, 'junction')
        spellings.push(join(alias, name))
      } catch (err) {
        if (process.platform !== 'win32') throw err
      }
      // Windows' short name for the same file, where the volume keeps 8.3 names (GitHub's runners do).
      if (process.platform === 'win32') {
        const short = shortPath(join(w.repo, name))
        if (short && short !== join(w.repo, name)) spellings.push(short)
      }
      if (!spellings.length) return t.skip('this system offers no second spelling of the same file')
      for (const file of spellings) {
        const denied = (await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: file } })) as { hookSpecificOutput?: { permissionDecision: string } } | null
        assert.equal(denied?.hookSpecificOutput?.permissionDecision, 'deny', file)
      }
      // A file of the same name elsewhere is not the guidelines file.
      mkdirSync(join(w.root, 'elsewhere'))
      writeFileSync(join(w.root, 'elsewhere', name), 'other\n')
      assert.equal(await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: join(w.root, 'elsewhere', name) } }), null)
    })

    /** A project with a PM whose guidelines file is GUIDELINES.md, committed. */
    const lockGuidelines = async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      writeFileSync(join(w.repo, 'GUIDELINES.md'), '1. Tests first.\n')
      git(w.repo, 'add', 'GUIDELINES.md')
      writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines: 'GUIDELINES.md' }))
    }
    type Decision = { hookSpecificOutput?: { permissionDecision: string; permissionDecisionReason: string } } | null

    test('a network path is never looked up before the person allows it: the lock refuses it unread (T-37 QA5)', async t => {
      // Windows connects to the host (SMB, with the person's NTLM hash) the moment such a path is looked up.
      if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
      await lockGuidelines()
      const drive = w.repo.slice(0, 1)
      const targets = [
        `\\\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `//${PROBE_HOST}/share/GUIDELINES.md`,
        `\\\\?\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `\\\\.\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `\\\\?\\GLOBALROOT\\Device\\Mup\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `\\??\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        // This machine's own disk, reached as a share: the same file in another spelling (QA5's bypass).
        `\\\\localhost\\${drive}$${w.repo.slice(2)}\\GUIDELINES.md`,
        // A drive written as a device, with .. climbing out of it: Windows folds the .. into the prefix and opens
        // \\.\UNC\host\share\… (QA6).
        `\\\\.\\C:\\..\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `//./C:/../UNC/${PROBE_HOST}/share/GUIDELINES.md`,
        `\\\\.\\C:\\x\\..\\..\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `\\\\?\\C:\\..\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        `\\\\.\\C:\\.\\..\\UNC\\${PROBE_HOST}\\share\\GUIDELINES.md`,
        // …and the guidelines file itself that way, through this machine's own share.
        `\\\\.\\${drive}:\\..\\UNC\\localhost\\${drive}$${w.repo.slice(2)}\\GUIDELINES.md`,
        // Not plain on this machine either (T-39): its stream, a name Windows trims to it, a drive-relative spelling.
        `${join(w.repo, 'GUIDELINES.md')}::$DATA`,
        `${join(w.repo, 'GUIDELINES.md')}.`,
        `${drive}:GUIDELINES.md`,
      ]
      const fs = watchFs()
      try {
        for (const file of targets) {
          const decision = (await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: file } })) as Decision
          assert.deepEqual(fs.remote, [], `looked up ${file}`)
          assert.equal(decision?.hookSpecificOutput?.permissionDecision, 'deny', file)
          assert.equal(decision?.hookSpecificOutput?.permissionDecisionReason, tr('guidelines.remote', { path: file, file: join(w.repo, 'GUIDELINES.md') }), file)
        }
        // With a trailing space (which Windows trims): the guidelines file by its name, refused too.
        const spaced = (await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${join(w.repo, 'GUIDELINES.md')} ` } })) as Decision
        assert.equal(spaced?.hookSpecificOutput?.permissionDecision, 'deny')
        assert.deepEqual(fs.remote, [], 'looked up a network path')
        // Once the person asks about the guidelines the lock stands aside, and still nothing is looked up.
        await hook('UserPromptSubmit', { prompt: lang === 'en' ? 'Please update the guidelines' : '請改準則' })
        for (const file of targets) assert.equal(await hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: file } }), null, file)
        assert.deepEqual(fs.remote, [], 'looked up a network path')
      } finally {
        fs.restore()
      }
    })

    test('a link on the way to the file that leads to a network share is not followed (T-37 QA5)', async t => {
      if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
      await lockGuidelines()
      const fs = watchFs({ [join(w.repo, 'shared')]: `\\\\${PROBE_HOST}\\share` })
      try {
        const file = join(w.repo, 'shared', 'notes.md')
        const decision = (await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: file } })) as Decision
        assert.deepEqual(fs.remote, [], 'followed a link to a network share')
        assert.equal(decision?.hookSpecificOutput?.permissionDecision, 'deny')
        // A file on this machine beside it is the person's to allow, as before.
        assert.equal(await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: join(w.repo, 'coupon.js') } }), null)
      } finally {
        fs.restore()
      }
    })

    test('the long-path spellings of a local file (\\\\?\\C:\\, \\\\.\\C:\\) are refused while the lock stands, unread (T-39)', async t => {
      if (process.platform !== 'win32') return t.skip('the \\\\?\\ prefix is Windows\'')
      await lockGuidelines()
      const file = join(w.repo, 'GUIDELINES.md')
      mkdirSync(join(w.root, 'elsewhere'))
      writeFileSync(join(w.root, 'elsewhere', 'GUIDELINES.md'), 'other\n')
      // Not plain paths (localpath.ts): the guidelines file in any of them, and any other file too, is refused.
      const spellings = [`\\\\?\\${file}`, `\\\\.\\${file}`, `\\\\?\\${file.toUpperCase()}`, `\\\\?\\${join(w.root, 'elsewhere', 'GUIDELINES.md')}`]
      const short = shortPath(file)
      if (short && short !== file) spellings.push(`\\\\?\\${short}`)
      const fs = watchFs()
      try {
        for (const spelling of spellings) {
          const decision = (await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: spelling } })) as Decision
          assert.equal(decision?.hookSpecificOutput?.permissionDecision, 'deny', spelling)
          assert.equal(decision?.hookSpecificOutput?.permissionDecisionReason, tr('guidelines.remote', { path: spelling, file }), spelling)
        }
        assert.deepEqual(fs.remote, [])
      } finally {
        fs.restore()
      }
    })

    test('TaskCreate and TaskUpdate (Claude Code 2.1.326) and TodoWrite keep the task list', async () => {
      await hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Step A' }, tool_response: { task: { id: '1', subject: 'Step A' } } })
      await hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Step B' }, tool_response: { task: { id: '2', subject: 'Step B' } } })
      await hook('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true } })
      assert.deepEqual((await actor()).plan, [
        { content: 'Step A', status: 'completed' },
        { content: 'Step B', status: 'pending' },
      ])
      await hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Only step', status: 'in_progress' }] } })
      assert.deepEqual((await actor()).plan, [{ content: 'Only step', status: 'in_progress' }])
    })

    test('a background command is kept until its notification, or until Stop says none runs', async () => {
      await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the Acme tests', run_in_background: true }, tool_response: { backgroundTaskId: 'bbqvaji66' } })
      assert.deepEqual((await actor()).background, [{ id: 'bbqvaji66', label: 'Run the Acme tests', at: NOW }])
      await hook('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>bbqvaji66</task-id>\n<status>completed</status>\n</task-notification>' })
      const one = await actor()
      assert.deepEqual(one.background, [])
      assert.equal(one.lastPrompt, undefined)
      await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'sleep 3', run_in_background: true }, tool_response: { backgroundTaskId: 'b2' } })
      await hook('Stop', { last_assistant_message: 'Started it.', background_tasks: [] })
      assert.deepEqual((await actor()).background, [])
    })

    test('Stop keeps the last words; a report from before the turn goes', async () => {
      await reportTool(w.ctx(ID), { status: 'done', summary: 'Earlier work' })
      await hook('UserPromptSubmit', { prompt: 'Now the shipping rates' }, NOW + 1000)
      await hook('Stop', { last_assistant_message: 'Shipping rates are in. Ship them now?' }, NOW + 2000)
      const one = await actor()
      assert.equal(one.state, 'idle')
      assert.equal(one.lastAnswer, 'Shipping rates are in. Ship them now?')
      assert.equal(one.report, undefined)
      const board = await boardTool(w.ctx(), {})
      const actors = board.structured.actors as { id: string; status: string }[]
      assert.deepEqual(actors.map(a => [a.id, a.status]), [[ID, 'asking']])
    })

    test('the PM is not listed among the sessions it follows', async () => {
      await pmTool(w.ctx(ID), { action: 'claim' })
      await hook('UserPromptSubmit', { prompt: 'How is the shop doing?' })
      const board = await boardTool(w.ctx(ID), {})
      assert.deepEqual(board.structured.actors, [])
    })

    test('a session with steps left shows open on the board', async () => {
      await hook('UserPromptSubmit', { prompt: 'Coupon field' })
      await hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Write tests', status: 'completed' }, { content: 'Wire the field', status: 'pending' }] } })
      await hook('Stop', { last_assistant_message: 'Tests are written.' })
      const board = await boardTool(w.ctx(), {})
      assert.deepEqual((board.structured.actors as { status: string }[]).map(a => a.status), ['open'])
    })

    test('a folder outside git keeps nothing', async () => {
      mkdirSync(join(w.home, 'notes'))
      const out = await runHook('claude-code', 'UserPromptSubmit', { session_id: SESSION, cwd: join(w.home, 'notes'), prompt: 'x' }, w.env, NOW, hostWith())
      assert.equal(out, null)
      assert.equal(await loadActor(ID, w.env), null)
    })
  })
}
