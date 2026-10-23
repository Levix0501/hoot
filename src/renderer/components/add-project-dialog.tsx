import { useAppStore } from '../store/app-store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'

/** "1 file", "2 files". */
function files(count: number): string {
  return count === 1 ? '1 file' : `${count} files`
}

/**
 * Asks before Hoot runs `git init` in a folder, or makes the first commit of
 * a repository without one: it says how many files the commit would hold, and
 * while the folder has no `.gitignore`, that files such as `.env` and
 * `node_modules` would be committed too.
 */
export function AddProjectDialog() {
  const confirmation = useAppStore((state) => state.addProjectConfirmation)
  const answer = useAppStore((state) => state.answerAddProject)

  return (
    <AlertDialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) void answer(false)
      }}
    >
      <AlertDialogContent data-testid="add-project-dialog" data-folder={confirmation?.folder}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmation?.mode === 'init'
              ? 'Initialize this folder as a Git repository?'
              : 'Commit this repository’s files?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation?.mode === 'init' ? (
              <>
                Hoot will run <code className="font-mono text-foreground">git init</code> in{' '}
                <span className="font-mono text-foreground [overflow-wrap:anywhere]" data-path="">
                  {confirmation.folder}
                </span>{' '}
                and commit its {files(confirmation.fileCount)} as the first commit.
              </>
            ) : (
              <>
                The Git repository of{' '}
                <span className="font-mono text-foreground [overflow-wrap:anywhere]" data-path="">
                  {confirmation?.folder}
                </span>{' '}
                has no commits yet. Hoot will commit its {files(confirmation?.fileCount ?? 0)} as
                the first commit.
              </>
            )}
            {confirmation !== null && !confirmation.hasGitignore && (
              <>
                {' '}
                There is no <code className="font-mono text-foreground">.gitignore</code> here, so
                files such as <code className="font-mono text-foreground">.env</code> and{' '}
                <code className="font-mono text-foreground">node_modules</code> will be committed
                too.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void answer(false)} data-testid="add-project-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => void answer(true)} data-testid="add-project-confirm">
            {confirmation?.mode === 'init'
              ? 'Initialize and Add Project'
              : 'Commit and Add Project'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
