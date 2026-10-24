import {
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultAgentUsable,
  chatAgent,
  usableChatAgents,
  type SavedSessionInfo,
} from '../../shared/chats'
import type { Project } from '../../shared/ipc'
import { getTool, type CodingToolId } from '../../shared/tools'
import {
  defaultNestedBase,
  type NestedRepositoryOption,
  type NewWorktreeOptions,
  type NewWorktreeOptionsResult,
} from '../../shared/worktrees'
import { hasUntransliterableText, worktreeBranchName } from '../../shared/worktree-names'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { errorMessage, focusAfterOverlay, useAppStore, warnAboutWorktree } from '../store/app-store'
import { Spinner } from './ui/spinner'
import { ToolIcon } from './tool-icon'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from './ui/dialog'
import { Kbd } from './ui/kbd'
import { Label } from './ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

/** The small rounded buttons of the dialog's agent and Advanced choices. */
const CHIP = 'rounded-full'

/**
 * Why a name gets a random branch, when it does but is not blank: it has
 * text that cannot become ASCII, or it becomes nothing, as when it is only
 * symbols.
 */
function randomBranchReason(name: string): 'non-ascii' | 'no-letters' | null {
  if (name.trim() === '' || hasUntransliterableText(name)) return null
  return worktreeBranchName(name) === null ? 'no-letters' : null
}

