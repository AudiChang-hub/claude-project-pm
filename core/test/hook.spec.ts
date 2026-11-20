/**
 * `project-pm hook claude-code <event>`, fed the events Claude Code 2.1.326 sent in a real `claude -p` run (recorded
 * 2026-11-19; the folders swapped for the Acme demo's): what each writes to the session's record, and what it says.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import { ALERT_SHOWN_MS } from '../src/guard'
import { runHook } from '../src/hook'
import { ct } from '../src/messages'
import type { HookInput } from '../src/hook'
import type { Run } from '../src/host'
import { resolveProject } from '../src/project'
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

    const RULES = '1. Tests first.\n'
    const guidelines = () => join(w.repo, 'GUIDELINES.md')
    const said = (out: unknown) => (out as { hookSpecificOutput?: { additionalContext?: string } } | null)?.hookSpecificOutput?.additionalContext ?? ''

    /**
     * The guidelines check only warns (T-39, option A): every hook call in these tests goes through `watching`, which
     * fails the test if the call changed, made, renamed or deleted anything in the folders named (the guidelines file,
     * a link, a file beside it).
     */
    let watched: string[] = []
    const shapeOf = (folder: string) => {
      if (!existsSync(folder)) return null
      const each = (name: string) => {
        const path = join(folder, name)
        const l = lstatSync(path)
        if (l.isSymbolicLink()) return { name, link: readlinkSync(path) }
        if (l.isDirectory()) return { name, dir: true }

        return { name, bytes: readFileSync(path, 'base64'), mtime: l.mtimeMs }
      }

      return readdirSync(folder).sort().map(each)
    }
    const watching = async <T>(call: () => Promise<T>): Promise<T> => {
      const before = watched.map(shapeOf)
      const out = await call()
      assert.deepEqual(watched.map(shapeOf), before, 'a hook changed something beside the guidelines file')

      return out
    }
    const step = (name: string, extra: Partial<HookInput>, at: number, session = SESSION, cwd = w.repo) =>
      watching(() => runHook('claude-code', name, { session_id: session, cwd, hook_event_name: name, ...extra }, w.env, at, hostWith()))
    const bash = (at: number, session = SESSION, cwd = w.repo) => step('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} }, at, session, cwd)
    const speak = (prompt: string, at: number, session = SESSION, cwd = w.repo) => step('UserPromptSubmit', { prompt }, at, session, cwd)
    const SESSION2 = '7c41d2a0-5b1e-4f7a-9d3e-2a6b8c0e4f11'
    const ID2 = `claude-code:${SESSION2}`
    const asks = lang === 'en' ? 'Please update the guidelines: add rule 2' : '請改準則，加第二條'
    const other = lang === 'en' ? 'Fix the checkout bug' : '修結帳的 bug'
    /**
     * The warning the model is told, word for word: `copy` is the read-only copy it points at (copyOf), or null when there
     * was nothing to copy; a project's file also gets its git history.
     */
    const warning = async (change: string, file: string, copy: string | null, later = false) => {
      const ref = (await resolveProject(w.repo))!
      const rel = relative(ref.path, file)
      let fix = copy ? ct(later ? 'guidelines.fix.copyLater' : 'guidelines.fix.copy', { copy, file }) : ct('guidelines.fix.noCopy')
      // Only a name of plain characters goes into a command (T-39 QA4 1).
      // A backslash is a separator only on Windows; elsewhere it is part of the name (T-39 QA6).
      const name = process.platform === 'win32' ? rel.replace(/\\/g, '/') : rel
      if (!rel.startsWith('..')) fix += /^[A-Za-z0-9._/ -]+$/.test(name) ? ct('guidelines.fix.history', { repo: ref.path, rel: name }) : ct('guidelines.fix.historyPlain')

      return ct('guidelines.alert', { file, what: ct(`guidelines.what.${change}` as Parameters<typeof ct>[0]), fix })
    }
    const copyOf = (text: string) => join(w.env.PROJECT_PM_HOME!, 'guidelines', 'copies', `${createHash('sha256').update(text).digest('hex')}.md`)
    const attention = async (actor?: string, extra?: Parameters<World['ctx']>[1]) => {
      const board = await boardTool(w.ctx(actor, extra), {})

      return (board.structured as { attention: { text: string }[] }).attention.map(a => a.text).filter(text => [ct('board.guidelinesAlert'), ct('board.guidelinesSettingAlert')].some(key => text.startsWith(key.slice(0, 8))))
    }
    /** The person's own guidelines file, shared by two projects, each with its own PM. */
    const sharedRules = async (mine = join(w.root, 'acme-rules.md')) => {
      const repo2 = join(w.root, 'acme-admin')
      mkdirSync(repo2)
      git(repo2, 'init', '-q')
      await pmTool(w.ctx(), { action: 'claim' })
      await pmTool(w.ctx('claude-code:pm2', { cwd: repo2 }), { action: 'claim' })
      mkdirSync(dirname(mine), { recursive: true })
      writeFileSync(mine, RULES)
      mkdirSync(w.env.PROJECT_PM_HOME!, { recursive: true })
      writeFileSync(join(w.env.PROJECT_PM_HOME!, 'config.json'), JSON.stringify({ guidelines: mine }))
      watched = [dirname(mine), w.repo, repo2]

      return { repo2, mine }
    }
    const projectRules = async () => {
      await lockGuidelines()
      watched = [w.repo]
    }

    test('a change nobody agreed to is warned about, never put back, and listed on the board for a week (T-39 A)', async () => {
      await projectRules()
      await speak(other, NOW)
      // A shell command the lock cannot see rewrites the file.
      writeFileSync(guidelines(), '1. Tests are optional.\n')
      assert.equal(said(await bash(NOW + 1000)), await warning('changed', guidelines(), copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), '1. Tests are optional.\n')
      // Said once: the next tool, with nothing new, says nothing.
      assert.equal(said(await bash(NOW + 2000)), '')
      // The board says so, in the person's language, with the session that saw it and how to look and undo.
      const lines = await attention()
      assert.equal(lines.length, 1, lines.join('\n'))
      // The copy from when the person spoke, and the file's git history; not git checkout, which a change already
      // added or committed would defeat (T-39 QA3 2).
      assert.ok(lines[0]!.includes(ID) && lines[0]!.includes(copyOf(RULES)) && lines[0]!.includes('git log -p -- "GUIDELINES.md"') && !lines[0]!.includes('git checkout'), lines[0])
      // Deleted, put back by hand, emptied: each one warned, none undone.
      rmSync(guidelines())
      assert.equal(said(await step('PostToolUse', { tool_name: 'PowerShell', tool_input: { command: 'Remove-Item GUIDELINES.md' }, tool_response: {} }, NOW + 3000)), await warning('deleted', guidelines(), copyOf(RULES)))
      assert.equal(existsSync(guidelines()), false)
      writeFileSync(guidelines(), RULES)
      assert.equal(said(await bash(NOW + 4000)), await warning('changed', guidelines(), copyOf(RULES)))
      writeFileSync(guidelines(), '')
      assert.equal(said(await step('PostToolUse', { tool_name: 'Write', tool_input: { file_path: guidelines() }, tool_response: {} }, NOW + 5000)), await warning('emptied', guidelines(), copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), '')
      // Changed after the turn's last tool: noticed when the turn stops (the board, not the model, hears of it).
      writeFileSync(guidelines(), 'after the last tool\n')
      assert.equal(await step('Stop', { last_assistant_message: 'done' }, NOW + 6000), null)
      assert.equal(readFileSync(guidelines(), 'utf8'), 'after the last tool\n')
      assert.equal((await attention()).length, 5)
      // Listed for a week, then no more.
      w.advance(ALERT_SHOWN_MS + 6000 - 1)
      assert.equal((await attention()).length, 1)
      w.advance(1)
      assert.equal((await attention()).length, 0)
      // Nothing of the check's lives in the repository.
      assert.equal(git(w.repo, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(l => l && !/GUIDELINES\.md|\.project-pm\.json/.test(l)).join('\n'), '')
    })

    test('a change the person agreed to this turn is not warned about; a later turn\'s change is (T-39 A)', async () => {
      await projectRules()
      await speak(asks, NOW)
      writeFileSync(guidelines(), `${RULES}2. Small commits.\n`)
      assert.equal(said(await step('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: guidelines() }, tool_response: {} }, NOW + 1000)), '')
      await speak(other, NOW + 2000)
      writeFileSync(guidelines(), 'nothing\n')
      assert.equal(said(await step('PostToolUse', { tool_name: 'Write', tool_input: { file_path: guidelines() }, tool_response: {} }, NOW + 3000)), await warning('changed', guidelines(), copyOf(`${RULES}2. Small commits.\n`)))
      assert.equal(readFileSync(guidelines(), 'utf8'), 'nothing\n')
      assert.equal((await attention()).length, 1)
    })

    test('the person\'s own edit, clearing or deletion between turns is not warned about; a notification waking the turn judges what changed (T-39 A)', async () => {
      await projectRules()
      await speak(other, NOW)
      writeFileSync(guidelines(), `${RULES}2. Mine.\n`)
      await speak(other, NOW + 1000)
      assert.equal(said(await bash(NOW + 2000)), '')
      writeFileSync(guidelines(), '')
      await speak(other, NOW + 3000)
      assert.equal(said(await bash(NOW + 4000)), '')
      rmSync(guidelines())
      await speak(other, NOW + 5000)
      assert.equal(said(await bash(NOW + 6000)), '')
      writeFileSync(guidelines(), RULES)
      await speak(other, NOW + 7000)
      // Something changes it after the turn, then a notification (not the person) starts one: warned there and then.
      writeFileSync(guidelines(), 'from a background command\n')
      assert.ok(said(await speak('<task-notification>done</task-notification>', NOW + 8000)).includes(await warning('changed', guidelines(), copyOf(RULES))))
      assert.equal(said(await bash(NOW + 9000)), '')
      // A tool that writes no file does not look; the next one that can does.
      writeFileSync(guidelines(), 'again\n')
      assert.equal(said(await step('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [] }, tool_response: {} }, NOW + 10_000)), '')
      assert.equal(said(await bash(NOW + 11_000)), await warning('changed', guidelines(), copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), 'again\n')
      assert.equal((await attention()).length, 2)
    })

    test('agreed in one project, seen by another project\'s session: it warns there, worded as maybe someone else, and keeps a copy (T-39 QA 1, A)', async () => {
      const { repo2, mine } = await sharedRules()
      await speak(other, NOW, SESSION2, repo2)
      await speak(asks, NOW + 1000)
      writeFileSync(mine, `${RULES}2. Small commits.\n`)
      assert.equal(said(await step('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: mine }, tool_response: {} }, NOW + 2000)), '')
      // Project 2's session did not agree this turn: it says what it saw, not that it did it.
      const out = said(await bash(NOW + 3000, SESSION2, repo2))
      assert.equal(out, await warning('changed', mine, copyOf(RULES)))
      assert.ok(out.includes(lang === 'en' ? 'another session' : '其他工作階段'), out)
      assert.equal(readFileSync(mine, 'utf8'), `${RULES}2. Small commits.\n`)
      // The read-only copy holds what project 2's turn began with, for the person to copy back by hand.
      assert.equal(readFileSync(copyOf(RULES), 'utf8'), RULES)
      assert.equal(statSync(copyOf(RULES)).mode & 0o200, 0)
      // Listed on project 2's board under its session; project 1's board, where it was agreed, lists nothing.
      const there = await attention('claude-code:pm2', { cwd: repo2 })
      assert.equal(there.length, 1)
      assert.ok(there[0]!.includes(ID2) && there[0]!.includes(copyOf(RULES)), there[0])
      assert.equal((await attention()).length, 0)
    })

    test('changed twice in one turn: both warnings point at the copy from when the person spoke, which restores it (T-39 QA3 2)', async () => {
      const { mine } = await sharedRules()
      await speak(other, NOW)
      writeFileSync(mine, 'first change\n')
      assert.equal(said(await bash(NOW + 1000)), await warning('changed', mine, copyOf(RULES)))
      writeFileSync(mine, 'second change\n')
      assert.equal(said(await bash(NOW + 2000)), await warning('changed', mine, copyOf(RULES)))
      // Restored as the warning says, by putting the copy's text back: the file as the person last left it.
      writeFileSync(mine, readFileSync(copyOf(RULES)))
      assert.equal(readFileSync(mine, 'utf8'), RULES)
      // An agreed change in a later turn moves the copy on: what was agreed is what a later stray change points back to.
      await speak(asks, NOW + 3000)
      writeFileSync(mine, `${RULES}2. Agreed.\n`)
      assert.equal(said(await bash(NOW + 4000)), '')
      writeFileSync(mine, 'stray, same turn\n')
      assert.equal(said(await bash(NOW + 5000)), '')
      await speak(other, NOW + 6000)
      writeFileSync(mine, 'stray\n')
      assert.equal(said(await bash(NOW + 7000)), await warning('changed', mine, copyOf('stray, same turn\n')))
    })

    test('a change already added or committed: the warning points at the copy, not git checkout, and the copy restores the turn\'s start (T-39 QA3 2)', async () => {
      await projectRules()
      git(w.repo, 'commit', '-q', '-m', 'Acme guidelines')
      await speak(other, NOW)
      writeFileSync(guidelines(), '1. Tests are optional.\n')
      git(w.repo, 'add', 'GUIDELINES.md')
      const staged = said(await bash(NOW + 1000))
      assert.equal(staged, await warning('changed', guidelines(), copyOf(RULES)))
      assert.ok(!staged.includes('git checkout') && !staged.includes('git diff'), staged)
      writeFileSync(guidelines(), '1. Tests are never needed.\n')
      git(w.repo, 'commit', '-q', '-am', 'Relax the Acme rules')
      assert.equal(said(await bash(NOW + 2000)), await warning('changed', guidelines(), copyOf(RULES)))
      // git's own version is the changed one now; the copy is the file as the turn began.
      assert.equal(git(w.repo, 'show', 'HEAD:GUIDELINES.md'), '1. Tests are never needed.')
      writeFileSync(guidelines(), readFileSync(copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), RULES)
    })

    test('a file name the repository chose is never put into a command to run; a plain name, spaces too, gets one (T-39 QA4 1)', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      watched = [w.repo]
      // Each would run in the double quotes of PowerShell or bash, or end them. Windows allows all of these in a name.
      const names = ['$(Start-Process calc).md', '`whoami`.md', "it's.md", 'a;b.md', 'a&b.md', '(x).md', 'x$HOME.md', '開發準則.md', ...(process.platform === 'win32' ? [] : ['say "hi".md', 'a|b.md', 'back\\slash.md'])]
      let at = NOW
      const watch = async (name: string) => {
        writeFileSync(join(w.repo, name), RULES)
        git(w.repo, 'add', '--', name)
        writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines: name }))
        await speak(other, (at += 1000))
        writeFileSync(join(w.repo, name), 'changed\n')

        return said(await bash((at += 1000)))
      }
      for (const name of names) {
        const out = await watch(name)
        assert.equal(out, await warning('changed', join(w.repo, name), copyOf(RULES)), name)
        assert.ok(!out.includes('git log -p --'), `a command with ${name} in it: ${out}`)
        assert.ok(out.includes(ct('guidelines.fix.historyPlain').trim()), out)
      }
      const plain = await watch('Acme Rules.md')
      assert.ok(plain.includes('git log -p -- "Acme Rules.md"'), plain)
    })

    test('on Linux and macOS a name with a backslash is that name: docs\\rules.md is not the docs/rules.md git tracks (T-39 QA6)', async t => {
      if (process.platform === 'win32') return t.skip('a backslash is a separator on Windows; project.spec checks the rule there')
      await pmTool(w.ctx(), { action: 'claim' })
      watched = [w.repo]
      // git tracks docs/rules.md; beside it, untracked, a file whose name is docs\rules.md (a .env-like file, say).
      mkdirSync(join(w.repo, 'docs'))
      writeFileSync(join(w.repo, 'docs', 'rules.md'), RULES)
      git(w.repo, 'add', 'docs/rules.md')
      writeFileSync(join(w.repo, 'docs\\rules.md'), 'ACME_SECRET=1\n')
      writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines: 'docs\\rules.md' }))
      // Not tracked: no guidelines from it, and nothing of it handed to the model.
      const out = said(await speak(other, NOW))
      assert.ok(!out.includes('ACME_SECRET'), out)
      assert.ok(!out.includes(RULES.trim()), out)
      // Nor is it watched: changing it says nothing (the setting is none).
      writeFileSync(join(w.repo, 'docs\\rules.md'), 'ACME_SECRET=2\n')
      assert.equal(said(await bash(NOW + 1000)), '')
    })

    test('once a day, baselines unused for a month and copies nothing points at go; a copy in use stays (T-39 QA3)', async () => {
      const { mine } = await sharedRules()
      await speak(other, NOW)
      const day = 24 * 60 * 60 * 1000
      const folder = join(w.env.PROJECT_PM_HOME!, 'guidelines')
      const old = (file: string, ms: number) => {
        writeFileSync(file, '{}')
        utimesSync(file, (NOW - ms) / 1000, (NOW - ms) / 1000)
      }
      old(join(folder, 'copies', 'orphan.md'), 40 * day)
      old(join(folder, 'copies', 'recent.md'), 10 * day)
      old(join(folder, 'sessions', 'gone.json'), 31 * day)
      // Within a day of the last sweep: nothing is looked for.
      await speak(other, NOW + 1000)
      assert.ok(existsSync(join(folder, 'copies', 'orphan.md')))
      await speak(other, NOW + 2 * day)
      assert.equal(existsSync(join(folder, 'copies', 'orphan.md')), false)
      assert.equal(existsSync(join(folder, 'sessions', 'gone.json')), false)
      assert.ok(existsSync(join(folder, 'copies', 'recent.md')))
      // The copy this session points at was touched when used again, and stays; the guidelines file is untouched.
      assert.equal(readFileSync(copyOf(RULES), 'utf8'), RULES)
      assert.equal(readFileSync(mine, 'utf8'), RULES)
      writeFileSync(mine, 'changed\n')
      assert.equal(said(await bash(NOW + 2 * day + 1000)), await warning('changed', mine, copyOf(RULES)))
    })

    test('the person\'s own edit, clearing or deletion between turns, in whichever project they speak, is not warned about there (T-39 QA 1, A)', async () => {
      const { repo2, mine } = await sharedRules()
      await speak(other, NOW - 500, SESSION2, repo2)
      await speak(other, NOW)
      writeFileSync(mine, `${RULES}2. Mine.\n`)
      await speak(other, NOW + 1000)
      assert.equal(said(await bash(NOW + 2000)), '')
      // Project 2's session, busy since before the edit, cannot tell it from someone else's: it warns, without saying who.
      const there = said(await bash(NOW + 2500, SESSION2, repo2))
      assert.equal(there, await warning('changed', mine, copyOf(RULES)))
      assert.ok(there.includes(lang === 'en' ? 'the user' : '使用者自己'), there)
      writeFileSync(mine, '')
      await speak(other, NOW + 3000)
      assert.equal(said(await bash(NOW + 4000)), '')
      rmSync(mine)
      await speak(other, NOW + 5000)
      assert.equal(said(await bash(NOW + 6000)), '')
      assert.equal(existsSync(mine), false)
      // Deleted when the turn began: nothing to copy, and the warning says where else to look.
      writeFileSync(mine, 'new\n')
      assert.equal(said(await bash(NOW + 7000)), await warning('changed', mine, null))
    })

    /** How a guidelines setting reads in a warning: the project's file, the person's own, none, or one that could not be read. */
    type Setting = { from: 'project'; file: string } | { from: 'user'; file: string } | { from: 'none' } | { from: 'unreadable'; reason: 'git' | 'corrupt' | 'notPlain' }
    const settingWords = (s: Setting) => {
      if (s.from === 'project' || s.from === 'user') return ct(`guidelines.setting.${s.from}` as Parameters<typeof ct>[0], { file: s.file })
      if (s.from === 'none') return ct('guidelines.setting.none')

      return ct('guidelines.setting.unreadable', { reason: ct(`guidelines.reason.${s.reason}` as Parameters<typeof ct>[0]) })
    }
    /** The setting warning the model is told, word for word. */
    /** `copy`: the old file's copy, from when the person spoke, or taken later in the turn (`later`). */
    const settingWarning = async (was: Setting, now: Setting, copy: string | null, later = false) => {
      const ref = (await resolveProject(w.repo))!
      const file = 'file' in was ? was.file : ''
      const fix = ct('guidelines.fix.setting', { repo: ref.path }) + (copy ? ct(later ? 'guidelines.fix.settingCopyLater' : 'guidelines.fix.settingCopy', { copy, file }) : '')

      return ct('guidelines.settingAlert', { was: settingWords(was), now: settingWords(now), fix })
    }
    const projectFile = (name = 'GUIDELINES.md'): Setting => ({ from: 'project', file: join(w.repo, name) })

    test('turned off, edited, turned on: the old file is never compared; each change of the setting is warned (T-39 QA 2, QA3 1)', async () => {
      const config = (value: object) => writeFileSync(join(w.env.PROJECT_PM_HOME!, 'config.json'), JSON.stringify(value))
      const { mine } = await sharedRules()
      await speak(other, NOW)
      // `/pm guidelines off` (or anything else) turns them off this turn without the person agreeing: said once.
      config({})
      writeFileSync(mine, 'my notes now\n')
      assert.equal(said(await bash(NOW + 1000)), await settingWarning({ from: 'user', file: mine }, { from: 'none' }, copyOf(RULES)))
      // The old file is no longer compared: editing it while off says nothing.
      writeFileSync(mine, 'my notes, again\n')
      assert.equal(said(await bash(NOW + 2000)), '')
      // On again, in the same turn: said, and what the file holds now is where the session goes on from.
      config({ guidelines: mine })
      assert.equal(said(await bash(NOW + 3000)), await settingWarning({ from: 'none' }, { from: 'user', file: mine }, null))
      assert.equal(readFileSync(mine, 'utf8'), 'my notes, again\n')
      writeFileSync(mine, 'changed\n')
      // Still the copy from when the person spoke, not the text written while off, which nobody agreed to (T-39 QA4 2).
      assert.equal(said(await bash(NOW + 4000)), await warning('changed', mine, copyOf(RULES)))
      assert.equal((await attention()).length, 3)
      // Turned off in a turn where the person asked about the guidelines: not warned.
      await speak(lang === 'en' ? '/pm guidelines off' : '/pm 準則 關掉', NOW + 5000)
      config({})
      assert.equal(said(await bash(NOW + 6000)), '')
      // Off between turns, the person speaking: not warned either.
      config({ guidelines: mine })
      await speak(other, NOW + 7000)
      assert.equal(said(await bash(NOW + 8000)), '')
    })

    test('the project names another file: warned as a change of the setting, the old file no longer compared, the new one is (T-39 QA 2, QA3 1)', async () => {
      await projectRules()
      await speak(other, NOW)
      writeFileSync(join(w.repo, 'RULES.md'), '1. Rules elsewhere.\n')
      git(w.repo, 'add', 'RULES.md')
      writeFileSync(join(w.repo, '.project-pm.json'), JSON.stringify({ guidelines: 'RULES.md' }))
      writeFileSync(guidelines(), 'old file, free now\n')
      assert.equal(said(await bash(NOW + 1000)), await settingWarning(projectFile(), projectFile('RULES.md'), copyOf(RULES)))
      writeFileSync(guidelines(), 'still free\n')
      assert.equal(said(await bash(NOW + 2000)), '')
      writeFileSync(join(w.repo, 'RULES.md'), 'changed\n')
      assert.equal(said(await bash(NOW + 3000)), await warning('changed', join(w.repo, 'RULES.md'), copyOf('1. Rules elsewhere.\n'), true))
      assert.equal(readFileSync(guidelines(), 'utf8'), 'still free\n')
    })

    test('given up and taken back in one turn (git rm --cached, git add): a later change points at the copy from when the person spoke (T-39 QA4 2)', async () => {
      await projectRules()
      await speak(other, NOW)
      git(w.repo, 'rm', '-q', '--cached', 'GUIDELINES.md')
      writeFileSync(guidelines(), 'while not tracked\n')
      assert.equal(said(await bash(NOW + 1000)), await settingWarning(projectFile(), { from: 'none' }, copyOf(RULES)))
      git(w.repo, 'add', 'GUIDELINES.md')
      assert.equal(said(await bash(NOW + 2000)), await settingWarning({ from: 'none' }, projectFile(), null))
      writeFileSync(guidelines(), 'changed again\n')
      const out = said(await bash(NOW + 3000))
      assert.equal(out, await warning('changed', guidelines(), copyOf(RULES)))
      assert.ok(!out.includes(copyOf('while not tracked\n')), out)
      // Restored as the warning says: the file as the person last left it.
      writeFileSync(guidelines(), readFileSync(copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), RULES)
      // An agreed turn starts afresh: the copy is what the file holds then.
      await speak(asks, NOW + 4000)
      writeFileSync(guidelines(), `${RULES}2. Agreed.\n`)
      assert.equal(said(await bash(NOW + 5000)), '')
      await speak(other, NOW + 6000)
      // -f: the index holds a version neither the file nor HEAD has (added, never committed, then changed).
      git(w.repo, 'rm', '-q', '-f', '--cached', 'GUIDELINES.md')
      assert.equal(said(await bash(NOW + 7000)), await settingWarning(projectFile(), { from: 'none' }, copyOf(`${RULES}2. Agreed.\n`)))
    })

    test('git rm, git rm --cached or git mv of the project\'s guidelines file is warned about, file left as it is (T-39 QA3 1)', async () => {
      await projectRules()
      const none: Setting = { from: 'none' }
      // git rm --cached: the file stays on disk, git no longer tracks it, so the project no longer names it.
      await speak(other, NOW)
      git(w.repo, 'rm', '-q', '--cached', 'GUIDELINES.md')
      const out = said(await bash(NOW + 1000))
      assert.notEqual(out, '', 'git rm --cached went unnoticed')
      assert.equal(out, await settingWarning(projectFile(), none, copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), RULES)
      // Put back by the person between turns: their own doing, not warned.
      git(w.repo, 'add', 'GUIDELINES.md')
      await speak(other, NOW + 2000)
      assert.equal(said(await bash(NOW + 3000)), '')
      // git mv: the project's setting still names the old name, which git no longer tracks.
      git(w.repo, 'mv', 'GUIDELINES.md', 'RULES2.md')
      assert.equal(said(await bash(NOW + 4000)), await settingWarning(projectFile(), none, copyOf(RULES)))
      assert.ok(existsSync(join(w.repo, 'RULES2.md')))
      git(w.repo, 'mv', 'RULES2.md', 'GUIDELINES.md')
      await speak(other, NOW + 5000)
      // git rm (-f: the file was added, never committed): gone from git and from disk.
      git(w.repo, 'rm', '-q', '-f', 'GUIDELINES.md')
      assert.equal(said(await bash(NOW + 6000)), await settingWarning(projectFile(), none, copyOf(RULES)))
      assert.equal(existsSync(guidelines()), false)
      // With the person's own file set too, the project falling back to it is a change of the setting as well.
      const mine = join(w.root, 'acme-rules.md')
      writeFileSync(mine, RULES)
      writeFileSync(join(w.env.PROJECT_PM_HOME!, 'config.json'), JSON.stringify({ guidelines: mine }))
      assert.equal(said(await bash(NOW + 7000)), await settingWarning(none, { from: 'user', file: mine }, null))
      assert.equal((await attention()).length, 4)
    })

    test('.project-pm.json edited by a tool, or unreadable, or git not answering: warned as a change of the setting (T-39 QA3 1)', async () => {
      await projectRules()
      const settings = join(w.repo, '.project-pm.json')
      await speak(other, NOW)
      // Edit (not locked) points the project at another tracked file.
      writeFileSync(settings, JSON.stringify({ guidelines: 'README.md' }))
      const out = said(await step('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: settings }, tool_response: {} }, NOW + 1000))
      assert.notEqual(out, '', 'an edit of .project-pm.json went unnoticed')
      assert.equal(out, await settingWarning(projectFile(), projectFile('README.md'), copyOf(RULES)))
      // …then drops the setting.
      writeFileSync(settings, JSON.stringify({}))
      assert.equal(said(await step('PostToolUse', { tool_name: 'Write', tool_input: { file_path: settings }, tool_response: {} }, NOW + 2000)), await settingWarning(projectFile('README.md'), { from: 'none' }, copyOf('# Acme Shop\n'), true))
      // Not JSON any more: it cannot be read.
      writeFileSync(settings, JSON.stringify({ guidelines: 'GUIDELINES.md' }))
      await speak(other, NOW + 3000)
      writeFileSync(settings, '{ "guidelines": ')
      assert.equal(said(await bash(NOW + 4000)), await settingWarning(projectFile(), { from: 'unreadable', reason: 'corrupt' }, copyOf(RULES)))
      // git does not answer whether the file is tracked (a timeout, say): it cannot be told either.
      writeFileSync(settings, JSON.stringify({ guidelines: 'GUIDELINES.md' }))
      await speak(other, NOW + 5000)
      const silent: Run = async (argv, cwd, ms) => (argv.includes('ls-files') ? null : hostWith()(argv, cwd, ms))
      const quiet = await watching(() => runHook('claude-code', 'PostToolUse', { session_id: SESSION, cwd: w.repo, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} }, w.env, NOW + 6000, silent))
      assert.equal(said(quiet), await settingWarning(projectFile(), { from: 'unreadable', reason: 'git' }, copyOf(RULES)))
      // A notification waking the session after the setting changed: warned there too.
      writeFileSync(settings, JSON.stringify({}))
      assert.ok(said(await speak('<task-notification>done</task-notification>', NOW + 7000)).includes(await settingWarning({ from: 'unreadable', reason: 'git' }, { from: 'none' }, null)))
      // Changed in a turn where the person asked about the guidelines: not warned.
      await speak(asks, NOW + 8000)
      writeFileSync(settings, JSON.stringify({ guidelines: 'GUIDELINES.md' }))
      assert.equal(said(await bash(NOW + 9000)), '')
    })

    test('the file\'s folder swapped for a link to another folder, same text: warned, nothing written through (T-39 QA2 1, A)', async () => {
      const rules = join(w.root, 'rules')
      const { mine } = await sharedRules(join(rules, 'acme.md'))
      watched = [w.root, join(w.root, 'other'), join(w.root, 'rules-before'), w.repo]
      await speak(other, NOW)
      renameSync(rules, join(w.root, 'rules-before'))
      mkdirSync(join(w.root, 'other'))
      writeFileSync(join(w.root, 'other', 'acme.md'), RULES)
      // A junction on Windows: no special right needed.
      symlinkSync(join(w.root, 'other'), rules, process.platform === 'win32' ? 'junction' : 'dir')
      assert.equal(said(await bash(NOW + 1000)), await warning('linked', mine, copyOf(RULES)))
      assert.equal(readFileSync(join(w.root, 'other', 'acme.md'), 'utf8'), RULES)
      assert.equal(readFileSync(join(w.root, 'rules-before', 'acme.md'), 'utf8'), RULES)
    })

    test('the file itself made a link, then pointed elsewhere: warned each time, the link left as it is (T-39 QA2 1, A)', async () => {
      await projectRules()
      watched = [w.repo, w.root]
      await speak(other, NOW)
      writeFileSync(join(w.root, 'same.md'), RULES)
      writeFileSync(join(w.root, 'else.md'), RULES)
      let canLink = true
      try {
        rmSync(guidelines())
        symlinkSync(join(w.root, 'same.md'), guidelines(), 'file')
      } catch {
        // Windows without Developer Mode cannot make a file link: the program is shown one instead (watchFs), which
        // it may look at (lstat, readlink) and follow to a local file, never open as itself.
        canLink = false
        writeFileSync(guidelines(), RULES)
      }
      const asLink = async (target: string, at: number) => {
        if (canLink) {
          rmSync(guidelines())
          symlinkSync(target, guidelines(), 'file')

          return said(await bash(at))
        }
        const before = watched.map(shapeOf)
        const fs = watchFs({ [guidelines()]: target })
        try {
          const out = await runHook('claude-code', 'PostToolUse', { session_id: SESSION, cwd: w.repo, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ln -s' }, tool_response: {} }, w.env, at, hostWith())
          assert.deepEqual(fs.remote, [], 'opened the link itself')

          return said(out)
        } finally {
          fs.restore()
          assert.deepEqual(watched.map(shapeOf), before)
        }
      }
      assert.equal(await asLink(join(w.root, 'same.md'), NOW + 1000), await warning('linked', guidelines(), copyOf(RULES)))
      assert.equal(await asLink(join(w.root, 'else.md'), NOW + 2000), await warning('linked', guidelines(), copyOf(RULES)))
      if (canLink) {
        assert.equal(readlinkSync(guidelines()), join(w.root, 'else.md'))
        // A turn that starts with the project's file leading out of the repository: nothing of it is copied (T-39 QA3 2).
        await speak(other, NOW + 3000)
        writeFileSync(join(w.root, 'else.md'), 'stray\n')
        assert.equal(said(await bash(NOW + 4000)), await warning('changed', guidelines(), null))
      }
    })

    test('the file or its folder made a link to a network share: warned, and the share never looked up (T-39 QA2 1, A)', async t => {
      if (process.platform !== 'win32') return t.skip('only Windows reads \\\\host\\share as another machine')
      const rules = join(w.root, 'rules')
      const { mine } = await sharedRules(join(rules, 'acme.md'))
      await speak(other, NOW)
      for (const [at, link] of [[NOW + 1000, rules], [NOW + 2000, mine]] as const) {
        const before = watched.map(shapeOf)
        const fs = watchFs({ [link]: `\\\\${PROBE_HOST}\\share` })
        let out: unknown
        try {
          out = await runHook('claude-code', 'PostToolUse', { session_id: SESSION, cwd: w.repo, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} }, w.env, at, hostWith())
          assert.deepEqual(fs.remote, [], `looked up the share through ${link}`)
        } finally {
          fs.restore()
        }
        assert.equal(said(out), await warning('unplain', mine, copyOf(RULES)))
        assert.deepEqual(watched.map(shapeOf), before)
        // Back to the plain file: that is a change from the share too, and said.
        assert.equal(said(await bash(at + 500)), await warning('changed', mine, copyOf(RULES)))
      }
    })

    test('two sessions in one project, interleaved: each warns of what it did not agree to, worded as maybe someone else (T-39 QA2 2, A)', async () => {
      await projectRules()
      await speak(asks, NOW)
      await speak(other, NOW + 100, SESSION2)
      // Session 1 was asked to change the guidelines and does; session 2's next tool sees it.
      writeFileSync(guidelines(), `${RULES}2. Small commits.\n`)
      const seen = said(await bash(NOW + 200, SESSION2))
      assert.equal(seen, await warning('changed', guidelines(), copyOf(RULES)))
      assert.ok(seen.includes(lang === 'en' ? 'another session' : '其他工作階段'), seen)
      assert.equal(said(await step('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: guidelines() }, tool_response: {} }, NOW + 300)), '')
      assert.equal(said(await bash(NOW + 400, SESSION2)), '')
      // Session 2 changes it unasked: it warns; session 1, asked this turn, does not.
      writeFileSync(guidelines(), 'by session 2\n')
      assert.equal(said(await bash(NOW + 500, SESSION2)), await warning('changed', guidelines(), copyOf(RULES)))
      assert.equal(said(await bash(NOW + 600)), '')
      // Session 1's next turn is not about the guidelines: a change after it is warned there too.
      await speak(other, NOW + 700)
      writeFileSync(guidelines(), 'by someone\n')
      assert.equal(said(await bash(NOW + 800)), await warning('changed', guidelines(), copyOf('by session 2\n')))
      assert.equal(said(await bash(NOW + 900, SESSION2)), await warning('changed', guidelines(), copyOf(RULES)))
      assert.equal(readFileSync(guidelines(), 'utf8'), 'by someone\n')
      const lines = await attention()
      assert.equal(lines.length, 4)
      assert.deepEqual(lines.map(line => (line.includes(ID2) ? 2 : line.includes(ID) ? 1 : 0)).sort(), [1, 2, 2, 2])
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
