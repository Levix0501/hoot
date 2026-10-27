import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { XIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { chatName } from '../../shared/chats'
import { sessionName } from '../../shared/session'
import { sessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { useAppStore, type AppState, type UiSession } from '../store/app-store'
import { StateLight } from './state-light'
import { ToolIcon } from './tool-icon'
import { Button } from './ui/button'

/** A tab, on the main area's background so that it hides what it passes over while dragged. */
const TAB = 'group/tab relative flex h-7 w-full min-w-0 items-center rounded-lg bg-background px-2'

/** A tab's icon, name and light, in a row that leaves room for its close button when it shows. */
const LABEL = 'relative flex min-w-0 flex-1 items-center gap-2 text-sm'

/** The ids of the sessions in a worktree, in the order of their tabs. */
function worktreeSessionIds(
  state: Pick<AppState, 'sessions'>,
  projectRoot: string,
  worktreePath: string | null,
): string[] {
  return state.sessions
    .filter(
      (session) =>
        session.chatId === null &&
        session.projectRoot === projectRoot &&
        session.worktreePath === worktreePath,
    )
    .map((session) => session.id)
}

/**
 * The name a session's tab shows, as its page would: the name of its saved
 * session, which keeps the last title its agent set when the agent clears
 * the terminal title, or else its own.
 */
function tabName(state: Pick<AppState, 'savedSessions'>, session: UiSession): string {
  const saved =
    session.savedSessionId === null
      ? undefined
      : state.savedSessions.find((candidate) => candidate.id === session.savedSessionId)
  return saved === undefined ? sessionName(session) : chatName(saved)
}

/** A session and the name its tab shows, as the store has them. */
function useTabSession(id: string): { session: UiSession | undefined; name: string } {
  const session = useAppStore((state) => state.sessions.find((candidate) => candidate.id === id))
  const name = useAppStore((state) => {
    const found = state.sessions.find((candidate) => candidate.id === id)
    return found === undefined ? '' : tabName(state, found)
  })
  return { session, name }
}

/** The shade of the current tab and of the tab being dragged, and of another under the pointer. */
function TabShade({ shaded }: { shaded: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 rounded-lg',
        shaded ? 'bg-secondary' : 'group-hover/tab:bg-secondary',
      )}
    />
  )
}

