import fs from 'node:fs/promises'
import path from 'node:path'
import { rcompare, valid } from 'semver'
import which from 'which'
import type { CodingToolId } from '../../shared/tools'
import { envVariable, type Env } from '../env/env'
import { commandTarget } from '../tools/command-program'
import { pathFolders } from '../tools/find-command'
import { canonicalPath } from './agent-paths'

/** The rules by which paths are written on `platform`. */
function pathRules(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/**
 * The folders an agent's official installer puts its command in, which the
 * login shell PATH may not have: Claude Code's installer only says how to
 * add `~/.local/bin` to it, and a shell such as fish does not read the
 * profile the others add theirs to. Claude Code's is `~/.local/bin`; Codex's
 * the folder `CODEX_INSTALL_DIR` names, else `~/.local/bin`, on Windows
 * `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`; OpenCode's `~/.opencode/bin`.
 */
export function installerFolders(
  tool: CodingToolId,
  home: string,
  env: Env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const paths = pathRules(platform)
  switch (tool) {
    case 'claude':
      return [paths.join(home, '.local', 'bin')]
    case 'codex': {
      const configured = envVariable(env, 'CODEX_INSTALL_DIR', platform)
      if (configured && paths.isAbsolute(configured)) return [configured]
      if (platform !== 'win32') return [paths.join(home, '.local', 'bin')]
      const local = envVariable(env, 'LOCALAPPDATA', platform)
      return local && paths.isAbsolute(local)
        ? [paths.join(local, 'Programs', 'OpenAI', 'Codex', 'bin')]
        : []
    }
    case 'opencode':
      return [paths.join(home, '.opencode', 'bin')]
  }
}

/** The folders of the computer's own that copies of an agent may be in: Homebrew's, outside Windows. */
export function systemFolders(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin']
}

/**
 * Further folders copies of an agent may be in: the computer's own (see
 * `systemFolders`), and outside Windows the global folder of every Node.js
 * that nvm installed, newest first.
 */
async function otherFolders(
  home: string,
  env: Env,
  platform: NodeJS.Platform,
  folders: string[],
): Promise<string[]> {
  if (platform === 'win32') return folders
  const configured = envVariable(env, 'NVM_DIR', platform)
  const nvm = configured && path.isAbsolute(configured) ? configured : path.join(home, '.nvm')
  const nodes = path.join(nvm, 'versions', 'node')
  const names = await fs.readdir(nodes).catch(() => [] as string[])
  const versions = names.filter((name) => valid(name) !== null).toSorted((a, b) => rcompare(a, b))
  return [...folders, ...versions.map((name) => path.join(nodes, name, 'bin'))]
}

/** A command named `command` in a folder, as a shell would find it there; `null` when none is. */
function commandIn(folder: string, command: string): Promise<string | null> {
  // Given a path, `which` only checks that file: on Windows, with the
  // extensions in PATHEXT.
  return which(path.join(folder, command), { nothrow: true })
}

/**
 * The command of an agent that its sessions run: the first of its name on
 * the login shell PATH, as a terminal would find it, else the first in the
 * folders its official installer puts it in (see `installerFolders`).
 */
export async function findAgentCommand(
  tool: CodingToolId,
  command: string,
  env: Env,
  home: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  for (const folder of [
    ...pathFolders(env, platform),
    ...installerFolders(tool, home, env, platform),
  ]) {
    const found = await commandIn(folder, command)
    if (found) return found
  }
  return null
}

/**
 * Every copy of an agent's command, in the order its sessions would pick
 * them were the ones before gone (see `findAgentCommand`), the one in use
 * first: those on the login shell PATH, then those in its official
 * installer's folders, the computer's own `folders`, such as Homebrew's,
 * and those of the Node.js versions nvm installed. Commands that lead to the
 * same file, as two folders on PATH may, count once.
 */
export async function findAgentCopies(
  tool: CodingToolId,
  command: string,
  env: Env,
  home: string,
  platform: NodeJS.Platform,
  folders: string[],
): Promise<string[]> {
  const searched = [
    ...pathFolders(env, platform),
    ...installerFolders(tool, home, env, platform),
    ...(await otherFolders(home, env, platform, folders)),
  ]
  const found = await Promise.all(searched.map((folder) => commandIn(folder, command)))
  const seen = new Set<string>()
  const copies: string[] = []
  for (const file of found) {
    if (file === null) continue
    const target = await canonicalPath(await commandTarget(file, platform))
    const key = platform === 'win32' ? target.toLowerCase() : target
    if (seen.has(key)) continue
    seen.add(key)
    copies.push(file)
  }
  return copies
}
