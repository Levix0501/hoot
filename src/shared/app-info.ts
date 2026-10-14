/** What the About page tells of Hoot and of what it runs on. */
export interface AppInfo {
  /** Hoot's version, such as `0.1.0-alpha.2`. */
  version: string
  /** The operating system's name: macOS or Windows. */
  system: string
  /** The operating system's version, such as `26.3.1` or `10.0.26100`. */
  systemVersion: string
  /** The CPU architecture Hoot runs on: `arm64` or `x64`. */
  arch: string
  /** The versions of Electron, and of the Chromium and Node.js inside it, that Hoot runs on. */
  electron: string
  chromium: string
  node: string
}

/** The name of the operating system a Node.js `process.platform` stands for. */
export function systemName(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

/** One line of the environment, such as `Electron` and `44.7.0`. */
export interface EnvironmentEntry {
  name: string
  value: string
}

/** The operating system with its architecture in brackets, then Electron, Chromium and Node.js. */
export function environmentEntries(info: AppInfo): EnvironmentEntry[] {
  return [
    { name: info.system, value: `${info.systemVersion} (${info.arch})` },
    { name: 'Electron', value: info.electron },
    { name: 'Chromium', value: info.chromium },
    { name: 'Node.js', value: info.node },
  ]
}

/**
 * What Copy puts on the clipboard, for a bug report: Hoot's version, then
 * the environment, a line each.
 */
export function environmentText(info: AppInfo): string {
  return [
    `Hoot ${info.version}`,
    ...environmentEntries(info).map(({ name, value }) => `${name} ${value}`),
  ].join('\n')
}
