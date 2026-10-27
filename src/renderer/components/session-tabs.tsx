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
import { chatName, type SavedSessionInfo } from '../../shared/chats'
import { sessionName } from '../../shared/session'
import type { ToolId } from '../../shared/tools'
import { sessionState, type SessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { useAppStore, type AppState, type UiSession } from '../store/app-store'
import { inTabOrder, tabKey } from '../store/session-order'
import { StateLight } from './state-light'
import { ToolIcon } from './tool-icon'
import { Button } from './ui/button'

/** A tab, on the main area's background so that it hides what it passes over while dragged. */
const TAB = 'group/tab relative flex h-7 w-full min-w-0 items-center rounded-lg bg-background px-2'

/** A tab's icon, name and light, in a row that leaves room for its close button when it shows. */
const LABEL = 'relative flex min-w-0 flex-1 items-center gap-2 text-sm'

/**
 * The keys of a worktree's tabs (see `tabKey`), in their order: one for each
 * of its saved sessions, whether its agent runs or not, and one for each
 * other session started in it, such as an issue's.
 */
function worktreeTabs(
  state: Pick<AppState, 'sessions' | 'savedSessions' | 'tabOrders'>,
  projectRoot: string,
  worktreePath: string | null,
): string[] {
  // When each tab's saved session or session was made, by its key.
  const made = new Map<string, number>()
  for (const saved of state.savedSessions) {
    if (saved.projectRoot === projectRoot && saved.worktreePath === worktreePath) {
      made.set(saved.id, saved.createdAt)
    }
  }
  for (const session of state.sessions) {
    if (
      session.chatId === null &&
      session.projectRoot === projectRoot &&
      session.worktreePath === worktreePath &&
      !made.has(tabKey(session))
    ) {
      made.set(tabKey(session), session.createdAt)
    }
  }
  return inTabOrder(
    [...made].map(([key, createdAt]) => ({ key, createdAt })),
    (tab) => tab.key,
    state.tabOrders[worktreePath ?? projectRoot] ?? [],
  ).map((tab) => tab.key)
}

/**
 * What a tab stands for, as the store has it: the session it shows, once one
 * was started, and the saved session that session continues, if any. The tab
 * shows the agent's icon, the name of the saved session, which keeps the
 * last title its agent set when the agent clears the terminal title, or else
 * the session's, and the light of the session's state while there is one.
 */
function useTab(key: string): {
  session: UiSession | undefined
  saved: SavedSessionInfo | undefined
  toolId: ToolId | undefined
  name: string
  state: SessionState | null
} {
  const session = useAppStore((state) =>
    state.sessions.find((candidate) => tabKey(candidate) === key),
  )
  const saved = useAppStore((state) =>
    state.savedSessions.find((candidate) => candidate.id === key),
  )
  return {
    session,
    saved,
    toolId: session?.toolId ?? saved?.toolId,
    name: saved !== undefined ? chatName(saved) : session !== undefined ? sessionName(session) : '',
    state: session === undefined ? null : sessionState(session),
  }
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

/**
 * A tab's agent icon, its name, which fades out where it is cut off, and the
 * light of its session's state, if it has a session.
 */
function TabLabel({
  toolId,
  name,
  state,
}: {
  toolId: ToolId
  name: string
  state: SessionState | null
}) {
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
      <ToolIcon toolId={toolId} className="size-4 shrink-0" />
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
      {state !== null && <StateLight state={state} testId="session-tab-light" />}
    </>
  )
}

/**
 * A tab of a worktree, by its key. Pressing the tab of a session shows the
 * session, with the keyboard focus left out of the tab so that the session's
 * terminal takes it; clicking the tab of a saved session whose agent does
 * not run starts the agent, continuing its conversation, as its row in the
 * sidebar does. Moving the pointer 6px while pressing drags the tab instead.
 * A session's close button shows on the current tab, and on another while
 * the pointer is over it; a middle click closes the session too. A double
 * click renames it.
 */
function SessionTab({ id, shown }: { id: string; shown: string }) {
  const { session, saved, toolId, name, state: light } = useTab(id)
  const selectSession = useAppStore((state) => state.selectSession)
  const openSavedSession = useAppStore((state) => state.openSavedSession)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  const startRenaming = useAppStore((state) => state.startRenaming)
  const startRenamingSavedSession = useAppStore((state) => state.startRenamingSavedSession)
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id })
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const current = session?.id === shown

  // When the tabs do not fit, the current one scrolls into view.
  useEffect(() => {
    if (current) nodeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  if (toolId === undefined) return null
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
      data-tab-key={id}
      data-session-id={session?.id}
      data-current={current}
    >
      <div
        className={cn(TAB, session?.closing === true && 'opacity-60')}
        {...listeners}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault()
          if (event.button !== 0) return
          event.preventDefault()
          if (session !== undefined) selectSession(session.id)
        }}
        // On a click rather than a press, which may begin a drag instead.
        onClick={() => {
          if (session === undefined && saved !== undefined) openSavedSession(saved.id)
        }}
        onAuxClick={(event) => {
          if (event.button !== 1 || session === undefined) return
          event.preventDefault()
          requestCloseSession(session.id)
        }}
        // A saved session is renamed as its row in the sidebar renames it.
        onDoubleClick={() => {
          if (saved !== undefined) startRenamingSavedSession(saved.id)
          else if (session !== undefined) startRenaming(session.id)
        }}
      >
        <TabShade shaded={current} />
        <div
          role="tab"
          aria-selected={current}
          className={cn(
            LABEL,
            current ? 'pe-5 text-foreground' : 'text-foreground/70',
            !current && session !== undefined && 'group-hover/tab:pe-5',
          )}
        >
          <TabLabel toolId={toolId} name={name} state={light} />
        </div>
        {session !== undefined && (
          <Button
            variant="ghost"
            size="icon-xs"
            // It shows and hides at once, as the light moves aside for it at
            // once: fading out, it would stay over the light for a moment.
            className={cn(
              'absolute inset-y-0 end-1 my-auto size-5 text-muted-foreground transition-none',
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
            onClick={() => requestCloseSession(session.id)}
            aria-label="Close Session"
            data-testid="session-tab-close"
          >
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

/** The copy of a tab that follows the pointer while the tab is dragged, shaded. */
function DraggedTab({ id, shown }: { id: string; shown: string }) {
  const { session, toolId, name, state } = useTab(id)
  if (toolId === undefined) return null
  return (
    <div className="flex h-full items-center pe-1" data-testid="session-tab-dragged">
      <div className={TAB}>
        <TabShade shaded />
        <div
          className={cn(LABEL, session?.id === shown ? 'text-foreground' : 'text-foreground/70')}
        >
          <TabLabel toolId={toolId} name={name} state={state} />
        </div>
      </div>
    </div>
  )
}

/**
 * The tabs of a session's worktree, for the main area's top row: one for each
 * of its saved sessions, whether its agent runs or not, and one for each
 * other session started in it; in the order its sessions switch in, which
 * dragging a tab changes. The session shown has the current tab. The tab of
 * a saved session whose agent does not run has no light, as its row in the
 * sidebar has none, and its agent starts only once the tab is clicked.
 */
export function SessionTabs({ session }: { session: UiSession }) {
  const { projectRoot, worktreePath } = session
  const keys = useAppStore(useShallow((state) => worktreeTabs(state, projectRoot, worktreePath)))
  const reorderTabs = useAppStore((state) => state.reorderTabs)
  const [dragged, setDragged] = useState<string | null>(null)
  // A press that moves the pointer less than 6px is a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    if (over === null || active.id === over.id) return
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from !== -1 && to !== -1) {
      reorderTabs(worktreePath ?? projectRoot, arrayMove(keys, from, to))
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setDragged(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragged(null)}
    >
      <SortableContext items={keys} strategy={horizontalListSortingStrategy}>
        <div
          role="tablist"
          aria-label="Sessions"
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pe-2 select-none [scrollbar-width:none]"
          data-testid="session-tabs"
        >
          {keys.map((key) => (
            <SessionTab key={key} id={key} shown={session.id} />
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
            {dragged === null ? null : <DraggedTab id={dragged} shown={session.id} />}
          </DragOverlay>
        </>,
        document.body,
      )}
    </DndContext>
  )
}
