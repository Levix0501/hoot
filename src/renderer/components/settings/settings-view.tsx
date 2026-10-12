import { ArrowLeftIcon, SunMoonIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useAppStore } from '../../store/app-store'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar'
import { AppearancePage } from './appearance-page'

/** Whether the keyboard focus is where text is typed, where Esc is the field's. */
function focusInField(): boolean {
  const focused = document.activeElement
  return (
    focused instanceof HTMLElement &&
    (focused.isContentEditable || focused.matches('input, textarea, select'))
  )
}

/** Whether a dialog, such as the one asking whether to quit, or a menu is open in the window. */
function overlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null
}

/** Esc leaves the settings as going back does, unless a field or a dialog has a use for it. */
function useEscapeLeavesSettings(): void {
  const leaveSettings = useAppStore((state) => state.leaveSettings)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (focusInField() || overlayOpen()) return
      event.preventDefault()
      leaveSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [leaveSettings])
}

/** The list of the settings' pages, in the sidebar's place and as wide. */
function SettingsNavigation() {
  const leaveSettings = useAppStore((state) => state.leaveSettings)
  return (
    <Sidebar
      collapsible="none"
      aria-label="Settings"
      className="border-r"
      data-testid="settings-navigation"
    >
      {/*
        Its part of the window's top row, which drags the window. The traffic
        lights and the navigation sit on it. It reaches over the right border,
        so that the line drags the window too.
      */}
      <SidebarHeader className="-mr-px h-11 shrink-0 [app-region:drag]" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={leaveSettings} data-testid="settings-back-to-app">
                <ArrowLeftIcon />
                <span>Back to app</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive aria-current="page" data-testid="settings-appearance">
                <SunMoonIcon />
                <span>Appearance</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

/**
 * What the window shows in place of the sidebar and the main area while the
 * settings are the current page: the list of their pages, and the
 * Appearance page.
 */
export function SettingsView() {
  useEscapeLeavesSettings()
  return (
    <>
      <SettingsNavigation />
      <AppearancePage />
    </>
  )
}
