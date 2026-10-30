import fs from 'node:fs'
import path from 'node:path'

/**
 * Deletes what is in a worktree member's folder but its `.git` file, which
 * keeps the folder a worktree that Git can still check and delete should this
 * stop partway, and which `git worktree remove` deletes last, with the folder
 * and the registration. Unlike Git for Windows by default, Node.js takes
 * paths longer than 260 characters, as in a `node_modules`, and it deletes a
 * junction, as pnpm makes on Windows, or a symbolic link without following
 * it, where Git for Windows keeps a junction and the folders around it.
 * Returns why it could not delete everything, or `null`.
 */
export async function deleteContents(folder: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.promises.readdir(folder)
  } catch (error) {
    // Gone already, as the folder of an inner member can be.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return error instanceof Error ? error.message : String(error)
  }
  for (const name of names) {
    if (name === '.git') continue
    try {
      // On Windows a file in use can take a moment to be let go of.
      await fs.promises.rm(path.join(folder, name), {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      })
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  return null
}
