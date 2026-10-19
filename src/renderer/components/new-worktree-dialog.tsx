import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultNestedBase,
  type NestedRepositoryOption,
  type NewWorktreeOptions,
  type NewWorktreeOptionsResult,
} from '../../shared/worktrees'
import { api } from '../lib/api'
import { errorMessage, focusAfterOverlay, useAppStore, warnAboutWorktree } from '../store/app-store'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Spinner } from './ui/spinner'

/** What the user chose for an inner repository. */
interface NestedChoice {
  included: boolean
  base: string | null
  /** The base branch was picked by hand, so it no longer follows the project's. */
  manual: boolean
}

function BranchSelect({
  branches,
  value,
  onChange,
  disabled,
  label,
  testId,
}: {
  branches: readonly string[]
  value: string | null
  onChange: (value: string | null) => void
  disabled: boolean
  label: string
  testId: string
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full min-w-0" aria-label={label} data-testid={testId}>
        <SelectValue placeholder="Choose a branch" data-user-text="" />
      </SelectTrigger>
      <SelectContent data-testid={`${testId}-options`}>
        {branches.map((branch) => (
          <SelectItem key={branch} value={branch} data-user-text="">
            {branch}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NestedRepositoryRow({
  repository,
  choice,
  disabled,
  onChange,
}: {
  repository: NestedRepositoryOption
  choice: NestedChoice
  disabled: boolean
  onChange: (change: Partial<NestedChoice>) => void
}) {
  const id = `nested-${repository.relativePath}`
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-3"
      data-testid="worktree-nested"
      data-relative-path={repository.relativePath}
      data-has-commits={repository.hasCommits}
    >
      <Label htmlFor={id} className="min-w-0 font-normal">
        <Checkbox
          id={id}
          checked={choice.included}
          disabled={disabled || !repository.hasCommits}
          onCheckedChange={(checked) => onChange({ included: checked })}
          data-testid="worktree-nested-checkbox"
        />
        <span className="truncate font-mono text-xs" data-path="" title={repository.relativePath}>
          {repository.relativePath}
        </span>
      </Label>
      {repository.hasCommits ? (
        <BranchSelect
          branches={repository.branches}
          value={choice.base}
          onChange={(base) => onChange({ base, manual: true })}
          disabled={disabled || !choice.included}
          label={`Base branch of ${repository.relativePath}`}
          testId="worktree-nested-base-select"
        />
      ) : (
        <span className="text-xs text-muted-foreground" data-testid="worktree-nested-reason">
          No commits yet, so it cannot be included.
        </span>
      )}
    </li>
  )
}

/** The form of the new worktree dialog for a project, from its options. */
function NewWorktreeForm({
  projectRoot,
  options,
  onCreatingChange,
  onDone,
}: {
  projectRoot: string
  options: NewWorktreeOptions
  onCreatingChange: (creating: boolean) => void
  onDone: () => void
}) {
  const [branch, setBranch] = useState('')
  const [validity, setValidity] = useState<{ name: string; valid: boolean } | null>(null)
  const [location, setLocation] = useState<{ name: string; displayPath: string } | null>(null)
  const [base, setBase] = useState<string | null>(options.current)
  const [nested, setNested] = useState<Record<string, NestedChoice>>(() =>
    Object.fromEntries(
      options.nested.map((repository) => [
        repository.relativePath,
        {
          included: repository.hasCommits,
          base: defaultNestedBase(repository, options.current),
          manual: false,
        },
      ]),
    ),
  )
  const [submodules, setSubmodules] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectId = useAppStore(
    (state) => state.projects.find((project) => project.root === projectRoot)?.id,
  )
  const setProjectExpanded = useAppStore((state) => state.setProjectExpanded)

  useEffect(() => {
    if (branch === '') return
    let current = true
    void Promise.all([
      api.checkBranchName(branch).catch(() => false),
      api.previewWorktreePath(projectRoot, branch).catch(() => null),
    ]).then(([valid, preview]) => {
      if (!current) return
      setValidity({ name: branch, valid })
      setLocation(preview ? { name: branch, displayPath: preview.displayPath } : null)
    })
    return () => {
      current = false
    }
  }, [branch, projectRoot])

  const included = options.nested.filter((repository) => nested[repository.relativePath]?.included)
  const participants = useMemo(
    () => [
      ...(base === null ? [] : [{ relativePath: '', base }]),
      ...options.nested.flatMap((repository) => {
        const choice = nested[repository.relativePath]
        return choice?.included && choice.base !== null
          ? [{ relativePath: repository.relativePath, base: choice.base }]
          : []
      }),
    ],
    [base, nested, options.nested],
  )
  useEffect(() => {
    let current = true
    void api
      .getWorktreeSubmodules(projectRoot, participants)
      .catch(() => [])
      .then((paths) => {
        if (current) setSubmodules(paths)
      })
    return () => {
      current = false
    }
  }, [participants, projectRoot])

  const checked = validity !== null && validity.name === branch
  const nameValid = branch !== '' && checked && validity.valid
  const nameInvalid = branch !== '' && checked && !validity.valid
  const nestedReady = included.every((repository) => nested[repository.relativePath]?.base != null)
  const canCreate = nameValid && base !== null && nestedReady && !creating

  const changeBase = (value: string | null) => {
    setBase(value)
    // Inner repositories whose base was not picked by hand follow the project's.
    setNested((choices) =>
      Object.fromEntries(
        options.nested.map((repository) => {
          const choice = choices[repository.relativePath]!
          return [
            repository.relativePath,
            choice.manual ? choice : { ...choice, base: defaultNestedBase(repository, value) },
          ]
        }),
      ),
    )
  }

  const create = async (event?: { preventDefault(): void }) => {
    event?.preventDefault()
    if (creating || branch === '' || base === null || !nestedReady || nameInvalid) return
    setCreating(true)
    onCreatingChange(true)
    setError(null)
    // Enter may be pressed before the name has been checked.
    if (!nameValid) {
      const valid = await api.checkBranchName(branch).catch(() => false)
      setValidity({ name: branch, valid })
      if (!valid) {
        setCreating(false)
        onCreatingChange(false)
        return
      }
    }
    const result = await api
      .createWorktree({
        projectRoot,
        branch,
        base,
        nested: included.map((repository) => ({
          relativePath: repository.relativePath,
          base: nested[repository.relativePath]!.base!,
        })),
      })
      .catch((thrown: unknown) => ({ ok: false as const, message: errorMessage(thrown) }))
    setCreating(false)
    onCreatingChange(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    // The new worktree's row shows below the project, also when it was collapsed.
    if (projectId !== undefined) setProjectExpanded(projectId, true)
    if (result.warning) warnAboutWorktree(result.warning)
    onDone()
  }

  return (
    <form className="flex min-h-0 flex-col gap-4" onSubmit={(event) => void create(event)}>
      {/* The fields scroll; the title and the buttons stay. Its padding keeps focus rings in. */}
      <div
        className="-mx-4 -my-1 grid min-h-0 gap-4 overflow-y-auto px-4 py-1"
        data-testid="new-worktree-fields"
      >
        <div className="grid gap-2">
          <Label htmlFor="worktree-branch">Branch name</Label>
          <Input
            id="worktree-branch"
            value={branch}
            onChange={(event) => {
              setBranch(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              // Also before the name has been checked, while Create is still disabled.
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void create(event)
            }}
            disabled={creating}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="feat/new-idea"
            aria-invalid={nameInvalid}
            data-testid="worktree-branch-input"
          />
          {nameInvalid && (
            <p
              className="text-xs text-destructive"
              role="alert"
              data-testid="worktree-branch-error"
            >
              This is not a valid branch name.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label>Base branch</Label>
          <BranchSelect
            branches={options.branches}
            value={base}
            onChange={changeBase}
            disabled={creating}
            label="Base branch"
            testId="worktree-base-select"
          />
        </div>

        {options.nested.length > 0 && (
          <div className="grid gap-2">
            <Label>Nested repositories</Label>
            <p className="text-xs text-muted-foreground">
              Each one gets the same branch, at the same path inside the new worktree.
            </p>
            <ul
              className="-mx-1 grid max-h-64 gap-2 overflow-y-auto px-1 py-0.5"
              data-testid="worktree-nested-list"
            >
              {options.nested.map((repository) => (
                <NestedRepositoryRow
                  key={repository.relativePath}
                  repository={repository}
                  choice={nested[repository.relativePath]!}
                  disabled={creating}
                  onChange={(change) =>
                    setNested((choices) => ({
                      ...choices,
                      [repository.relativePath]: {
                        ...choices[repository.relativePath]!,
                        ...change,
                      },
                    }))
                  }
                />
              ))}
            </ul>
          </div>
        )}

        {submodules.length > 0 && (
          <div
            className="grid gap-1 text-xs text-muted-foreground"
            data-testid="worktree-submodules"
          >
            <span>These submodules will not be populated; their folders stay empty:</span>
            <ul className="grid max-h-40 gap-0.5 overflow-y-auto">
              {submodules.map((submodule) => (
                <li
                  key={submodule}
                  className="font-mono text-foreground"
                  data-path=""
                  data-testid="worktree-submodule"
                >
                  {submodule}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-1">
          <span className="text-sm font-medium">Location</span>
          <span
            className="font-mono text-xs break-all text-muted-foreground"
            data-path=""
            data-testid="worktree-location"
          >
            {branch !== '' && location?.name === branch ? location.displayPath : '—'}
          </span>
        </div>

        {error !== null && (
          <p
            className="max-h-40 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive"
            role="alert"
            data-path=""
            data-testid="worktree-create-error"
          >
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={creating}
          onClick={onDone}
          data-testid="worktree-cancel"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canCreate} data-testid="worktree-create">
          {creating && <Spinner />}
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Loads the options of a project's new worktree dialog, then shows its form. */
function NewWorktreeContent({
  projectRoot,
  onCreatingChange,
  onDone,
}: {
  projectRoot: string
  onCreatingChange: (creating: boolean) => void
  onDone: () => void
}) {
  const projectName = useAppStore(
    (state) => state.projects.find((project) => project.root === projectRoot)?.name,
  )
  const [options, setOptions] = useState<NewWorktreeOptionsResult | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void api.getNewWorktreeOptions(projectRoot).then(
      (loaded) => {
        if (current) setOptions(loaded)
      },
      (error: unknown) => {
        if (current) setLoadError(errorMessage(error))
      },
    )
    return () => {
      current = false
    }
  }, [projectRoot])

  return (
    <>
      <DialogHeader>
        <DialogTitle data-testid="new-worktree-title">
          New Worktree in <span data-path="">{projectName}</span>
        </DialogTitle>
        <DialogDescription>
          Creates a new branch and checks it out in a folder of its own.
        </DialogDescription>
      </DialogHeader>
      {loadError !== null ? (
        <>
          <p className="text-sm text-destructive" data-path="">
            {loadError}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onDone}>
              Close
            </Button>
          </DialogFooter>
        </>
      ) : options === undefined ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="new-worktree-loading"
        >
          <Spinner />
          Looking for branches and nested repositories…
        </p>
      ) : !options.ok ? (
        <>
          <p className="text-sm text-destructive">{options.message}</p>
          <DialogFooter>
            <Button variant="outline" onClick={onDone}>
              Close
            </Button>
          </DialogFooter>
        </>
      ) : (
        <NewWorktreeForm
          projectRoot={projectRoot}
          options={options.options}
          onCreatingChange={onCreatingChange}
          onDone={onDone}
        />
      )}
    </>
  )
}

/**
 * The new worktree dialog: the name of the new branch, the base branch, the
 * inner repositories to include with their base branches, the submodules that
 * stay empty, and where the worktree will be. While the worktree is being
 * created, the dialog says so and stays open.
 */
export function NewWorktreeDialog() {
  const projectRoot = useAppStore((state) => state.newWorktreeProject)
  const close = useAppStore((state) => state.closeNewWorktreeDialog)
  // Kept while the dialog fades out after it closes.
  const [shownRoot, setShownRoot] = useState<string | null>(null)
  if (projectRoot !== null && projectRoot !== shownRoot) setShownRoot(projectRoot)
  const creating = useRef(false)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={projectRoot !== null}
      onOpenChange={(open) => {
        if (!open && !creating.current) close()
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Below the window's top row, whose blank parts drag the window, however many
        // nested repositories and submodules there are.
        className="flex max-h-[calc(100dvh-7rem)] flex-col sm:max-w-lg"
        finalFocus={focusAfterOverlay}
        data-testid="new-worktree-dialog"
        data-creating={busy}
      >
        {shownRoot !== null && (
          <NewWorktreeContent
            key={shownRoot}
            projectRoot={shownRoot}
            onCreatingChange={(value) => {
              creating.current = value
              setBusy(value)
            }}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
