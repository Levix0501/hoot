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
import { PlusIcon, XIcon } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { ToolId } from '../../shared/tools'
import { sessionState, type SessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import {
  focusAfterOverlay,
  projectWorktreeRows,
  shownSessionName,
  useAppStore,
  type AppState,
  type UiSession,
} from '../store/app-store'
import { inTabOrder, tabKey, tabStrip } from '../store/session-order'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { dropdownMenuParts } from './menu-parts'
import { NewWorktreeSessionButton } from './new-worktree-session-button'
import { ChatMenu, SavedSessionMenu, SessionMenu } from './session-menus'
import { StateLight } from './state-light'
import { ToolIcon } from './tool-icon'
import { Button } from './ui/button'
import { ContextMenu, ContextMenuTrigger } from './ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'

/**
 * The corners of a tab and of the `+`: a quarter rounder than `rounded-lg`,
 * and drawn as superellipses, which meet the sides more smoothly than arcs.
 */
export const CORNERS = 'rounded-[12.5px] [corner-shape:superellipse(1.5)]'

/**
 * A tab, on the main area's background so that it hides what it passes over
 * while dragged; the file panel's tabs look the same.
 */
export const TAB = `group/tab relative flex h-7 w-full min-w-0 items-center bg-background px-2 ${CORNERS}`

/**
 * A tab's icon, name and light, in a row, which a file's tab ends early to
 * leave room for its close button when it shows; the name is 13px, with the
 * line height of `text-sm`.
 */
export const LABEL =
  'relative flex min-w-0 flex-1 items-center gap-2 text-[13px]/[calc(1.25/0.875)]'

/**
 * The keys of the tabs of a row (see `tabStrip`), in their order: one for
 * each session open there, starting, running, or ended while its page stays.
 */
function stripTabs(state: Pick<AppState, 'sessions' | 'tabOrders'>, strip: string): string[] {
  return inTabOrder(
    state.sessions.filter((session) => tabStrip(session) === strip),
    tabKey,
    state.tabOrders[strip] ?? [],
  ).map(tabKey)
}

/**
 * What a tab stands for, as the store has it: its session, and the name it
 * shows, the one of the session's saved session or chat, which keeps the
 * last title its agent set when the agent clears the terminal title, or else
 * the session's.
 */
function useTab(key: string): { session: UiSession | undefined; name: string } {
  const session = useAppStore((state) =>
    state.sessions.find((candidate) => tabKey(candidate) === key),
  )
  const name = useAppStore((state) =>
    session === undefined ? '' : shownSessionName(state, session),
  )
  return { session, name }
}

/** The shade of the current tab and of the tab being dragged, and of another under the pointer. */
export function TabShade({ shaded }: { shaded: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0',
        CORNERS,
        shaded ? 'bg-secondary' : 'group-hover/tab:bg-secondary',
      )}
    />
  )
}

/**
 * A tab's agent icon, its name, which fades out where it is cut off, and the
 * light of its session's state. With `closable`, the light gives way to the
 * tab's close button, which shows in its place, while the pointer is on the
 * tab or the keyboard focus in it.
 */
function TabLabel({
  toolId,
  name,
  state,
  closable = false,
}: {
  toolId: ToolId
  name: string
  state: SessionState
  closable?: boolean
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
      {/*
        2px from the name rather than the row's 8px gap, leaving the name more
        room. It keeps its room while the close button shows over it, so that
        the name stays as it is.
      */}
      <StateLight
        state={state}
        className={cn(
          '-ms-1.5',
          closable && 'group-hover/tab:invisible group-has-focus-visible/tab:invisible',
        )}
        testId="session-tab-light"
      />
    </>
  )
}

/**
 * A tab of a row, by its key. Pressing it shows its session, with the
 * keyboard focus left out of the tab so that the session's terminal takes
 * it; moving the pointer 6px while pressing drags the tab instead. Its close
 * button shows in the place of its light while the pointer is on it, also on
 * the current tab, and closes its session, as a middle click does too; the
 * saved session or chat the session continues stays in the sidebar. A double
 * click renames it. Its context menu is the one of its session's row in the
 * sidebar. When `separated`, a thin line sets it off from the next tab.
 */
