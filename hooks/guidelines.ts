import type { EngineInterface } from 'claude-code'

/**
 * The person's development guidelines: a Markdown file named by the `guidelines` option, which the PM and every
 * other session of a project with a PM are given in their system prompt. The file is read on each turn, so an edit
 * reaches the next turn of every session with no reload; its text never leaves the machine.
 */

/** The longest text one turn is given: the rest is cut, with a note saying where to read on. */
export const MAX_CHARS = 24_000

export type Guidelines = { file: string; text: string; isClipped: boolean } | { file: string; error: string }

/**
 * Where a configured path points: `~` is the home folder, and a relative path is the project's own file
 * (`docs/GUIDELINES.md`), so one setting can name a file each project keeps.
 */
export function guidelinesPath(path: string, home: string | null, projectPath: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '')
  if (/^~(?=$|[\\/])/.test(trimmed) && home) return `${home}${trimmed.slice(1)}`
  if (/^([a-z]:[\\/]|[\\/])/i.test(trimmed)) return trimmed

  return `${projectPath.replace(/[\\/]+$/, '')}/${trimmed}`
}

/** Whether two paths name one file on this machine: slashes either way, case ignored (Windows). */
export function isSameFile(a: string, b: string): boolean {
  const norm = (path: string) => path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()

  return norm(a) === norm(b)
}

/** The tools that write a file, and the input field naming it. */
export const WRITING_TOOLS: Readonly<Record<string, string>> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }

/**
 * Whether the person's own message asks about the guidelines, the one case the guidelines file may be edited in:
 * the guidelines say they change only when the person asks for it.
 */
export function asksForGuidelines(prompt: string): boolean {
  return /準則|守則|guidelines?/i.test(prompt)
}

/** The guidelines the option names, read now; null when none is set. */
export async function readGuidelines($: EngineInterface, path: string, projectPath: string): Promise<Guidelines | null> {
  if (!path.trim()) return null
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? null
  const file = guidelinesPath(path, home, projectPath)
  try {
    const text = (await $.fs.read(file)).replace(/^﻿/, '').trim()
    if (!text) return { file, error: 'empty' }
    if (text.length <= MAX_CHARS) return { file, text, isClipped: false }

    return { file, text: text.slice(0, MAX_CHARS), isClipped: true }
  } catch (err) {
    return { file, error: err instanceof Error ? err.message : String(err) }
  }
}