/** The branch the name gives, or why the branch will be named at random. */
function BranchHint({ name }: { name: string }) {
  const branch = worktreeBranchName(name)
  const reason = randomBranchReason(name)
  return (
    <p
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="worktree-branch-hint"
    >
      {branch !== null ? (
        <>
          <GitBranchIcon className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-foreground/80" data-user-text="">
            {branch}
          </span>
        </>
      ) : (
        <>
          <ShuffleIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {reason === 'non-ascii'
              ? 'The branch gets a random name: this one cannot be spelled in ASCII.'
              : reason === 'no-letters'
                ? 'The branch gets a random name: this one has no letters or digits.'
                : 'A random name is picked when you create it.'}
          </span>
        </>
      )}
    </p>
  )
}

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
  missing = false,
}: {
  branches: readonly string[]
  value: string | null
  onChange: (value: string | null) => void
  disabled: boolean
  label: string
  testId: string
  /** No branch is chosen yet, which Hoot marks. */
  missing?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn('w-full min-w-0', missing && 'border-destructive')}
        aria-label={label}
        aria-invalid={missing}
        data-testid={testId}
      >
        <SelectValue placeholder="Choose a branch" data-user-text="" />
      </SelectTrigger>
      <SelectContent data-testid={`${testId}-options`}>
        <SelectGroup>
          {branches.map((branch) => (
            <SelectItem key={branch} value={branch} data-user-text="">
              {branch}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** The agent choices of the dialog: the usable agents, with the default one marked. */
function AgentPicker({
  value,
  onChange,
}: {
  value: CodingToolId
  onChange: (toolId: CodingToolId) => void
}) {
  const tools = useAppStore((state) => state.tools)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const usable = usableChatAgents(tools, launchSettings)
  const marked = defaultAgentUsable(tools, launchSettings)
  const defaultAgent = launchSettings?.defaultAgent ?? 'claude'
  const selected = usable.includes(value) ? value : (usable[0] ?? value)

  return (
    <Combobox
      items={usable as CodingToolId[]}
      value={selected}
      onValueChange={(toolId: CodingToolId | null) => {
        if (toolId !== null) onChange(toolId)
      }}
      autoHighlight
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={CHIP}
            aria-label={`Agent: ${getTool(selected).label}`}
            data-testid="worktree-agent-button"
            data-tool={selected}
          />
        }
      >
        <ToolIcon toolId={selected} className="size-3.5" />
        <span>{getTool(selected).label}</span>
      </ComboboxTrigger>
      <ComboboxContent className="w-56">
        <ComboboxInput
          showTrigger={false}
          placeholder="Choose an agent…"
          aria-label="Agent"
          data-testid="worktree-agent-search"
        />
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(toolId: CodingToolId) => (
            <ComboboxItem
              key={toolId}
              value={toolId}
              data-testid={`worktree-dialog-agent-${toolId}`}
            >
              <ToolIcon toolId={toolId} />
              <span className="min-w-0 flex-1 truncate">{getTool(toolId).label}</span>
              {marked && defaultAgent === toolId && (
                <Badge
                  variant="secondary"
                  className="ml-auto"
                  data-testid={`worktree-dialog-agent-default-${toolId}`}
                >
                  Default
                </Badge>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/** The projects the dialog can make a worktree in, in the sidebar's order. */
function ProjectPicker({
  value,
  onChange,
  disabled,
}: {
  value: Project
  onChange: (project: Project) => void
  disabled: boolean
}) {
  const projects = useAppStore((state) => state.projects)
  return (
    <Combobox
      items={projects as Project[]}
      value={value}
      onValueChange={(project: Project | null) => {
        if (project !== null) onChange(project)
      }}
      autoHighlight
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={CHIP}
            aria-label={`Project: ${value.name}`}
            disabled={disabled}
            data-testid="worktree-project-button"
          />
        }
      >
        <FolderIcon className="size-3.5 text-muted-foreground" />
        <span data-path="">{value.name}</span>
      </ComboboxTrigger>
      <ComboboxContent className="w-64">
        <ComboboxInput
          showTrigger={false}
          placeholder="Set project…"
          aria-label="Project"
          data-testid="worktree-project-search"
        />
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(project: Project) => (
            <ComboboxItem
              key={project.id}
              value={project}
              data-testid={`worktree-dialog-project-${project.id}`}
            >
              <FolderIcon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" data-path="">
                {project.name}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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
          missing={choice.included && choice.base === null}
        />
      ) : (
        <span className="text-xs text-muted-foreground" data-testid="worktree-nested-reason">
          No commits yet, so it cannot be included.
        </span>
      )}
    </li>
  )
}

/**
 * The form of the new worktree dialog for a project, usable before its
 * options arrive: only Advanced and Create wait for the branches and inner
 * repositories that `options` carries, while the name, the branch it gives
 * and the agent work at once.
 */
function NewWorktreeForm({
  projectRoot,
  project,
  name,
  onNameChange,
  agent,
  onAgentChange,
  options,
  onCreatingChange,
  onDone,
}: {
  projectRoot: string
  project: Project
  name: string
  onNameChange: (name: string) => void
  agent: CodingToolId
  onAgentChange: (agent: CodingToolId) => void
  /** The project's branches and inner repositories, or `null` while they load. */
  options: NewWorktreeOptions | null
  onCreatingChange: (creating: boolean) => void
  onDone: () => void
}) {
  // The choices to make, from the project's own branches once Git has given
  // them: kept with the options they were made from, so that the first
  // options to arrive replace them.
  const [choices, setChoices] = useState<{
    from: NewWorktreeOptions | null
    base: string | null
    nested: Record<string, NestedChoice>
    advancedOpen: boolean
  }>({ from: null, base: null, nested: {}, advancedOpen: false })
  if (options !== null && choices.from !== options) {
    const nested = Object.fromEntries(
      options.nested.map((repository) => [
        repository.relativePath,
        {
          included: repository.hasCommits,
          base: defaultNestedBase(repository, options.current),
          manual: false,
        } satisfies NestedChoice,
      ]),
    )
    // Advanced opens by itself while a base branch cannot be told, to be picked.
    const undecided =
      options.current === null ||
      options.nested.some((repository) => {
        const choice = nested[repository.relativePath]
        return choice?.included && choice.base === null
      })
    setChoices({ from: options, base: options.current, nested, advancedOpen: undecided })
  }
  const { base, nested, advancedOpen } = choices
  const setAdvancedOpen = (open: boolean) =>
    setChoices((current) => ({ ...current, advancedOpen: open }))
  const [submodules, setSubmodules] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setProjectExpanded = useAppStore((state) => state.setProjectExpanded)
  const setWorktreeExpanded = useAppStore((state) => state.setWorktreeExpanded)
  const openCreatedSession = useAppStore((state) => state.openCreatedSession)

  const included =
    options?.nested.filter((repository) => nested[repository.relativePath]?.included) ?? []
  const undecided =
    options !== null &&
    (base === null || included.some((repository) => nested[repository.relativePath]!.base === null))

  const participants = useMemo(
    () => [
      ...(base === null ? [] : [{ relativePath: '', base }]),
      ...(options?.nested.flatMap((repository) => {
        const choice = nested[repository.relativePath]
        return choice?.included && choice.base !== null
          ? [{ relativePath: repository.relativePath, base: choice.base }]
          : []
      }) ?? []),
    ],
    [base, nested, options],
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

  const canCreate = !creating && options !== null && base !== null && !undecided
  const summary =
    options === null
      ? null
      : [
          base === null ? 'Choose a base branch' : `From ${base}`,
          ...(included.length > 0
            ? [`with ${included.map((repository) => repository.relativePath).join(', ')}`]
            : []),
        ].join(' · ')

  const changeBase = (value: string | null) =>
    setChoices((current) => ({
      ...current,
      base: value,
      // Inner repositories whose base was not picked by hand follow the project's.
      nested: Object.fromEntries(
        (options?.nested ?? []).map((repository) => {
          const choice = current.nested[repository.relativePath]!
          return [
            repository.relativePath,
            choice.manual ? choice : { ...choice, base: defaultNestedBase(repository, value) },
          ]
        }),
      ),
    }))

  const create = async (event?: { preventDefault(): void }) => {
    event?.preventDefault()
    if (!canCreate || base === null) return
    setCreating(true)
    onCreatingChange(true)
    setError(null)
    const result = await api
      .createWorktree({
        projectRoot,
        name,
        toolId: agent,
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
    // The new worktree's row shows below the project, also when it was
    // collapsed, with its session's row below it.
    setProjectExpanded(project.id, true)
    setWorktreeExpanded(project.root, result.path, true)
    if (result.warning) warnAboutWorktree(result.warning)
    const session: SavedSessionInfo = result.session
    openCreatedSession(session)
    onDone()
  }

  return (
    <form onSubmit={(event) => void create(event)}>
      <div className="grid gap-2 px-4 pt-4 pb-3" data-testid="new-worktree-fields">
        <input
          value={name}
          onChange={(event) => {
            onNameChange(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            // Enter creates, also while the name is blank, which takes a random one.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void create(event)
          }}
          disabled={creating}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="Worktree name, or leave empty"
          aria-label="Name"
          data-testid="worktree-name-input"
          className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
        />
        <BranchHint name={name} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        <AgentPicker value={agent} onChange={onAgentChange} />
        <Button
          type="button"
          variant={advancedOpen ? 'secondary' : 'outline'}
          size="xs"
          className={cn(CHIP, 'max-w-72', undecided && 'text-destructive')}
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
          data-testid="worktree-advanced-button"
        >
          <SlidersHorizontalIcon className="size-3.5" />
          <span className="min-w-0 truncate">
            {advancedOpen || summary === null ? 'Advanced' : summary}
          </span>
        </Button>
      </div>

      {error !== null && (
        <p
          className="mx-4 mb-3 max-h-40 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive"
          role="alert"
          data-path=""
          data-testid="worktree-create-error"
        >
          {error}
        </p>
      )}

      {advancedOpen && (
        <div
          className="max-h-[40vh] overflow-y-auto border-t px-4 py-3"
          data-testid="worktree-advanced"
        >
          {options === null ? (
            <p
              className="flex items-center gap-2 text-xs text-muted-foreground"
              data-testid="new-worktree-loading"
            >
              <Spinner />
              Looking for branches and inner repositories…
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Base branch</Label>
                <BranchSelect
                  branches={options.branches}
                  value={base}
                  onChange={changeBase}
                  disabled={creating}
                  label="Base branch"
                  testId="worktree-base-select"
                  missing={base === null}
                />
                {base === null && (
                  <p className="text-xs text-destructive">
                    The main worktree has no branch checked out: pick the branch to start from.
                  </p>
                )}
              </div>

              {options.nested.length > 0 && (
                <div className="grid gap-2">
                  <Label>Nested repositories</Label>
                  <p className="text-xs text-muted-foreground">
                    Each one gets the same branch, at the same path inside the new worktree.
                  </p>
                  <ul className="grid gap-2" data-testid="worktree-nested-list">
                    {options.nested.map((repository) => (
                      <NestedRepositoryRow
                        key={repository.relativePath}
                        repository={repository}
                        choice={nested[repository.relativePath]!}
                        disabled={creating}
                        onChange={(change) =>
                          setChoices((current) => ({
                            ...current,
                            nested: {
                              ...current.nested,
                              [repository.relativePath]: {
                                ...current.nested[repository.relativePath]!,
                                ...change,
                              },
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
                  <ul className="grid gap-0.5">
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
            </div>
          )}
        </div>
      )}

      <DialogFooter className="m-0 flex-row items-center justify-end gap-3 px-4 py-3 sm:flex-row">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Kbd>Enter</Kbd> to create
        </span>
        <Button type="submit" size="sm" disabled={!canCreate} data-testid="worktree-create">
          {creating && <Spinner />}
          {creating ? 'Creating…' : 'Create worktree'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Loads the options of a project's new worktree dialog, then shows its form. */
function NewWorktreeContent({
  initialProject,
  busy,
  onCreatingChange,
  onDone,
}: {
  initialProject: Project
  busy: boolean
  onCreatingChange: (creating: boolean) => void
  onDone: () => void
}) {
  const projects = useAppStore((state) => state.projects)
  const tools = useAppStore((state) => state.tools)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const [chosen, setChosen] = useState(initialProject)
  // A picked project that leaves the list gives way to the first one.
  const project = projects.find((candidate) => candidate.id === chosen.id) ?? projects[0]
  // Kept when another project is picked, as the agent the user picked is.
  const [name, setName] = useState('')
  const [agent, setAgent] = useState<CodingToolId>(
    () => chatAgent(tools, launchSettings) ?? 'claude',
  )
  const [loaded, setLoaded] = useState<
    { root: string; options: NewWorktreeOptionsResult } | { root: string; error: string } | null
  >(null)
  const root = project?.root ?? null
  useEffect(() => {
    if (root === null) return
    let current = true
    void api.getNewWorktreeOptions(root).then(
      (options) => {
        if (current) setLoaded({ root, options })
      },
      (error: unknown) => {
        if (current) setLoaded({ root, error: errorMessage(error) })
      },
    )
    return () => {
      current = false
    }
  }, [root])
  const result = loaded !== null && loaded.root === root ? loaded : null
  const options =
    result !== null && !('error' in result) && result.options.ok ? result.options.options : null
  // Why the dialog cannot make a worktree here, once that is known.
  const problem =
    result === null
      ? null
      : 'error' in result
        ? result.error
        : result.options.ok
          ? null
          : result.options.message

  if (project === undefined) return null
  return (
    <>
      <div className="flex items-center gap-1.5 px-4 pt-3">
        <ProjectPicker value={project} onChange={setChosen} disabled={busy} />
        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        <DialogTitle className="text-sm font-normal" data-testid="new-worktree-title">
          New worktree
        </DialogTitle>
        <div className="flex-1" />
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              disabled={busy}
              data-testid="worktree-close"
            />
          }
        >
          <XIcon />
        </DialogClose>
      </div>
      {problem === null ? (
        <NewWorktreeForm
          key={project.root}
          projectRoot={project.root}
          project={project}
          name={name}
          onNameChange={setName}
          agent={agent}
          onAgentChange={setAgent}
          options={options}
          onCreatingChange={onCreatingChange}
          onDone={onDone}
        />
      ) : (
        <p
          className="px-4 py-3 text-sm text-destructive"
          data-path=""
          data-testid="new-worktree-unavailable"
        >
          {problem}
        </p>
      )}
    </>
  )
}

/**
 * The New Worktree dialog: the project, a name that may be blank, the agent to
 * open a session with, and under Advanced the base branches and the inner
 * repositories to bring along. While the worktree is being created, the
 * dialog says so, stays open, and closes only once it is made.
 */
export function NewWorktreeDialog() {
  const projectRoot = useAppStore((state) => state.newWorktreeProject)
  const projects = useAppStore((state) => state.projects)
  const close = useAppStore((state) => state.closeNewWorktreeDialog)
  // Kept while the dialog fades out after it closes.
  const [shownRoot, setShownRoot] = useState<string | null>(null)
  if (projectRoot !== null && projectRoot !== shownRoot) setShownRoot(projectRoot)
  const creating = useRef(false)
  const [busy, setBusy] = useState(false)
  const project = projects.find((candidate) => candidate.root === shownRoot)

  return (
    <Dialog
      open={projectRoot !== null}
      onOpenChange={(open) => {
        if (!open && !creating.current) close()
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Below the window's top row, whose blank parts drag the window.
        className="top-[max(3.5rem,12vh)] translate-y-0 gap-0 p-0 sm:max-w-xl"
        finalFocus={focusAfterOverlay}
        data-testid="new-worktree-dialog"
        data-creating={busy}
      >
        {project !== undefined && (
          <NewWorktreeContent
            key={project.root}
            initialProject={project}
            busy={busy}
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
