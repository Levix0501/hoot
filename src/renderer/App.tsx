import { useEffect } from 'react'
import { CloseSessionDialog } from './components/close-session-dialog'
import { ProjectSidebar } from './components/project-sidebar'
import { QuitDialog } from './components/quit-dialog'
import { SessionArea } from './components/session-area'
import { SidebarInset, SidebarProvider } from './components/ui/sidebar'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { sessionShortcut } from './lib/session-shortcuts'
import { useAppStore } from './store/app-store'

/**
 * Handles the session shortcuts (⌘1–⌘9, ⌘⇧], ⌘⇧[ and ⌘W) wherever the
 * keyboard focus is in the window, terminals included. The window receives
 * these key presses before the application menu does; handling them here
 * keeps them from reaching the menu, or the terminal and its program.
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

function keepSidebarOpen(): void {}

export function App() {
  const initialize = useAppStore((state) => state.initialize)
  useEffect(() => {
    void initialize()
  }, [initialize])
  useSessionShortcuts()

  return (
    <TooltipProvider>
      {/* The sidebar stays open: ⌘B and Ctrl+B do not collapse it. */}
      <SidebarProvider
        open
        onOpenChange={keepSidebarOpen}
        className="h-svh overflow-hidden"
        style={{ '--sidebar-width': '18rem' } as React.CSSProperties}
      >
        <ProjectSidebar />
        {/* The session card. */}
        <SidebarInset className="min-w-0 overflow-hidden">
          <SessionArea />
        </SidebarInset>
      </SidebarProvider>
      <CloseSessionDialog />
      <QuitDialog />
      {/* Below the session header, clear of its buttons and of the ended-session bar. */}
      <Toaster position="top-right" offset={{ top: 60, right: 16 }} />
    </TooltipProvider>
  )
}
