/** Remote calls between the main process and the pty host utility process. */

export interface PtySpawnRequest {
  id: string
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  /**
   * Whether the pty host reports the program in the foreground of the
   * session's terminal (see `PtyHostEvents.program`): for a Terminal session,
   * which is named after it.
   */
  reportProgram: boolean
}

/** Provided by the pty host. */
export interface PtyHostFunctions {
  /** Starts a process in a new pseudo terminal and returns its pid. */
  spawn(request: PtySpawnRequest): number
  write(id: string, data: string, binary: boolean): void
  resize(id: string, cols: number, rows: number): void
  /**
   * Sends a signal to the session's process group. On Windows, which has no
   * signals, it ends the session's process, those started under it, and those
   * attached to its console instead.
   */
  kill(id: string, signal: string): void
}

/** Provided by the main process; the pty host reports through these. */
export interface PtyHostEvents {
  data(id: string, data: string): void
  exit(id: string, exitCode: number, signal: number): void
  /**
   * The program in the foreground of the terminal of a session started with
   * `reportProgram`, once the session has started and whenever another takes
   * its place: as node-pty names it outside Windows, sometimes as a path; on
   * Windows, which tells no foreground program, the file the session started.
   */
  program(id: string, name: string): void
}
