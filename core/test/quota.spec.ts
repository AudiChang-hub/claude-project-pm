// T-48 (M8): the core's side of context and quota: the transcript's tail, the Stop hook, the PM's own hand-over claim,
// the thresholds from config.json, and the one-line ledger update the mod answers alike.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { t } from '../../hooks/messages'
import { updatedFields } from '../../hooks/sessions'
import { runHook } from '../src/hook'
import type { HookInput } from '../src/hook'
import { ct } from '../src/messages'
import { contextOfTail, coreThresholds, transcriptContext } from '../src/quota'
import { resolveProject } from '../src/project'
import { loadActor, loadProject, paths } from '../src/store'
import { boardTool, ledgerTool, pmTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, NOW, hostWith, world } from './helpers'

const SESSION = '7c2d9e41-5b3a-4f60-9d1e-0a8b6c4e2f17'
const ID = `claude-code:${SESSION}`

/** A transcript line as Claude Code writes it: an assistant message with its usage. */
const line = (usage: object | null, extra: object = {}) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', ...(usage ? { usage } : {}) }, ...extra })
const usage = (input: number, read: number, write: number) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: 50 })

describe('the transcript tail (T-48)', () => {
  test('the last main-loop line with usage counts; a subagent line, a partial last line and a line with no usage do not', () => {
    const tail = [
      `ge":"cut at the tail's start"}`,
      line(usage(10, 150_000, 2_000)),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'go on' } }),
      line(usage(5, 900_000, 0), { isSidechain: true }),
      line(null),
      line(usage(1, 1, 1)).slice(0, 40),
    ].join('\n')
    assert.equal(contextOfTail(tail), 152_010)
    assert.equal(contextOfTail(''), null)
    assert.equal(contextOfTail(line(usage(5, 900_000, 0), { isSidechain: true })), null)
  })
})

for (const lang of LANGS) {
  describe(`quota (${lang})`, () => {
    let w: World
    beforeEach(() => {
      w = world(lang)
    })
    afterEach(() => w.done())

    const hook = (name: string, extra: Partial<HookInput>, at = NOW) => runHook('claude-code', name, { session_id: SESSION, cwd: w.repo, hook_event_name: name, ...extra }, w.env, at, hostWith())
    const transcript = (rows: string[]) => {
      const file = join(w.root, 'transcript.jsonl')
      writeFileSync(file, `${rows.join('\n')}\n`)

      return file
    }

    test('Stop records the context from the transcript tail, and a large file is read from its end', async () => {
      const filler = line(usage(1, 1, 1))
      const file = transcript([...Array.from({ length: 4_000 }, () => filler), line(usage(20, 210_000, 3_000))])
      assert.equal(await transcriptContext(file), 213_020)
      assert.equal(await transcriptContext(join(w.root, 'missing.jsonl')), null)
      await hook('UserPromptSubmit', { prompt: 'Add the Acme coupon field' })
      await hook('Stop', { last_assistant_message: 'Coupon field is in.', transcript_path: file }, NOW + 5_000)
      assert.deepEqual((await loadActor(ID, w.env))!.context, { tokens: 213_020, at: NOW + 5_000 })
    })

    test('a session past the hand-over threshold with work left is asked to hand over; one under it is not', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field', owner: ID })
      const ask = t('context.handoffAsk', { tokens: '', threshold: '', template: '' }).slice(0, 5)
      const said = async (tokens: number) => {
        await hook('Stop', { last_assistant_message: 'Working on it.', transcript_path: transcript([line(usage(0, tokens, 0))]) })
        const out = (await hook('UserPromptSubmit', { prompt: 'Go on' })) as { hookSpecificOutput: { additionalContext: string } }

        return out.hookSpecificOutput.additionalContext
      }
      assert.ok(!(await said(199_999)).includes(ask))
      const over = await said(200_000)
      assert.ok(over.includes(ask), over)
      assert.ok(over.includes(lang === 'en' ? '200k' : '20.0 萬'), over)
      // The thresholds come from ~/.project-pm/config.json when it names them.
      mkdirSync(w.env.PROJECT_PM_HOME!, { recursive: true })
      writeFileSync(join(w.env.PROJECT_PM_HOME!, 'config.json'), JSON.stringify({ context: { handoff: 250_000, compact: 400_000 } }))
      assert.deepEqual(await coreThresholds(w.env), { handoff: 250_000, compact: 400_000 })
      assert.ok(!(await said(200_000)).includes(ask))
    })

    test('the web board shows the context line on the card', async () => {
      await pmTool(w.ctx(), { action: 'claim' })
      await hook('UserPromptSubmit', { prompt: 'Coupon field' })
      await hook('Stop', { last_assistant_message: 'Shall I ship it?', transcript_path: transcript([line(usage(0, 100_000, 0))]) })
      w.advance(2 * 3_600_000)
      const board = await boardTool(w.ctx(), {})
      const card = (board.structured.actors as { id: string; context: string | null }[]).find(a => a.id === ID)!
      assert.equal(card.context, lang === 'en' ? 'context 100k · idle 2h · wake ≈130k' : '上下文 10.0 萬・閒置 2 小時・喚醒約 13.0 萬')
      assert.ok(board.text.includes(card.context!), board.text)
    })

    test('pm claim with handover_from takes over only in the session the old PM started', async () => {
      await pmTool(w.ctx('local_oldpm'), { action: 'claim' })
      const ref = (await resolveProject(w.repo))!
      // The old PM's own track (the mod's file) names the session it started.
      mkdirSync(join(w.home, '.claude', 'project-pm', 'sessions'), { recursive: true })
      writeFileSync(paths(w.env).legacySession('local_oldpm'), JSON.stringify({ id: 'local_oldpm', selfHandoff: { at: NOW, tokens: 310_000, to: 'local_newpm' } }))
      const stranger = await pmTool(w.ctx('local_other'), { action: 'claim', handover_from: 'local_oldpm' })
      assert.equal(stranger.structured.error, 'handover_refused')
      assert.equal(stranger.text, ct('pm.handoverNotStarted', { from: 'local_oldpm', actor: 'local_other' }))
      assert.equal((await loadProject(ref, w.env)).pmId, 'local_oldpm')
      const wrongPm = await pmTool(w.ctx('local_newpm'), { action: 'claim', handover_from: 'local_nobody' })
      assert.equal(wrongPm.structured.error, 'handover_refused')
      const taken = await pmTool(w.ctx('local_newpm'), { action: 'claim', handover_from: 'local_oldpm' })
      assert.equal(taken.structured.pmId, 'local_newpm')
      assert.equal((await loadProject(ref, w.env)).pmId, 'local_newpm')
    })

    test('a ledger update answers in one line, in the mod\'s own words', async () => {
      await ledgerTool(w.ctx(), { action: 'add', text: 'Coupon field' })
      const input = { action: 'update', id: 1, owner: 'local_acme', note: 'started' }
      const out = await ledgerTool(w.ctx(), input)
      assert.equal(out.text, t('ledger.updated', { code: 'T-01', fields: updatedFields(input) }))
      assert.equal(out.text, lang === 'en' ? 'Updated work item T-01 (owner, note).' : '已更新工作項目 T-01（owner、note）。')
      assert.ok(!out.text.includes('\n'))
      assert.deepEqual(Object.keys(out.structured).sort(), ['id', 'rev', 'revision'])
    })
  })
}
