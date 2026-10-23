import { ChevronDownIcon, FolderIcon, XIcon } from 'lucide-react'
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
import { worktreeBranchName } from '../../shared/worktree-names'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { errorMessage, focusAfterOverlay, useAppStore, warnAboutWorktree } from '../store/app-store'
import { Spinner } from './ui/spinner'
import { ToolIcon } from './tool-icon'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Kbd } from './ui/kbd'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

/** The small rounded buttons of the dialog's agent and Advanced choices. */
const CHIP = 'rounded-full'

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
        {branches.map((branch) => (
          <SelectItem key={branch} value={branch} data-user-text="">
            {branch}
          </SelectItem>
        ))}
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
        <ToolIcon toolId={selected} />
        <span>{getTool(selected).label}</span>
      </ComboboxTrigger>
      <ComboboxContent className="w-56" finalFocus={focusAfterOverlay}>
        <ComboboxInput
          showTrigger={false}
          placeholder="Search agents…"
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
            className={cn(CHIP, 'max-w-56')}
            aria-label={`Project: ${value.name}`}
            disabled={disabled}
            data-testid="worktree-project-button"
          />
        }
      >
        <FolderIcon className="text-muted-foreground" />
        <span className="min-w-0 truncate" data-path="">
          {value.name}
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="w-64" finalFocus={focusAfterOverlay}>
        <ComboboxInput
          showTrigger={false}
          placeholder="Search projects…"
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

/** The form of the new worktree dialog for a project, from its options. */
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
  options: NewWorktreeOptions
  onCreatingChange: (creating: boolean) => void
  onDone: () => void
}) {
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
  const setProjectExpanded = useAppStore((state) => state.setProjectExpanded)
  const openCreatedSession = useAppStore((state) => state.openCreatedSession)

  const included = options.nested.filter((repository) => nested[repository.relativePath]?.included)
  const undecided =
    base === null || included.some((repository) => nested[repository.relativePath]!.base === null)
  // Advanced opens by itself while a base branch cannot be told, to be picked.
  const [advancedOpen, setAdvancedOpen] = useState(undecided)

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

  const branch = worktreeBranchName(name)
  const canCreate = !creating && base !== null && !undecided
  const summary = [
    base ?? 'No base branch',
    ...included.map((repository) => repository.relativePath),
  ]
    .filter(Boolean)
    .join(', ')

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
    // The new worktree's row shows below the project, also when it was collapsed.
    setProjectExpanded(project.id, true)
    if (result.warning) warnAboutWorktree(result.warning)
    const session: SavedSessionInfo = result.session
    openCreatedSession(session)
    onDone()
  }

  return (
    <form className="flex min-h-0 flex-col gap-3" onSubmit={(event) => void create(event)}>
      <div
        className="-mx-4 grid min-h-0 gap-3 overflow-y-auto px-4 py-1"
        data-testid="new-worktree-fields"
      >
        <div className="grid gap-2">
          <Input
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
            placeholder="Name (optional)"
            aria-label="Worktree name"
            data-testid="worktree-name-input"
          />
          <p className="text-xs text-muted-foreground" data-testid="worktree-branch-hint">
            {branch === null ? (
              'The branch will get a random name when the worktree is created.'
            ) : (
              <>
                Branch: <span className="font-mono text-foreground">{branch}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <AgentPicker value={agent} onChange={onAgentChange} />
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger
              render={
                <Button
                  variant="outline"
                  size="xs"
                  className={cn(CHIP, 'max-w-72', undecided && 'border-destructive')}
                  aria-expanded={advancedOpen}
                  data-testid="worktree-advanced-button"
                />
              }
            >
              <span>Advanced</span>
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
              <ChevronDownIcon
                className={cn(
                  'text-muted-foreground transition-transform',
                  advancedOpen && 'rotate-180',
                )}
              />
            </CollapsibleTrigger>
          </Collapsible>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleContent>
            <div className="grid gap-3 rounded-lg border p-3" data-testid="worktree-advanced">
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
              </div>

              {options.nested.length > 0 && (
                <div className="grid gap-2">
                  <Label>Inner repositories</Label>
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
            </div>
          </CollapsibleContent>
        </Collapsible>

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
        <span className="mr-auto text-xs text-muted-foreground">
          Press <Kbd>Enter</Kbd> to create
        </span>
        <Button type="submit" disabled={!canCreate} data-testid="worktree-create">
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
  onCreatingChange,
  onDone,
}: {
  initialProject: Project
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

  if (project === undefined) return null
  return (
    <>
      <DialogHeader className="flex-row items-center gap-2 pr-8">
        <ProjectPicker value={project} onChange={setChosen} disabled={false} />
        <span className="text-sm text-muted-foreground" aria-hidden>
          ›
        </span>
        <DialogTitle data-testid="new-worktree-title">New worktree</DialogTitle>
      </DialogHeader>
      {result === null ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="new-worktree-loading"
        >
          <Spinner />
          Looking for branches and inner repositories…
        </p>
      ) : 'error' in result ? (
        <p className="text-sm text-destructive" data-path="">
          {result.error}
        </p>
      ) : !result.options.ok ? (
        <p className="text-sm text-destructive" data-testid="new-worktree-unavailable">
          {result.options.message}
        </p>
      ) : (
        <NewWorktreeForm
          key={project.root}
          projectRoot={project.root}
          project={project}
          name={name}
          onNameChange={setName}
          agent={agent}
          onAgentChange={setAgent}
          options={result.options.options}
          onCreatingChange={onCreatingChange}
          onDone={onDone}
        />
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
        className="flex max-h-[calc(100dvh-7rem)] flex-col gap-4 sm:max-w-md"
        finalFocus={focusAfterOverlay}
        data-testid="new-worktree-dialog"
        data-creating={busy}
      >
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              aria-label="Close"
              disabled={busy}
              data-testid="worktree-close"
            />
          }
        >
          <XIcon />
        </DialogClose>
        {project !== undefined && (
          <NewWorktreeContent
            key={project.root}
            initialProject={project}
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
