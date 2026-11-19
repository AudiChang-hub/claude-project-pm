/** Which project a folder belongs to: its git repository, a worktree counting as the repository it was made from. */
import { basename, dirname, resolve } from 'node:path'

import { keyFile, projectKey } from '../../hooks/sessions'
import type { Run } from './host'
import { run as hostRun } from './host'

export type ProjectRef = {
  /** The repository's main folder, in the platform's own spelling. */
  path: string
  name: string
  /** The same key the desktop mod uses (projectKey), so both find one file. */
  key: string
  /** The file name the key maps to (keyFile), the same in the core's folder and the mod's. */
  file: string
  /** The folder asked about (a worktree, a subfolder), as given. */
  cwd: string
}

/**
 * The project `cwd` is in, or null outside a git repository (a folder without git has no ledger). Any worktree maps
 * to the repository's main folder through the common git directory.
 */
export async function resolveProject(cwd: string, run: Run = hostRun): Promise<ProjectRef | null> {
  const common = await run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  if (!common) return null
  let path: string
  if (basename(common) === '.git') path = dirname(common)
  else {
    // A bare repository or an unusual layout: the top of the folder asked about stands for it.
    const top = await run(['git', 'rev-parse', '--show-toplevel'], cwd)
    path = top || common
  }
  path = resolve(path)

  return projectRefOf(path, cwd)
}

/** The project for a repository's main folder. */
export function projectRefOf(path: string, cwd = path): ProjectRef {
  const key = projectKey(path)

  return { path, name: basename(path) || path, key, file: keyFile(key), cwd }
}