function SessionTab({ id, shown, separated }: { id: string; shown: string; separated: boolean }) {
  const { session, name } = useTab(id)
  const selectSession = useAppStore((state) => state.selectSession)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  const startRenaming = useAppStore((state) => state.startRenaming)
  const startRenamingSavedSession = useAppStore((state) => state.startRenamingSavedSession)
  const startRenamingChat = useAppStore((state) => state.startRenamingChat)
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id })
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const current = session?.id === shown

  // When the tabs do not fit, the current one scrolls into view.
  useEffect(() => {
    if (current) nodeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  if (session === undefined) return null
  // A saved session or a chat is renamed as its row in the sidebar renames it.
  const rename = () => {
    if (session.savedSessionId !== null) startRenamingSavedSession(session.savedSessionId)
    else if (session.chatId !== null) startRenamingChat(session.chatId)
    else startRenaming(session.id)
  }
  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        nodeRef.current = node
      }}
      // The tabs are 160px wide each, and narrow alike, down to 90px, when the
      // row is too short for them. While a tab is dragged, the one following
      // the pointer stands for it.
      className={cn(
        'relative flex w-40 min-w-[90px] items-center pe-1 [app-region:no-drag]',
        isDragging && 'opacity-0',
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-testid="session-tab"
      data-tab-key={id}
      data-session-id={session.id}
      data-current={current}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(TAB, session.closing && 'opacity-60')}
          {...listeners}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault()
            if (event.button !== 0) return
            event.preventDefault()
            selectSession(session.id)
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return
            event.preventDefault()
            requestCloseSession(session.id)
          }}
          onDoubleClick={rename}
        >
          <TabShade shaded={current} />
          <div
            role="tab"
            aria-selected={current}
            className={cn(LABEL, current ? 'text-foreground' : 'text-foreground/70')}
          >
            <TabLabel toolId={session.toolId} name={name} state={sessionState(session)} closable />
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            // Centered where the light is, it shows and hides at once, as the
            // light does: fading, the two would show at the same time for a
            // moment. Under the pointer, it takes the accent, out to its
            // edges, and keeps its color.
            className="pointer-events-none absolute inset-y-0 end-1 my-auto size-5 rounded-[10px] bg-clip-border text-foreground opacity-0 transition-none [corner-shape:superellipse(1.5)] group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 hover:bg-accent focus-visible:pointer-events-auto focus-visible:opacity-100 dark:hover:bg-accent"
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
            {/*
              A 7.3px cross of 0.93px strokes: 1.77 of its 24 units at this
              size. Its strokes are drawn in the text's color and then dimmed
              to half as a whole, so that they do not add up where they cross.
            */}
            <XIcon className="size-[12.67px] opacity-50" strokeWidth={1.77} />
          </Button>
        </ContextMenuTrigger>
        {session.savedSessionId !== null ? (
          <SavedSessionMenu savedId={session.savedSessionId} testId="session-tab-context" />
        ) : session.chatId !== null ? (
          <ChatMenu chatId={session.chatId} testId="session-tab-context" />
        ) : (
          <SessionMenu session={session} testId="session-tab-context" />
        )}
      </ContextMenu>
      <div
        aria-hidden
        className={cn(
          'absolute end-0 h-3 w-px bg-border transition-opacity duration-150',
          separated ? 'opacity-100' : 'opacity-0',
        )}
        data-testid="session-tab-separator"
      />
    </div>
  )
}

/** The copy of a tab that follows the pointer while the tab is dragged, shaded. */
function DraggedTab({ id, shown }: { id: string; shown: string }) {
  const { session, name } = useTab(id)
  if (session === undefined) return null
  return (
    <div className="flex h-full items-center pe-1" data-testid="session-tab-dragged">
      <div className={TAB}>
        <TabShade shaded />
        <div className={cn(LABEL, session.id === shown ? 'text-foreground' : 'text-foreground/70')}>
          <TabLabel toolId={session.toolId} name={name} state={sessionState(session)} />
        </div>
      </div>
    </div>
  )
}

/**
 * The `+` after the tabs, which opens its menu; a menu's trigger renders it,
 * with its props merged in.
 */
function NewTabButton({
  label,
  testId,
  ...props
}: ComponentProps<typeof Button> & { label: string; testId: string }) {
  return (
    <Button
      {...props}
      variant="ghost"
      size="icon-sm"
      // Its shade, out to its edges, comes and goes at once, as a tab's
      // does: the accent under the pointer, which leaves its icon's color
      // alone, and the current tab's shade while its menu is open.
      className={`${CORNERS} bg-clip-border text-foreground transition-none [app-region:no-drag] hover:bg-accent aria-expanded:bg-secondary dark:hover:bg-accent dark:aria-expanded:bg-secondary`}
      aria-label={label}
      data-testid={testId}
    />
  )
}

/**
 * The icon of the `+` after the tabs: an 11px plus of 1.05px strokes, 1.48 of
 * its 24 units at this size, dimmed to half as a whole like the close
 * buttons' cross, and at full strength while its menu is open.
 */
function NewTabIcon() {
  return (
    <PlusIcon
      className="size-[17px] opacity-50 group-aria-expanded/button:opacity-100"
      strokeWidth={1.48}
    />
  )
}

/**
 * The `+` after the chats' tabs, drawn as `render` with `children` in it:
 * its menu lists the agents a chat can start with, as the right-click menu
 * of the Chats title does, and one of them starts a new chat.
 */
