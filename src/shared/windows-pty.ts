/**
 * What a session's terminal is told of the pseudo terminal the session runs
 * in on Windows, for xterm.js's `windowsPty` option: ConPTY, and the build
 * number of Windows, by which xterm.js adjusts how it handles resizes. VS
 * Code tells it the same with the same ConPTY, the one that comes with
 * node-pty.
 */
export interface WindowsPty {
  backend: 'conpty'
  buildNumber: number
}

/**
 * The pseudo terminal of sessions on `platform` (a `process.platform` value)
 * whose version is `systemVersion`, such as `10.0.26200`: ConPTY on Windows,
 * none elsewhere.
 */
export function windowsPtyFor(platform: string, systemVersion: string): WindowsPty | undefined {
  if (platform !== 'win32') return undefined
  const buildNumber = Number(/^\d+\.\d+\.(\d+)/.exec(systemVersion)?.[1] ?? 0)
  return { backend: 'conpty', buildNumber }
}
