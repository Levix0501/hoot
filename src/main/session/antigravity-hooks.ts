import path from 'node:path'

export interface AntigravityHooksFolderOptions {
  /** Whether this Hoot runs packaged, rather than from its repository. */
  packaged: boolean
  /** The packaged app's folder of resources. */
  resourcesPath: string
  /** The folder of the app: the repository, for a Hoot run from it. */
  appPath: string
  platform?: NodeJS.Platform
}

/**
 * The folder of the hooks Hoot gives Antigravity CLI, which takes no hooks
 * from its command line, only from a folder of its workspace, from its own
 * configuration and from plugins: in the packaged app's resources, out of
 * its archive, or in the repository, for a Hoot run from it. It holds
 * nothing but `.agents/hooks.json`, as its sessions show it among their
 * folders. Its hooks run hoot's `hook` command, as the command `hoot` the
 * session's PATH finds first, with the hook's input, when a conversation
 * starts and when a turn ends, so that the session's hoot reports the
 * conversation the user's last message went to (see `hookEventOf`). They
 * print nothing, which decides nothing; Antigravity CLI waits for them, as
 * it waits for every hook. The user's own hooks run as well.
 */
export function antigravityHooksFolder(options: AntigravityHooksFolderOptions): string {
  const paths = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix
  return options.packaged
    ? paths.join(options.resourcesPath, 'antigravity-hooks')
    : paths.join(options.appPath, 'resources', 'antigravity-hooks')
}
