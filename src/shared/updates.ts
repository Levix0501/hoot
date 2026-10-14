/**
 * Where Hoot is with a newer version of itself, which only a Hoot installed
 * from a release looks for, among the releases published on GitHub:
 *
 * - `none`: no newer version is known, or Hoot does not look for one.
 * - `available`: a newer version is out.
 * - `downloading`: it is downloading; `percent` says how much has arrived,
 *   from 0 to 100.
 * - `downloaded`: it waits for Hoot to restart into it.
 * - `restarting`: Hoot is quitting to install it, and opens again with it.
 */
export type UpdateState =
  | { kind: 'none' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'restarting'; version: string }
