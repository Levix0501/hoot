import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CircleDotIcon,
  GripVerticalIcon,
  MinusIcon,
  SquareArrowOutUpRightIcon,
  FolderIcon,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ISSUE_WINDOW_MARGIN,
  issueWindowPositionOf,
  type IssueWindowPosition,
} from '../../../shared/issue-window'
import { isIssueOpen, issueIdentifier, listOrder, type Issue } from '../../../shared/issues'
import { endIssueDrag, startIssueDrag } from '../../lib/issue-drag'
import { timeAgo } from '../../lib/time'
import { cn } from '../../lib/utils'
import { currentSessionId, focusAfterOverlay, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Kbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { PriorityIcon, StatusIcon } from './issue-icons'
import type { IssueNoteEditorHandle } from './issue-note-editor'
import { ProjectPicker } from './property-picker'
import { useNow } from './relative-time'

/** The note's editor, with notra-editor, which is loaded the first time the window opens. */
const IssueNoteEditor = lazy(() => import('./issue-note-editor'))

/** What is written in the note and not yet made an issue, kept while the window is closed. */
let noteDraft = ''

/** Whether the note takes the keyboard focus once it shows: when the window was opened by hand. */
let focusNoteOnOpen = false

/** What moves the window, from `useDraggable`. */
type Draggable = ReturnType<typeof useDraggable>

/** `value` brought within `min` and `max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Keeps the window inside Hoot's window, a margin from its edges, while it is moved. */
const keepInWindow: Modifier = ({ transform, draggingNodeRect, windowRect }) => {
  if (!draggingNodeRect || !windowRect) return transform
  return {
    ...transform,
    x: clamp(
      transform.x,
      ISSUE_WINDOW_MARGIN - draggingNodeRect.left,
      windowRect.width - ISSUE_WINDOW_MARGIN - draggingNodeRect.right,
    ),
    y: clamp(
      transform.y,
      ISSUE_WINDOW_MARGIN - draggingNodeRect.top,
      windowRect.height - ISSUE_WINDOW_MARGIN - draggingNodeRect.bottom,
    ),
  }
}

/**
 * Where the window shows: at its distances from its corner, no larger than
 * the space left between them and the window's opposite edges.
 */
function placement(position: IssueWindowPosition): CSSProperties {
  const style: CSSProperties = {
    maxWidth: `calc(100vw - ${position.x + ISSUE_WINDOW_MARGIN}px)`,
    maxHeight: `calc(100vh - ${position.y + ISSUE_WINDOW_MARGIN}px)`,
  }
  if (position.side === 'right') style.right = position.x
  else style.left = position.x
  if (position.edge === 'bottom') style.bottom = position.y
  else style.top = position.y
  return style
}

/** The open issues, in the order of the issue list. */
function useOpenIssues(): Issue[] {
  const issues = useAppStore(useShallow((state) => state.issues.filter(isIssueOpen)))
  return useMemo(() => listOrder(issues, 'all'), [issues])
}

/** The project of what the main area shows: a session's, or an issue's; `null` for none. */
function useShownProjectId(): number | null {
  return useAppStore((state) => {
    const page = state.currentPage
    if (page?.kind === 'issue') {
      return state.issues.find((issue) => issue.id === page.issueId)?.projectId ?? null
    }
    const id = currentSessionId(state)
    const session = state.sessions.find((entry) => entry.id === id)
    if (!session || session.chatId !== null) return null
    return state.projects.find((project) => project.root === session.projectRoot)?.id ?? null
  })
}

/** The issues the window lists: all of them, a project's, or those of no project. */
type ProjectFilterValue = 'all' | number | null

function ProjectFilter({
  value,
  onChange,
}: {
  value: ProjectFilterValue
  onChange(value: ProjectFilterValue): void
}) {
  const projects = useAppStore((state) => state.projects)
  const label =
    value === 'all'
      ? 'All projects'
      : value === null
        ? 'No project'
        : (projects.find((project) => project.id === value)?.name ?? 'All projects')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="max-w-40 gap-1 text-muted-foreground"
            data-testid="issue-window-project-filter"
          />
        }
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44 [app-region:no-drag]">
        {/* One is picked at a time, which closes the menu, as a select does. */}
        <DropdownMenuRadioGroup
          value={String(value)}
          onValueChange={(next: string) =>
            onChange(next === 'all' ? 'all' : next === 'null' ? null : Number(next))
          }
        >
          <DropdownMenuRadioItem value="all" closeOnClick>
            All projects
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {projects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              value={String(project.id)}
              closeOnClick
              data-path=""
            >
              {project.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="null" closeOnClick>
            No project
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HeaderButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string
  onClick(): void
  children: ReactNode
  testId: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={label}
            onClick={onClick}
            data-testid={testId}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * An issue in the window: its status and title, then its priority,
 * identifier, project and age. A click shows the issue's page. Dragged onto
 * the terminal of a running agent, it pastes the issue into the agent's
 * input, unsent.
 */
function IssueWindowRow({
  issue,
  project,
  now,
}: {
  issue: Issue
  project: string | null
  now: number
}) {
  const showIssue = useAppStore((state) => state.showIssue)
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(event) => startIssueDrag(event, issue)}
        onDragEnd={endIssueDrag}
        onClick={() => showIssue(issue.id)}
        className="group/row mx-1 grid w-[calc(100%-0.5rem)] cursor-default gap-0.5 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
        data-testid="issue-window-row"
        data-issue-id={issue.id}
      >
        <span className="flex min-w-0 items-center gap-2">
          <StatusIcon status={issue.status} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate text-sm" data-user-text="">
            {issue.title}
          </span>
          <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 group-hover/row:opacity-100" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-5.5 text-xs text-muted-foreground">
          <PriorityIcon priority={issue.priority} className="size-3" />
          <span className="tabular-nums">{issueIdentifier(issue.id)}</span>
          {project !== null && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate" data-path="">
                {project}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="shrink-0">{timeAgo(issue.createdAt, now)}</span>
        </span>
      </button>
    </li>
  )
}

/**
 * The note at the window's bottom, written as in a chat: its first line is
 * the new issue's title and what follows its description. ⌘ Enter creates
 * the issue, in the project of what the main area shows unless another is
 * picked, and empties the note for the next one.
 */
function IssueNote({ onEscape }: { onEscape(): void }) {
  const shownProject = useShownProjectId()
  const noteIssue = useAppStore((state) => state.noteIssue)
  /** The project picked by hand, which the next issues keep; `undefined` follows the main area. */
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  const project = useAppStore((state) => {
    const id = picked === undefined ? shownProject : picked
    return state.projects.find((entry) => entry.id === id) ?? null
  })
  const [hasText, setHasText] = useState(() => noteDraft.trim() !== '')
  const [autoFocus] = useState(() => {
    const focus = focusNoteOnOpen
    focusNoteOnOpen = false
    return focus
  })
  const editor = useRef<IssueNoteEditorHandle>(null)

  const create = async () => {
    const note = editor.current?.note()
    if (!note) return
    const created = await noteIssue({
      title: note.title,
      description: note.description,
      projectId: project?.id ?? null,
      status: 'backlog',
      priority: 0,
    })
    if (created === null) return
    noteDraft = ''
    editor.current?.clear()
    setHasText(false)
  }

  return (
    <div
      className="shrink-0 border-t p-2"
      // Before the editor, where ⌘ Enter would otherwise break the line.
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          void create()
        }
      }}
    >
      <div className="rounded-lg bg-background px-3 pt-2 pb-1.5 ring-1 ring-input focus-within:ring-2 focus-within:ring-ring/60">
        <div className="max-h-48 min-h-10 cursor-text overflow-y-auto">
          <Suspense fallback={null}>
            <IssueNoteEditor
              ref={editor}
              initial={noteDraft}
              placeholder="Note an issue… the first line is its title"
              autoFocus={autoFocus}
              onEscape={onEscape}
              onChange={(markdown, text) => {
                noteDraft = markdown
                setHasText(text)
              }}
            />
          </Suspense>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <ProjectPicker
            value={project?.id ?? null}
            onChange={setPicked}
            triggerProps={{
              render: (
                <Button
                  variant="outline"
                  size="xs"
                  className="max-w-40 rounded-full"
                  aria-label={`Project: ${project?.name ?? 'No project'}`}
                  data-testid="issue-note-project"
                />
              ),
            }}
          >
            <FolderIcon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 truncate" data-path={project ? '' : undefined}>
              {project ? project.name : 'Project'}
            </span>
          </ProjectPicker>
          <div className="flex-1" />
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <Button
            size="icon-xs"
            className="rounded-full"
            disabled={!hasText}
            aria-label="Create issue"
            onClick={() => void create()}
            data-testid="issue-note-create"
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The frame of the open window: a popover's colors, ring and corners. */
const PANEL =
  'fixed z-40 flex h-[min(680px,calc(100vh-96px))] w-[340px] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 [app-region:no-drag]'

/**
 * The window, open: its title row, which moves it, with the Project filter,
 * a button that shows the issue list and one that closes the window to its
 * button; the open issues; and the note.
 */
function OpenWindow({ style, draggable }: { style: CSSProperties; draggable: Draggable }) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging: dragging } = draggable
  const setOpen = useAppStore((state) => state.setIssueWindowOpen)
  const showIssueList = useAppStore((state) => state.showIssueList)
  const projects = useAppStore((state) => state.projects)
  const issues = useOpenIssues()
  const now = useNow()
  const [filter, setFilter] = useState<ProjectFilterValue>('all')
  const shown = filter === 'all' ? issues : issues.filter((issue) => issue.projectId === filter)
  const names = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const panel = useRef<HTMLElement>(null)

  const close = () => {
    const hadFocus = panel.current?.contains(document.activeElement) === true
    setOpen(false)
    if (!hadFocus) return
    // Back to the terminal of the session shown, rather than to nowhere.
    const target = focusAfterOverlay()
    if (target instanceof HTMLElement) target.focus()
  }

  return (
    <section
      ref={(node) => {
        setNodeRef(node)
        panel.current = node
      }}
      style={style}
      aria-label="Issues"
      className={cn(PANEL, dragging && 'shadow-xl')}
      // Esc from anywhere in it but the note, which says so itself (see `IssueNote`).
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing)
          return
        event.preventDefault()
        close()
      }}
      data-testid="issue-window"
    >
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        className={cn(
          'flex h-10 shrink-0 cursor-grab items-center gap-1 border-b pr-1.5 pl-3 select-none',
          dragging && 'cursor-grabbing',
        )}
        data-testid="issue-window-header"
      >
        <span className="text-sm font-medium">Issues</span>
        {/* Its controls are pressed, not moved with. */}
        <div className="flex min-w-0" onPointerDown={(event) => event.stopPropagation()}>
          <ProjectFilter value={filter} onChange={setFilter} />
        </div>
        <div className="flex-1" />
        <div className="flex items-center" onPointerDown={(event) => event.stopPropagation()}>
          <HeaderButton
            label="Open the issue list"
            onClick={() => showIssueList()}
            testId="issue-window-list"
          >
            <SquareArrowOutUpRightIcon />
          </HeaderButton>
          <HeaderButton label="Minimize" onClick={close} testId="issue-window-minimize">
            <MinusIcon />
          </HeaderButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
            <span>No open issues</span>
            <span className="text-xs">Note one below, then drag it onto a running agent.</span>
          </div>
        ) : (
          <ul>
            {shown.map((issue) => (
              <IssueWindowRow
                key={issue.id}
                issue={issue}
                now={now}
                project={issue.projectId === null ? null : (names.get(issue.projectId) ?? null)}
              />
            ))}
          </ul>
        )}
      </div>
      <IssueNote onEscape={close} />
    </section>
  )
}