/** A tab's agent icon, its name, which fades out where it is cut off, and its session's light. */
function TabLabel({ session, name }: { session: UiSession; name: string }) {
  const nameRef = useRef<HTMLSpanElement>(null)

  // Whether the name is cut off. Its box is as wide as its text until the tab
  // cuts it off, so the box changes size whenever that may change.
  useLayoutEffect(() => {
    const element = nameRef.current
    if (element === null) return
    const observer = new ResizeObserver(() => {
      element.toggleAttribute('data-cut', element.scrollWidth > element.clientWidth)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <ToolIcon toolId={session.toolId} className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1">
        <span
          ref={nameRef}
          className="min-w-0 overflow-hidden whitespace-nowrap data-cut:[mask-image:linear-gradient(to_right,black_calc(100%-1.75rem),transparent)]"
          data-session-name=""
          data-testid="session-tab-name"
        >
          {name}
        </span>
      </span>
      <StateLight state={sessionState(session)} testId="session-tab-light" />
    </>
  )
}

/**
 * A session's tab. Pressing it shows the session, with the keyboard focus
 * left out of the tab so that the session's terminal takes it; moving the
 * pointer 6px while pressing drags it instead. Its close button shows on the
 * current tab, and on another while the pointer is over it; a middle click
 * closes the session too, and a double click renames it.
 */
function SessionTab({ id, current }: { id: string; current: boolean }) {
  const { session, name } = useTabSession(id)
  const selectSession = useAppStore((state) => state.selectSession)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  const startRenaming = useAppStore((state) => state.startRenaming)
  const startRenamingSavedSession = useAppStore((state) => state.startRenamingSavedSession)
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id })
  const nodeRef = useRef<HTMLDivElement | null>(null)

  // When the tabs do not fit, the current one scrolls into view.
  useEffect(() => {
    if (current) nodeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  if (session === undefined) return null
  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        nodeRef.current = node
      }}
      // The tabs share the row's width, between 90px and 160px each. While a
      // tab is dragged, the one following the pointer stands for it.
      className={cn(
        'flex max-w-40 min-w-[90px] shrink-0 grow basis-0 items-center pe-1 [app-region:no-drag]',
        isDragging && 'opacity-0',
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-testid="session-tab"
      data-session-id={id}
      data-current={current}
    >
      <div
        className={cn(TAB, session.closing && 'opacity-60')}
        {...listeners}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault()
          if (event.button !== 0) return
          event.preventDefault()
          selectSession(id)
        }}
        onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
          requestCloseSession(id)
        }}
        // A saved session is renamed as its row in the sidebar renames it.
        onDoubleClick={() => {
          if (session.savedSessionId === null) startRenaming(id)
          else startRenamingSavedSession(session.savedSessionId)
        }}
      >
        <TabShade shaded={current} />
        <div
          role="tab"
          aria-selected={current}
          className={cn(
            LABEL,
            current ? 'pe-5 text-foreground' : 'text-foreground/70 group-hover/tab:pe-5',
          )}
        >
          <TabLabel session={session} name={name} />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            'absolute inset-y-0 end-1 my-auto size-5 text-muted-foreground',
            !current &&
              'pointer-events-none opacity-0 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
          disabled={session.closing}
          // Pressing it neither shows nor drags the tab, and leaves the
          // keyboard focus where it is.
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => requestCloseSession(id)}
          aria-label="Close Session"
          data-testid="session-tab-close"
        >
          <XIcon />
        </Button>
      </div>
    </div>
  )
}

/** The copy of a tab that follows the pointer while the tab is dragged, shaded. */
function DraggedTab({ id, current }: { id: string; current: boolean }) {
  const { session, name } = useTabSession(id)
  if (session === undefined) return null
  return (
    <div className="flex h-full items-center pe-1" data-testid="session-tab-dragged">
      <div className={TAB}>
        <TabShade shaded />
        <div className={cn(LABEL, current ? 'text-foreground' : 'text-foreground/70')}>
          <TabLabel session={session} name={name} />
        </div>
      </div>
    </div>
  )
}

/**
 * The tabs of the sessions in a session's worktree, for the main area's top
 * row: one for each session, in the order the sessions switch in, which
 * dragging a tab changes. The session shown has the current tab.
 */
export function SessionTabs({ session }: { session: UiSession }) {
  const { projectRoot, worktreePath } = session
  const ids = useAppStore(
    useShallow((state) => worktreeSessionIds(state, projectRoot, worktreePath)),
  )
  const reorderSessions = useAppStore((state) => state.reorderSessions)
  const [dragged, setDragged] = useState<string | null>(null)
  // A press that moves the pointer less than 6px is a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    if (over === null || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from !== -1 && to !== -1) reorderSessions(arrayMove(ids, from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setDragged(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragged(null)}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <div
          role="tablist"
          aria-label="Sessions"
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pe-2 select-none [scrollbar-width:none]"
          data-testid="session-tabs"
        >
          {ids.map((id) => (
            <SessionTab key={id} id={id} current={id === session.id} />
          ))}
        </div>
      </SortableContext>
      {createPortal(
        <>
          {/*
            While a tab is dragged, the pointer shows a grab wherever it is,
            and no part of the window drags the window.
          */}
          {dragged !== null && (
            <div className="fixed inset-0 z-[998] cursor-grabbing [app-region:no-drag]" />
          )}
          <DragOverlay zIndex={999}>
            {dragged === null ? null : <DraggedTab id={dragged} current={dragged === session.id} />}
          </DragOverlay>
        </>,
        document.body,
      )}
    </DndContext>
  )
}
