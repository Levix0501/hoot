/** Remote calls between the main process and the pty host utility process. */

export interface PtySpawnRequest {
  id: string
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

/** Provided by the pty host. */
export interface PtyHostFunctions {
  /** Starts a process in a new pseudo terminal and returns its pid. */
  spawn(request: PtySpawnRequest): number
  write(id: string, data: string, binary: boolean): void
  resize(id: string, cols: number, rows: number): void
  /**
   * Sends a signal to the session's process group. On Windows, which has no
   * signals, it ends the processes attached to the session's console instead.
   */
  kill(id: string, signal: string): void
}

/** Provided by the main process; the pty host reports through these. */
export interface PtyHostEvents {
  data(id: string, data: string): void
  exit(id: string, exitCode: number, signal: number): void
}
