/**
 * A file's path as git names it inside its repository (project.ts gitPath), read by each system's own rules: on Linux
 * and macOS a backslash is part of a name, not a separator (T-39 QA6).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { gitPath } from '../src/project'

describe('a file\'s path as git names it (T-39 QA6)', () => {
  test('on Linux and macOS a backslash stays in the name: docs\\rules.md is not docs/rules.md', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      assert.equal(gitPath('/home/acme/shop', '/home/acme/shop/docs\\rules.md', platform), 'docs\\rules.md', platform)
      assert.equal(gitPath('/home/acme/shop', '/home/acme/shop/back\\slash.md', platform), 'back\\slash.md', platform)
      assert.notEqual(gitPath('/home/acme/shop', '/home/acme/shop/docs\\rules.md', platform), gitPath('/home/acme/shop', '/home/acme/shop/docs/rules.md', platform), platform)
      assert.equal(gitPath('/home/acme/shop', '/home/acme/shop/docs/rules.md', platform), 'docs/rules.md', platform)
    }
  })

  test('on Windows a backslash is a separator, written as git writes it', () => {
    assert.equal(gitPath('C:\\Users\\acme\\shop', 'C:\\Users\\acme\\shop\\docs\\rules.md', 'win32'), 'docs/rules.md')
    assert.equal(gitPath('C:\\Users\\acme\\shop', 'C:/Users/acme/shop/docs/rules.md', 'win32'), 'docs/rules.md')
    assert.equal(gitPath('C:\\Users\\acme\\shop', 'C:\\Users\\acme\\shop\\GUIDELINES.md', 'win32'), 'GUIDELINES.md')
  })
})
