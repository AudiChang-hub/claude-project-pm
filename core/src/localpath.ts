/**
 * Paths the model or a repository hands the core, looked up on disk only when they are plain paths on this machine's
 * own disks (T-39: a list of what is allowed, after six rounds of QA each found a spelling the list of what is
 * refused had missed).
 *
 * On Windows, looking up a UNC path (\\host\share\x, //host/share/x, \\?\UNC\host\share\x, \\.\C:\..\UNC\host…) or a
 * link that leads to one makes the system connect to that host over SMB and offer the person's NTLM hash, before
 * anyone has allowed anything. Claude Code refuses such paths before its tools touch them; a hook runs ahead of that
 * check, and an MCP tool's arguments never pass it, so the core decides from the text alone, and asks the file system
 * nothing about a path until plainLocalPath has said yes.
 */
import { lstat, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, join, posix, win32 } from 'node:path'

/** A path that is not a plain local path, or a link on the way that leads to one: nothing about it was looked up. */
export class NotPlainPathError extends Error {
  constructor(readonly path: string) {
    super(`not a plain path on this computer's own disks: ${path}`)
  }
}

/** The most links followed on the way to one file, as the system's own limit (Windows stops at 63). */
const MAX_LINKS = 40

/** Windows' device names: a file of that name (with any extension, any trailing spaces) is the device. */
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)$/i

/**
 * The full path `raw` names, resolved against `cwd`, when it is a plain path on this machine's own disks; else null.
 * The one test every path from the model or a repository passes before anything is looked up. Nothing outside the
 * list below is let through, however it is spelled.
 *
 * Windows: the text may not start with a slash either way (\\host, //host, \/host, \\?\, \\.\, \??\, and \x, the root
 * of whatever drive that process is on), may hold no control character and none of < > " | ? *, and a colon only as
 * a drive's, at the start. A drive-relative path (C:foo, C:) is refused: it means the folder that process last used on
 * that drive, which the hook does not know and the tool may see differently, so neither a guess nor cwd is safe
 * (the system check in localpath-variants.spec found \x read against another drive than the session's). Resolved by path.win32.resolve, the result
 * must be X:\…, and no part of it may end in a dot or a space (Windows trims those, so the name opened is another),
 * or be a device name (CON, NUL, COM1, LPT1, CONIN$, … with or without an extension).
 * A drive letter is taken as this machine's own: one the person mapped to a share (Z: -> \\host\share) or made with
 * subst is their setup, already connected; it is not one the model or a repository can make.
 *
 * Elsewhere: any path, absolute or relative, except one starting with // (POSIX lets a system read //host as another
 * machine) or holding a NUL.
 */
export function plainLocalPath(raw: string, cwd: string, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (platform !== 'win32') {
    if (raw.startsWith('//') || raw.includes('\0') || cwd.startsWith('//')) return null

    return posix.resolve(cwd, raw)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>"|?*]/.test(raw)) return null
  const text = raw.replace(/\//g, '\\')
  // Two slashes start a share or a device; one starts the root of the drive that process is on, which, as for C:x,
  // the hook does not know (Windows itself reads \x against its own current drive, not the session's folder).
  if (text.startsWith('\\')) return null
  if (text.lastIndexOf(':') > 1 || (text.includes(':') && !/^[a-z]:\\/i.test(text))) return null
  const full = win32.resolve(cwd, raw)
  if (!/^[a-z]:\\/i.test(full) || full.includes('\\\\') || full.lastIndexOf(':') !== 1) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>"|?*]/.test(full)) return null
  for (const part of full.slice(3).split('\\')) {
    if (!part) continue
    if (/[. ]$/.test(part)) return null
    if (DEVICE_NAMES.test(part.split('.')[0]!.trimEnd())) return null
  }

  return full
}

/**
 * Where `path` really is on disk (links followed, Windows' 8.3 names and letter case as the disk keeps them), or null
 * when nothing of it is on disk to ask. A part not there yet keeps its name after where the part before it really is.
 * Throws NotPlainPathError, having asked nothing about it, for a path plainLocalPath refuses, or a link on the way
 * whose target it refuses: on Windows each link is read (not followed) and its target checked before going on. Throws
 * too for a link that cannot be read, or too many links in a row: what cannot be checked is not taken.
 */
export async function localRealpath(path: string, cwd: string = process.cwd()): Promise<string | null> {
  const plain = plainLocalPath(path, cwd)
  if (plain === null) throw new NotPlainPathError(path)
  if (process.platform !== 'win32') return (await realOf(plain, [])) ?? realOf(dirname(plain), [basename(plain)])
  let names = plain.slice(3).split('\\').filter(Boolean)
  let at = plain.slice(0, 3)
  let links = 0
  while (names.length) {
    const name = names.shift()!
    const next = join(at, name)
    const stats = await lstat(next).catch(() => null)
    // Nothing there: nothing below it is there either, so nothing further can be a link.
    if (!stats) return realOf(at, [name, ...names])
    if (!stats.isSymbolicLink()) {
      at = next
      continue
    }
    if (++links > MAX_LINKS) throw new Error(`too many links on the way to ${path}`)
    // A link whose target cannot be read cannot be checked: an error, never left for the system to follow.
    const target = await readlink(next)
    const to = plainLocalPath(target, dirname(next))
    if (to === null) throw new NotPlainPathError(target)
    at = to.slice(0, 3)
    names = [...to.slice(3).split('\\').filter(Boolean), ...names]
  }

  return realOf(at, [])
}

/** The real path of `at` (no links left in it on Windows), with `rest` (not on disk) after it. */
async function realOf(at: string, rest: string[]): Promise<string | null> {
  const real = await realpath(at).catch(() => null)

  return real === null ? null : rest.length ? join(real, ...rest) : real
}
