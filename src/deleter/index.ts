/**
 * Deleter: runs inside a utility process of its own, which deletes what is in
 * the folder the main process sends it but its `.git` file, and answers with
 * why it could not delete everything, or `null` (see
 * `main/worktrees/deleter-process`). The main process ends it then.
 */
import { deleteContents } from '../main/worktrees/delete-contents'

process.parentPort.once('message', (event) => {
  void deleteContents(event.data as string).then((problem) =>
    process.parentPort.postMessage(problem),
  )
})
