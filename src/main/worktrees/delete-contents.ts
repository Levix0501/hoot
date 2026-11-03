import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * The errors deleting an entry is tried again on, those `fs.rm` tries again
 * on with `maxRetries`, as a file in use on Windows gives for a moment.
 */
const RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])
/** How many times deleting an entry is tried again, waiting 100 ms longer each time: 5.5 s in all. */
const RETRIES = 10
const RETRY_DELAY = 100

/**
 * Deletes what is in a worktree member's folder but its `.git` file, which
 * keeps the folder a worktree that Git can still check and delete should this
 * stop partway, and which `git worktree remove` deletes last, with the folder
 * and the registration. Unlike Git for Windows by default, Node.js takes
 * paths longer than 260 characters, as in a `node_modules`, and it deletes a
 * junction, as pnpm makes on Windows, or a symbolic link without following
 * it, where Git for Windows keeps a junction and the folders around it.
 * Returns why it could not delete everything, or `null`, within seconds of
 * meeting a file that stays undeletable.
 */
export async function deleteContents(folder: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.promises.readdir(folder)
  } catch (error) {
    // Gone already, as the folder of an inner member can be.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return errorMessage(error)
  }
  for (const name of names) {
    if (name === '.git') continue
    const problem = await deleteEntry(path.join(folder, name))
    if (problem !== null) return problem
  }
  return null
}

/**
 * Deletes a file or folder, trying again a few times when that fails as a
 * file in use on Windows can for a moment, and returns why it could not, or
 * `null`. The whole entry is tried again, not with `fs.rm`'s `maxRetries`:
 * those tries are made again in every folder, each time with all the tries
 * in the folders inside it, so that one file that stays undeletable deep in
 * a `node_modules` kept the deletion going practically forever.
 */
async function deleteEntry(entry: string): Promise<string | null> {
  for (let retry = 1; ; retry++) {
    try {
      await fs.promises.rm(entry, { recursive: true, force: true })
      return null
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (retry > RETRIES || code === undefined || !RETRY_CODES.has(code)) {
        return errorMessage(error)
      }
      await delay(retry * RETRY_DELAY)
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
