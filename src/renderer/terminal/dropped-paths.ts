import { quote } from 'shell-quote'
import type { DroppedPathQuoting } from '../../shared/dropped-path-quoting'

/**
 * The text a session's terminal pastes for the files and folders dropped on
 * it, as terminal applications paste them: each path quoted as `quoting`
 * says, so that a shell, or an agent that reads paths as a shell does, takes
 * it as one path, with the paths separated by spaces and followed by one, so
 * that the next drop or word does not run into the last path. On Windows a
 * path with a space goes in double quotes, as Windows Terminal puts it.
 * Control characters, such as a line break, which would end the line early,
 * are left out, as VS Code leaves them out. Empty without any paths; empty
 * paths, of files that are not on disk, are left out.
 */
export function droppedPathsText(paths: readonly string[], quoting: DroppedPathQuoting): string {
  const words = paths
    .map((path) => path.replace(/\p{Cc}/gu, ''))
    .filter((path) => path !== '')
    .map((path) => (quoting === 'windows' ? windowsWord(path) : quote([path])))
  return words.length === 0 ? '' : `${words.join(' ')} `
}

/** A Windows path as Windows Terminal pastes it: in double quotes if it has a space. */
function windowsWord(path: string): string {
  return path.includes(' ') ? `"${path}"` : path
}
