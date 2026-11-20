/**
 * Paths the model or a repository hands the core, looked up on disk only when they are on this machine's own disks.
 *
 * On Windows, looking up a UNC path (\\host\share\x, //host/share/x, \\?\UNC\host\share\x) or a link that leads to one
 * makes the system connect to that host over SMB and offer the person's NTLM hash, before anyone has allowed anything.
 * Claude Code refuses such paths before its tools touch them; a hook runs ahead of that check, and an MCP tool's
 * arguments never pass it, so the core decides from the text alone and never asks the file system about them.
 */
import { lstat, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve } from 'node:path'

/** A path that names another machine, or a device other than a drive, or a link on the way that leads to one. */
export class RemotePathError extends Error {
  constructor(readonly path: string) {
    super(`not a path on this machine: ${path}`)
  }
}

/** The most links followed on the way to one file, as the system's own limit (Windows stops at 63). */
const MAX_LINKS = 40

/**
 * Whether `path`, as written, names a place on this machine's own disks. On Windows that is a drive path, a
 * path from the current drive's root, a relative path, or a drive written as a device (\\?\C:\…, \\.\C:\…, \??\C:\…)
 * with no . or .. in it. Never a UNC path (\\host\share, //host/share, \\localhost\C$ too) or any other device or
 * namespace path (\\?\UNC\…, \\?\GLOBALROOT\…, \\?\Volume{…}\…, \\.\pipe\…). Elsewhere every path is: a POSIX
 * system reaches other machines only through folders the person mounted.
 *
 * Windows folds a device path's . and .. into its prefix, past the drive: \\.\C:\..\UNC\host\share opens
 * \\.\UNC\host\share, and with localhost that is this machine's own disk again. So after a device prefix any part
 * made only of dots (or dots and spaces, which Windows trims to dots) makes the path not local, whatever it climbs to.
 * A drive letter, here as everywhere, is taken as this machine's: one the person mapped to a share (Z: -> \\host\share)
 * or made with subst is theirs, already connected.
 */
export function isLocalPath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return true
  const text = path.trim().replace(/\//g, '\\')
  const device = /^(?:\\\\[?.]\\|\\\?\?\\)/.exec(text)
  if (device) {
    const rest = text.slice(device[0].length)

    return /^[a-z]:(?:\\|$)/i.test(rest) && !rest.split('\\').some(part => /^[. ]+$/.test(part))
  }

  return !text.startsWith('\\\\')
}

/**
 * A local drive written as a device (\\?\C:\x, \\.\C:\x, \??\C:\x), as the plain drive path (C:\x); others as given,
 * among them one with . or .. after the prefix (\\.\C:\..\UNC\host is not on drive C: at all; isLocalPath refuses it).
 */
export function plainDrivePath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || !isLocalPath(path, platform)) return path
  const device = /^(?:[\\/][\\/][?.][\\/]|\\\?\?\\)(?=[a-z]:(?:[\\/]|$))/i.exec(path)

  return device ? path.slice(device[0].length) : path
}

/**
 * Where `path` really is on disk (links followed, Windows' 8.3 names and letter case as the disk keeps them), or null
 * when nothing of it is on disk to ask. A part not there yet keeps its name after where the part before it really is.
 * Throws RemotePathError, having asked nothing about it, for a path that is not local or a link on the way that
 * leads off this machine: on Windows each link is read (not followed) and its target checked before going on. Throws
 * too for a link that cannot be read, or too many links in a row: what cannot be checked is not taken.
 */
export async function localRealpath(path: string): Promise<string | null> {
  if (!isLocalPath(path)) throw new RemotePathError(path)
  if (process.platform !== 'win32') {
    const where = resolve(path)

    return (await realOf(where, [])) ?? realOf(dirname(where), [basename(where)])
  }
  let { root, names } = split(resolve(plainDrivePath(path)))
  let at = root
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
    if (!isLocalPath(target)) throw new RemotePathError(target)
    const to = resolve(dirname(next), plainDrivePath(target))
    if (!isLocalPath(to)) throw new RemotePathError(to)
    const parts = split(to)
    root = parts.root
    at = root
    names = [...parts.names, ...names]
  }

  return realOf(at, [])
}

/** The real path of `at` (no links left in it on Windows), with `rest` (not on disk) after it. */
async function realOf(at: string, rest: string[]): Promise<string | null> {
  const real = await realpath(at).catch(() => null)

  return real === null ? null : rest.length ? join(real, ...rest) : real
}

function split(path: string): { root: string; names: string[] } {
  const { root } = parse(path)

  return { root, names: path.slice(root.length).split(/[\\/]+/).filter(Boolean) }
}
