import { utilityProcess } from 'electron'

export const DELETER_SERVICE_NAME = 'Hoot deleter'

/**
 * Deletes what is in a folder but its `.git` file, as `deleteContents` does,
 * in a utility process of its own (`src/deleter`), so that deleting a large
 * folder, which takes every file system thread of the process it runs in,
 * slows nothing in the main process. Resolves with why it could not delete
 * everything, or `null`.
 */
export function deleteContentsApart(modulePath: string, folder: string): Promise<string | null> {
  return new Promise((resolve) => {
    let problem: string | null | undefined
    const child = utilityProcess.fork(modulePath, [], { serviceName: DELETER_SERVICE_NAME })
    child.once('spawn', () => child.postMessage(folder))
    child.once('message', (message: string | null) => {
      problem = message
      child.kill()
    })
    child.once('exit', (code) => {
      resolve(
        problem !== undefined
          ? problem
          : `The process deleting the files exited with code ${code}.`,
      )
    })
  })
}