function NewChatButton({ render, children }: { render: ReactElement; children: ReactNode }) {
  const newChat = useAppStore((state) => state.newChat)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={render}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <ChatAgentMenuEntries
          components={dropdownMenuParts}
          onSelect={(toolId) => void newChat(toolId)}
          testId="session-tabs-chat-agent"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The row of tabs of a session, for the main area's top row: the tabs of the
 * sessions open in its worktree or its project's own folder, or for a chat,
 * those of the chats open; in the order its sessions switch in, which
 * dragging a tab changes. The session shown has the current tab. A saved
 * session or chat that is not open has no tab: clicking its row in the
 * sidebar opens it again, with its tab last. A thin line sets off two tabs
 * next to each other when neither is the current one. Right after the last
 * tab comes a `+`: for a worktree or the project's folder, unless it is
 * missing, one that starts another session there, or opens the system's
 * terminal there, as the `+` on its row in the sidebar does; for a chat, one
 * that starts a new chat with the agent picked from its menu. While the tabs
 * do not fit, they scroll, and the `+` stays at the end of the row. The tabs
 * fade out toward an end of the row while more of them lie beyond it.
 */
export function SessionTabs({ session }: { session: UiSession }) {
  const { projectRoot, worktreePath } = session
  const chat = session.chatId !== null
  const strip = tabStrip(session)
  const keys = useAppStore(useShallow((state) => stripTabs(state, strip)))
  const currentKey = tabKey(session)
  const listRef = useRef<HTMLDivElement>(null)
  const missing = useAppStore((state) =>
    chat
      ? false
      : worktreePath === null
        ? state.projectFolders[projectRoot]?.missing === true
        : (projectWorktreeRows(state, projectRoot).find((row) => row.path === worktreePath)
            ?.missing ?? true),
  )
  const reorderTabs = useAppStore((state) => state.reorderTabs)
  const [dragged, setDragged] = useState<string | null>(null)
  // A press that moves the pointer less than 6px is a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // Whether more tabs lie beyond the start of the row and beyond its end, kept
  // on the row as `data-more-before` and `data-more-after` as it scrolls, as
  // it and its tabs change width, and as tabs come and go.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) return
    const update = () => {
      list.toggleAttribute('data-more-before', list.scrollLeft > 0.5)
      list.toggleAttribute(
        'data-more-after',
        list.scrollLeft + list.clientWidth < list.scrollWidth - 0.5,
      )
    }
    const resizes = new ResizeObserver(update)
    const observeTabs = () => {
      resizes.disconnect()
      resizes.observe(list)
      for (const tab of list.children) resizes.observe(tab)
    }
    observeTabs()
    const changes = new MutationObserver(observeTabs)
    changes.observe(list, { childList: true })
    list.addEventListener('scroll', update, { passive: true })
    return () => {
      resizes.disconnect()
      changes.disconnect()
      list.removeEventListener('scroll', update)
    }
  }, [])

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    if (over === null || active.id === over.id) return
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from !== -1 && to !== -1) reorderTabs(strip, arrayMove(keys, from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setDragged(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragged(null)}
    >
      <div className="flex h-full min-w-0 flex-1 items-center pe-2">
        <div className="relative flex h-full min-w-0 items-center">
          <SortableContext items={keys} strategy={horizontalListSortingStrategy}>
            <div
              ref={listRef}
              role="tablist"
              aria-label="Sessions"
              className="peer/tabs flex h-full min-w-0 scroll-px-1 items-center gap-[3px] overflow-x-auto select-none [scrollbar-width:none]"
              data-testid="session-tabs"
            >
              {keys.map((key, index) => (
                <SessionTab
                  key={key}
                  id={key}
                  shown={session.id}
                  separated={
                    index < keys.length - 1 && key !== currentKey && keys[index + 1] !== currentKey
                  }
                />
              ))}
            </div>
          </SortableContext>
          {/*
            The fades stay out of the area that drags the window. app-region
            is inherited, so they would take the top row's `drag` and, coming
            after the tabs, give it back to the ends of the first and the last
            tab: the last tab's close button would neither light up nor take a
            click. `initial` leaves them out, where `none` means `no-drag`.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 start-0 z-10 w-10 bg-linear-to-l from-transparent to-background opacity-0 transition-opacity duration-150 [app-region:initial] peer-data-more-before/tabs:opacity-100"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 end-0 z-10 w-10 bg-linear-to-r from-transparent to-background opacity-0 transition-opacity duration-150 [app-region:initial] peer-data-more-after/tabs:opacity-100"
          />
        </div>
        {!missing && (
          <div className="flex shrink-0 items-center">
            {chat ? (
              <NewChatButton
                render={<NewTabButton label="New Chat" testId="session-tabs-new-chat" />}
              >
                <NewTabIcon />
              </NewChatButton>
            ) : (
              <NewWorktreeSessionButton
                projectRoot={projectRoot}
                worktreePath={worktreePath}
                testId="session-tabs-agent"
                render={<NewTabButton label="New Session" testId="session-tabs-new-session" />}
              >
                <NewTabIcon />
              </NewWorktreeSessionButton>
            )}
          </div>
        )}
      </div>
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
