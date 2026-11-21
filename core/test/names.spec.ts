/**
 * T-43: people read sessions by name, never by their raw id. The web board's words (the PM, the owners, what needs
 * attention, the session cards) name each session by its title, else the title it reported, else its instruction,
 * and only then by a short id; the text board the model reads keeps the id beside the name (the PM assigns owners by
 * it). Acme data only.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { setLang } from '../../hooks/messages'
import { sessionName, shortId } from '../../hooks/sessions'
import { resolveProject } from '../src/project'
import type { ProjectRef } from '../src/project'
import { changeActor } from '../src/store'
import { boardOf, ledgerTool, pmTool, reportTool } from '../src/tools'
import type { World } from './helpers'
import { LANGS, NOW, world } from './helpers'

const PM = 'claude-code:6f1d3b2a-8c4e-4f7a-9b21-0d5e7c3a1f48'
const DEV = 'claude-code:1c7e9a40-5b2d-4e8f-a316-27d0b9e4c5f1'
const QUIET = 'claude-code:8a2f6c13-d9e4-4b71-8f05-6e3a1c7b2d90'

describe('a session as people read it', () => {
  test('a short id: the tool and everything past 8 characters left out', () => {
    assert.equal(shortId(PM), '6f1d3b2a')
    assert.equal(shortId('local_47a75388-8494-4995-8ac9-c91ea5183b1b'), '47a75388')
    assert.equal(shortId('  agent:a1b2c3  '), 'a1b2c3')
    assert.equal(shortId('pm1'), 'pm1')
  })

  test('its title, else the title it reported, else its instruction, else its short id', () => {
    for (const lang of LANGS) {
      setLang(lang)
      assert.equal(sessionName({ id: DEV, title: 'Retire v1 coupon fields' }, { title: 'Coupon work', lastPrompt: 'Retire the v1 coupon fields' }), 'Retire v1 coupon fields')
      assert.equal(sessionName({ id: DEV, title: '' }, { title: 'Coupon work', lastPrompt: 'Retire the v1 coupon fields' }), 'Coupon work')
      // A title that is only its id, or the desktop app's "untitled", is no name.
      assert.equal(sessionName({ id: DEV, title: DEV }, { title: DEV, lastPrompt: 'Retire the v1   coupon fields\nnow' }), 'Retire the v1 coupon fields now')
      assert.equal(sessionName({ id: DEV, title: '（未命名）' }, undefined), '1c7e9a40')
      assert.equal(sessionName({ id: DEV, title: '(untitled)' }, { lastPrompt: '<task-notification>done</task-notification>' }), '1c7e9a40')
      assert.ok(sessionName({ id: DEV, title: '' }, { lastPrompt: 'x'.repeat(200) }).length <= 41)
    }
  })
})

for (const lang of LANGS) {
  describe(`the web board names sessions (${lang})`, () => {
    let w: World
    let ref: ProjectRef
    beforeEach(async () => {
      w = world(lang)
      ref = (await resolveProject(w.repo))!
      await pmTool(w.ctx(PM), { action: 'claim' })
      await changeActor(PM, old => ({ ...(old ?? { id: PM, tool: 'claude-code', cwd: w.repo, lastSeenAt: NOW }), title: 'Acme PM', projectKey: ref.key }), w.env)
      await ledgerTool(w.ctx(PM), { action: 'add', text: 'Coupon field', owner: DEV })
      await ledgerTool(w.ctx(PM), { action: 'add', text: 'Tax rounding', owner: QUIET })
      await ledgerTool(w.ctx(PM), { action: 'add', text: 'Order emails', owner: 'claude-code:ffffffff-0000-4000-8000-000000000000' })
      await ledgerTool(w.ctx(PM), { action: 'update', id: 2, qa: 'fail', qa_by: DEV, qa_note: 'rounds half down' })
      // One that reported a title, one known only by its first instruction (the hook's), neither with a desktop title.
      await reportTool(w.ctx(DEV), { status: 'waiting_user', summary: 'Drop coupon_v1 now or keep it read-only?', title: 'Retire v1 coupon fields' })
      await changeActor(QUIET, () => ({ id: QUIET, tool: 'claude-code', title: '', cwd: w.repo, projectKey: ref.key, lastSeenAt: NOW, lastPrompt: 'Fix tax rounding at checkout', report: { status: 'in_progress', summary: 'Rounding half up now' }, reportAt: NOW }), w.env)
    })
    afterEach(() => w.done())

    test('no full session id in anything the web board shows; the board for the model keeps them', async () => {
      const { text, json } = await boardOf(w.ctx(PM), ref, false)
      const shown = JSON.stringify({
        pm: json.project.pmName,
        attention: json.attention.map(a => a.text),
        owners: json.items.map(i => i.ownerName),
        actors: json.actors.map(a => [a.title, a.said]),
      })
      assert.ok(!/claude-code:[0-9a-f-]{20,}/.test(shown), shown)
      assert.equal(json.project.pmName, 'Acme PM')
      assert.deepEqual(json.actors.map(a => a.title).sort(), ['Fix tax rounding at checkout', 'Retire v1 coupon fields'])
      assert.ok(json.items[0]!.ownerName.startsWith('Retire v1 coupon fields'), json.items[0]!.ownerName)
      // An owner nobody knows of any more: its short id.
      assert.ok(json.items[2]!.ownerName.includes('ffffffff'), json.items[2]!.ownerName)
      // The model's board: the names, and each id beside it.
      assert.ok(text.includes(DEV), text)
      assert.ok(text.includes('Retire v1 coupon fields'), text)
    })
  })
}
