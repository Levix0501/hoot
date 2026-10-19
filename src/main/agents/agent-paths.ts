import fs from 'node:fs/promises'
import path from 'node:path'
import { displayPath } from '../../shared/paths'

/**
 * A path as it is on disk, its symbolic links followed; for a path whose end
 * does not exist, the one of the nearest folder of it that does, with the rest
 * after it.
 */
export async function canonicalPath(file: string): Promise<string> {
  const resolved = path.resolve(file)
  try {
    return await fs.realpath(resolved)
  } catch {
    const parent = path.dirname(resolved)
    if (parent === resolved) return resolved
    return path.join(await canonicalPath(parent), path.basename(resolved))
  }
}

/**
 * A path as the Agents page shows it, with `~` for the home folder, whether
 * the path is written with the home folder as it is set or as it is on disk.
 */
export function homeDisplayPath(file: string, home: string, canonicalHome: string): string {
  return displayPath(displayPath(file, home), canonicalHome)
}

/**
 * Whether two paths name the same file: as written, and on Windows also when
 * they differ in case alone, which its file systems do not tell apart.
 */
export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** The rules by which paths are written on `platform`. */
function pathRules(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Whether a path is inside a folder, below it rather than the folder itself. */
export function isInside(
  file: string,
  directory: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = pathRules(platform)
  const relative = paths.relative(paths.resolve(directory), paths.resolve(file))
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative)
}
