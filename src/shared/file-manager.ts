/**
 * The app that shows the files and folders on `platform` (a `process.platform`
 * value), by the name buttons and menus give it, as in Show in Finder: File
 * Explorer on Windows, Finder on macOS.
 */
export function fileManagerName(platform: string): string {
  return platform === 'win32' ? 'File Explorer' : 'Finder'
}