/** The window, closed: a button with how many issues are open, which opens it and moves it. */
function ClosedWindow({ style, draggable }: { style: CSSProperties; draggable: Draggable }) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging: dragging } = draggable
  const setOpen = useAppStore((state) => state.setIssueWindowOpen)
  const count = useOpenIssues().length
  return (
    <button
      ref={(node) => {
        setNodeRef(node)
        setActivatorNodeRef(node)
      }}
      type="button"
      style={style}
      {...listeners}
      onClick={() => {
        focusNoteOnOpen = true
        setOpen(true)
      }}
      aria-label={`Issues, ${count} open`}
      className={cn(
        'fixed z-40 flex h-8 cursor-default items-center gap-1.5 rounded-full bg-background pr-3 pl-2.5 text-sm font-medium shadow-lg ring-1 ring-foreground/10 select-none [app-region:no-drag] hover:bg-accent',
        dragging && 'shadow-xl',
      )}
      data-testid="issue-window-button"
    >
      <CircleDotIcon className="size-4" />
      Issues
      <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
    </button>
  )
}

/** The window as what is moved, open or closed: one draggable whose node changes. */
function IssueWindowBody() {
  const open = useAppStore((state) => state.issueWindowOpen)
  const position = useAppStore((state) => state.issueWindowPosition)
  const draggable = useDraggable({ id: 'issue-window' })
  const style = { ...placement(position), transform: CSS.Translate.toString(draggable.transform) }
  return open ? (
    <OpenWindow style={style} draggable={draggable} />
  ) : (
    <ClosedWindow style={style} draggable={draggable} />
  )
}

/**
 * The Issues window, which floats over every page but the settings, at the
 * bottom right until it is moved, and keeps to its corner of the window as
 * the window is resized. Closed, it is a button with how many issues are
 * open. Open, it lists the open issues, of a project or of all, to show or
 * to drag onto a running agent, and notes new ones. Moved by its button or
 * its title row, it stays where it is let go of, also when Hoot is opened
 * again, as it stays open or closed.
 */
export function IssueWindow() {
  const setPosition = useAppStore((state) => state.setIssueWindowPosition)
  // A press that moves the pointer less than 4px is a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const onDragEnd = ({ active }: DragEndEvent) => {
    const rect = active.rect.current.translated
    if (rect) setPosition(issueWindowPositionOf(rect, window.innerWidth, window.innerHeight))
  }
  return (
    <DndContext
      sensors={sensors}
      modifiers={[keepInWindow]}
      autoScroll={false}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: () => 'Moving the Issues window.',
          onDragOver: () => undefined,
          onDragMove: () => undefined,
          onDragEnd: () => 'Moved the Issues window.',
          onDragCancel: () => 'The Issues window stays where it was.',
        },
      }}
    >
      <IssueWindowBody />
    </DndContext>
  )
}
