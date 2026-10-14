declare module 'read-cmd-shim' {
  /**
   * The file that a shim of npm or pnpm points to, as the shim names it:
   * relative to the shim's folder. Fails with the code `ENOTASHIM` when the
   * file is no such shim. The kind of shim is read from the extension: `.cmd`
   * (in lowercase), `.ps1`, or else a shell script.
   */
  function readCmdShim(path: string): Promise<string>
  export = readCmdShim
}
