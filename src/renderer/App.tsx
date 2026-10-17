import { cn } from 'cn'
import { useEffect } from 'react'
import { CloseSessionDialog } from './components/close-session-dialog'
import { DeleteWorktreeDialog } from './components/delete-worktree-dialog'
import { DeleteIssueDialog } from './components/issues/delete-issue-dialog'
import { DependentIssueDialogView } from './components/issues/dependent-issue-dialog'
import { IssuePickerDialog } from './components/issues/issue-picker-dialog'
import { NewIssueDialog } from './components/issues/new-issue-dialog'
import { MainArea } from './components/main-area'
import { NewWorktreeDialog } from './components/new-worktree-dialog'
import { ProjectSidebar } from './components/project-sidebar'
import { QuitDialog } from './components/quit-dialog'
import { SettingsView } from './components/settings/settings-view'
import { sidebarWidthStyle } from './components/sidebar-resize-handle'
import { SidebarInset, SidebarProvider } from './components/ui/sidebar'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { WindowNavigation } from './components/window-navigation'
import { sessionShortcut } from './lib/session-shortcuts'
import { useAppStore } from './store/app-store'
import { isSettingsPage } from './store/page-history'

/**
 * While the sidebar's edge is held, the pointer shows the resize cursor
 * wherever it is and no text is selected. Unlike the resizing below, this
 * lasts until the pointer is let go of, so the cursor keeps to the edge while
 * the sidebar slides out and back in, which the width does not follow.
 */
const SIDEBAR_EDGE_DRAGGING_CLASS =
  'data-edge-dragging:select-none data-edge-dragging:**:cursor-col-resize!'

/**
 * While the width follows the pointer, the sidebar and the space it takes
 * beside the main area take each width at once instead of sliding to it.
 */
const SIDEBAR_RESIZING_CLASS =
  'data-resizing:**:data-[slot=sidebar-container]:transition-none data-resizing:**:data-[slot=sidebar-gap]:transition-none'

/**
 * Handles the session shortcuts (⌘1–⌘9, ⌘⇧], ⌘⇧[, ⌘[, ⌘] and ⌘W) and ⌘, for
 * the settings wherever the keyboard focus is in the window, terminals and
 * text fields included. The window receives these key presses before the
 * application menu does; handling them here keeps them from reaching the
 * menu, a text field, or the terminal and its program.
 */
function useSessionShortcuts(): void {
  const runShortcut = useAppStore((state) => state.runShortcut)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = sessionShortcut(event)
      if (!shortcut) return
      event.preventDefault()
      event.stopPropagation()
      runShortcut(shortcut)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [runShortcut])
}

export function App() {
  const initialize = useAppStore((state) => state.initialize)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const sidebarResizing = useAppStore((state) => state.sidebarResizing)
  const sidebarEdgeDragging = useAppStore((state) => state.sidebarEdgeDragging)
  const settingsShown = useAppStore((state) => isSettingsPage(state.currentPage))
  useEffect(() => {
    void initialize()
  }, [initialize])
  useSessionShortcuts()

  return (
    <TooltipProvider>
      {/*
        ⌘B, the sidebar's trigger and View > Hide Sidebar collapse and expand
        the sidebar, and dragging its edge resizes it. The settings take the
        place of the sidebar, the main area and the navigation, which come
        back as they were when the settings are left.
      */}
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        data-edge-dragging={sidebarEdgeDragging || undefined}
        data-resizing={sidebarResizing || undefined}
        className={cn('h-svh overflow-hidden', SIDEBAR_EDGE_DRAGGING_CLASS, SIDEBAR_RESIZING_CLASS)}
        style={{ '--sidebar-width': sidebarWidthStyle(sidebarWidth) } as React.CSSProperties}
      >
        {settingsShown ? (
          <SettingsView />
        ) : (
          <>
            <ProjectSidebar />
            <SidebarInset className="min-w-0 overflow-hidden">
              <MainArea />
            </SidebarInset>
            {/* Last, so that its buttons are cut out of the drag area of what lies under them. */}
            <WindowNavigation />
          </>
        )}
      </SidebarProvider>
      <CloseSessionDialog />
      <NewWorktreeDialog />
      <DeleteWorktreeDialog />
      <NewIssueDialog />
      <DeleteIssueDialog />
      <IssuePickerDialog />
      <DependentIssueDialogView />
      <QuitDialog />
      {/* Below the main area's top row, clear of its buttons and of the ended-session bar. */}
      <Toaster position="top-right" offset={{ top: 60, right: 16 }} />
    </TooltipProvider>
  )
}
