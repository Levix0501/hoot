/**
 * A path as Hoot shows it: with the home directory written as `~` when the
 * path is in it, such as `~/code/hoot`, and in full otherwise.
 */
export function displayPath(file: string, home: string): string {
  if (file === home) return '~'
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file
}
