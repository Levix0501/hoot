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
import { ArrowUpRightIcon, ChevronDownIcon, CircleDotIcon, MinusIcon } from 'lucide-react'
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ISSUE_WINDOW_MARGIN,
  issueWindowPositionOf,
  type IssueWindowPosition,
} from '../../../shared/issue-window'
import {
  isIssueOpen,
  issueGroups,
  issueIdentifier,
  listOrder,
  type Issue,
  type IssueGroup,
} from '../../../shared/issues'
import { endIssueDrag, startIssueDrag } from '../../lib/issue-drag'
import { statusLabel } from '../../lib/issue-properties'
import { shortTimeAgo } from '../../lib/time'
import { cn } from '../../lib/utils'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { StatusIcon } from './issue-icons'
import { focusNoteOnShow, IssueNote } from './issue-note'
import { useNow } from './relative-time'

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
 * An issue in the window: its identifier, status, title and age. A click
 * shows the issue's page. Dragged onto the terminal of a running agent, it
 * pastes the issue into the agent's input, unsent.
 */
function IssueWindowRow({
  issue,
  identifierWidth,
  now,
}: {
  issue: Issue
  /** How wide the identifiers of the window are, in characters, so that they line up. */
  identifierWidth: number
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
        className="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
        data-testid="issue-window-row"
        data-issue-id={issue.id}
      >
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          style={{ width: `${identifierWidth}ch` }}
        >
          {issueIdentifier(issue.id)}
        </span>
        <StatusIcon status={issue.status} className="size-3.5" />
        <span className="min-w-0 flex-1 truncate text-[13px]" data-user-text="">
          {issue.title}
        </span>
        <time
          className="shrink-0 pl-1 text-xs text-muted-foreground tabular-nums"
          dateTime={new Date(issue.createdAt).toISOString()}
        >
          {shortTimeAgo(issue.createdAt, now)}
        </time>
      </button>
    </li>
  )
}

/**
 * The open issues of one status, under a header that stays at the top while
 * they scroll by.
 */
function IssueWindowGroup({
  group,
  identifierWidth,
  now,
}: {
  group: IssueGroup
  identifierWidth: number
  now: number
}) {
  const label = statusLabel(group.status)
  return (
    <div className="pb-1" data-testid="issue-window-group" data-status={group.status}>
      <div className="sticky top-0 z-10 bg-popover">
        <div className="flex h-7 items-center gap-2 rounded-md bg-muted/70 px-2 text-xs font-medium">
          <StatusIcon status={group.status} className="size-3.5" />
          <span>{label}</span>
          <span className="font-normal text-muted-foreground tabular-nums">
            {group.issues.length}
          </span>
        </div>
      </div>
      <ul className="pt-0.5" aria-label={label}>
        {group.issues.map((issue) => (
          <IssueWindowRow
            key={issue.id}
            issue={issue}
            identifierWidth={identifierWidth}
            now={now}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * The frame of the open window: a popover's colors and ring, round corners,
 * and as tall as what it lists, up to `openHeight`.
 */
const PANEL =
  'fixed z-40 flex w-[380px] flex-col overflow-hidden rounded-[20px] bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 duration-150 animate-in fade-in-0 zoom-in-95 [app-region:no-drag]'

/** The highest the open window grows: 580px, less in a small window or far from its corner. */
function openHeight(position: IssueWindowPosition): string {
  return `min(580px, 100vh - 96px, 100vh - ${position.y + ISSUE_WINDOW_MARGIN}px)`
}

/**
 * The window, open, growing from its corner: its title row, which moves
 * it, with the Project filter, a button that shows the issue list and one
 * that closes the window to its button; the open issues, grouped by status;
 * and the note.
 */
function OpenWindow({
  style,
  draggable,
  position,
}: {
  style: CSSProperties
  draggable: Draggable
  position: IssueWindowPosition
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging: moving } = draggable
  const setOpen = useAppStore((state) => state.setIssueWindowOpen)
  const showIssueList = useAppStore((state) => state.showIssueList)
  const issues = useOpenIssues()
  const now = useNow()
  const [filter, setFilter] = useState<ProjectFilterValue>('all')
  const shown = useMemo(
    () => (filter === 'all' ? issues : issues.filter((issue) => issue.projectId === filter)),
    [issues, filter],
  )
  const groups = useMemo(() => issueGroups(shown, 'all'), [shown])
  const identifierWidth = useMemo(
    () => Math.max(0, ...shown.map((issue) => issueIdentifier(issue.id).length)),
    [shown],
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
      style={{
        ...style,
        maxHeight: openHeight(position),
        transformOrigin: `${position.edge} ${position.side}`,
      }}
      aria-label="Issues"
      className={cn(PANEL, moving && 'shadow-2xl')}
      // Esc from anywhere in it but the note, which says so itself (see `IssueNote`), and its
      // menus, which Esc closes.
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing)
          return
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        event.preventDefault()
        close()
      }}
      data-testid="issue-window"
    >
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        className={cn(
          'flex h-10 shrink-0 cursor-grab items-center gap-1 px-1.5 select-none',
          moving && 'cursor-grabbing',
        )}
        data-testid="issue-window-header"
      >
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
            <ArrowUpRightIcon />
          </HeaderButton>
          <HeaderButton label="Minimize" onClick={close} testId="issue-window-minimize">
            <MinusIcon />
          </HeaderButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1" data-testid="issue-window-issues">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center text-[13px] text-muted-foreground">
            <span>No open issues</span>
            <span className="text-xs">Note one below, then drag it onto a running agent.</span>
          </div>
        ) : (
          groups.map((group) => (
            <IssueWindowGroup
              key={group.status}
              group={group}
              identifierWidth={identifierWidth}
              now={now}
            />
          ))
        )}
      </div>
      <IssueNote onEscape={close} />
    </section>
  )
}

/** The window, closed: a button with how many issues are open, which opens it and moves it. */
function ClosedWindow({ style, draggable }: { style: CSSProperties; draggable: Draggable }) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging: moving } = draggable
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
        focusNoteOnShow()
        setOpen(true)
      }}
      aria-label={`Issues, ${count} open`}
      className={cn(
        'fixed z-40 flex h-8 cursor-default items-center gap-1.5 rounded-lg bg-popover pr-2.5 pl-2 text-[13px] font-medium shadow-md ring-1 ring-foreground/10 select-none [app-region:no-drag] hover:[background-image:linear-gradient(var(--accent),var(--accent))]',
        moving && 'shadow-xl',
      )}
      data-testid="issue-window-button"
    >
      <CircleDotIcon className="size-4 text-muted-foreground" />
      <span className="tabular-nums">{count}</span>
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
    <OpenWindow style={style} draggable={draggable} position={position} />
  ) : (
    <ClosedWindow style={style} draggable={draggable} />
  )
}

/**
 * The Issues window, which floats over every page but the settings, at the
 * bottom right until it is moved, and keeps to its corner of the window as
 * the window is resized. Closed, it is a button with how many issues are
 * open. Open, it lists the open issues, of a project or of all, grouped by
 * status, to show or to drag onto a running agent,
 * and notes new ones. Moved by its button or its title row, it stays where
 * it is let go of, also when Hoot is opened again, as it stays open or closed.
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
