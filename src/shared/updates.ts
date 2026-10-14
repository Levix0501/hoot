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

/**
 * How Hoot's latest look for a newer version went:
 *
 * - `unsupported`: this Hoot does not look for one, as it was built from
 *   source.
 * - `idle`: it has not looked yet.
 * - `checking`: it is looking.
 * - `finished`: the latest look ended, with or without a newer version found.
 * - `failed`: the latest look failed; `message` is the error in full, which
 *   can run over many lines.
 */
export type UpdateCheck =
  | { kind: 'unsupported' }
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'finished' }
  | { kind: 'failed'; message: string }

/** Everything the window shows of Hoot's updates. */
export interface UpdateStatus {
  state: UpdateState
  check: UpdateCheck
}

/** The first line of an error message: what comes before its first line break. */
export function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? ''
}
