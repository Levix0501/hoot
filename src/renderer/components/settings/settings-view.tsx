import { ArrowLeftIcon, BotIcon, InfoIcon, SunMoonIcon } from 'lucide-react'
import { useEffect, type ComponentType } from 'react'
import { api } from '../../lib/api'
import { useAppStore, type SettingsSection } from '../../store/app-store'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar'
import { AboutPage } from './about-page'
import { AgentsPage } from './agents-page'
import { AppearancePage } from './appearance-page'

/** The pages of the settings, in the order of their list: Agents on macOS only, About last. */
const SECTIONS: ReadonlyArray<{
  id: SettingsSection
  label: string
  icon: ComponentType
}> = [
  { id: 'appearance', label: 'Appearance', icon: SunMoonIcon },
  ...(api.manageAgents ? [{ id: 'agents' as const, label: 'Agents', icon: BotIcon }] : []),
  { id: 'about', label: 'About', icon: InfoIcon },
]

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
      // Handled, so that the page shown next leaves this Esc alone.
      event.preventDefault()
      leaveSettings()
    }
    // In the capture phase, so that an open tooltip, which closes on Esc and
    // stops the key from going any further, cannot keep the settings shown.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [leaveSettings])
}

/** The list of the settings' pages, in the sidebar's place and as wide. */
function SettingsNavigation() {
  const leaveSettings = useAppStore((state) => state.leaveSettings)
  const section = useAppStore((state) => state.settingsSection)
  const selectSection = useAppStore((state) => state.selectSettingsSection)
  return (
    <Sidebar
      collapsible="none"
      aria-label="Settings"
      className="border-r"
      data-testid="settings-navigation"
    >
      {/*
        Its part of the window's top row, which drags the window. The traffic
        lights sit on it. It reaches over the right border, so that the line
        drags the window too.
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
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton
                  isActive={id === section}
                  aria-current={id === section ? 'page' : undefined}
                  onClick={() => selectSection(id)}
                  data-testid={`settings-${id}`}
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

/**
 * What the window shows in place of the sidebar and the main area while the
 * settings are the current page: the list of their pages, and the page of
 * theirs shown last since Hoot started, Appearance at first.
 */
export function SettingsView() {
  useEscapeLeavesSettings()
  const section = useAppStore((state) => state.settingsSection)
  return (
    <>
      <SettingsNavigation />
      {section === 'about' ? (
        <AboutPage />
      ) : section === 'agents' && api.manageAgents ? (
        <AgentsPage />
      ) : (
        <AppearancePage />
      )}
    </>
  )
}
