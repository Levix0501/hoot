import { systemName, type AppInfo } from '../shared/app-info'

/** What Hoot takes its information from: Electron's `app` and Node.js's `process`. */
export interface AppInfoSource {
  version: string
  platform: string
  systemVersion: string
  arch: string
  versions: { electron: string; chrome: string; node: string }
}

/** What the About page tells of Hoot and of what it runs on. */
export function readAppInfo(source: AppInfoSource): AppInfo {
  return {
    version: source.version,
    system: systemName(source.platform),
    systemVersion: source.systemVersion,
    arch: source.arch,
    electron: source.versions.electron,
    chromium: source.versions.chrome,
    node: source.versions.node,
  }
}
