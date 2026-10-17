/**
 * Whether Hoot manages agents on `platform` (a `process.platform` value):
 * showing the Agents page in the settings, and sending to it from the new
 * session menu. On macOS, where Hoot installs agents of its own with the npm
 * that comes with it, and on Windows, where it installs with the npm of the
 * computer's Node.js. A module of its own, so that the preload does not carry
 * the semver package in with `agents.ts`.
 */
export function managesAgents(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}
