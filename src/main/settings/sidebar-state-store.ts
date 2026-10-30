import { EventEmitter } from 'node:events'
import Conf from 'conf'
import { isSidebarGroup, type SidebarGroupId } from '../../shared/sidebar-groups'
import { sidebarWidthWithin } from '../../shared/sidebar-width'

interface StoredSettings {
  /** Whether the sidebar was collapsed when it was last shown or hidden. */
  sidebarCollapsed?: boolean
  /** The sidebar's width in CSS pixels, as it was last resized. */
  sidebarWidth?: number
  /** The groups collapsed in the sidebar, Projects or Chats; every other group is expanded. */
  collapsedGroups?: SidebarGroupId[]
  /** The ids of the projects collapsed in the sidebar; every other project is expanded. */
  collapsedProjects?: number[]
  /** The roots of the worktrees collapsed in the sidebar; every other worktree is expanded. */
  collapsedWorktrees?: string[]
  /**
   * The roots of the projects whose Local row is collapsed in the sidebar;
   * every other project's is expanded.
   */
  collapsedLocal?: string[]
}

function isProjectId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isWorktreeRoot(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Whether the sidebar is expanded, how wide it is, and which of its groups,
 * projects, worktrees and Local rows are collapsed, kept in `settings.json`
 * in the user data directory, next to the launch settings, so that Hoot opens
 * with the sidebar as it was left. Conf reads the file before every change
 * and writes all of it, so the settings do not overwrite each other.
 */
export class SidebarStateStore extends EventEmitter<{ changed: [open: boolean] }> {
  private readonly config: Conf<StoredSettings>
  private expanded: boolean
  private sidebarWidth: number
  private collapsedGroupIds: Set<SidebarGroupId>
  private collapsed: Set<number>
  private collapsedRoots: Set<string>
  private collapsedLocalRoots: Set<string>

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    // Expanded until the sidebar is collapsed for the first time.
    this.expanded = this.config.get('sidebarCollapsed') !== true
    // The default width until the sidebar is resized for the first time.
    this.sidebarWidth = sidebarWidthWithin(this.config.get('sidebarWidth'))
    // A group is expanded until it is collapsed for the first time.
    const storedGroups: unknown = this.config.get('collapsedGroups')
    this.collapsedGroupIds = new Set(
      Array.isArray(storedGroups) ? storedGroups.filter(isSidebarGroup) : [],
    )
    // So is a project.
    const stored: unknown = this.config.get('collapsedProjects')
    this.collapsed = new Set(Array.isArray(stored) ? stored.filter(isProjectId) : [])
    // So is a worktree.
    const storedRoots: unknown = this.config.get('collapsedWorktrees')
    this.collapsedRoots = new Set(
      Array.isArray(storedRoots) ? storedRoots.filter(isWorktreeRoot) : [],
    )
    // And a project's Local row.
    const storedLocal: unknown = this.config.get('collapsedLocal')
    this.collapsedLocalRoots = new Set(
      Array.isArray(storedLocal) ? storedLocal.filter(isWorktreeRoot) : [],
    )
  }

  get open(): boolean {
    return this.expanded
  }

  /** Records whether the sidebar is expanded and saves it. */
  setOpen(open: boolean): void {
    if (open === this.expanded) return
    this.expanded = open
    try {
      this.config.set('sidebarCollapsed', !open)
    } catch (error) {
      // The sidebar stays as it is until Hoot quits.
      console.error('Could not save the state of the sidebar:', error)
    }
    this.emit('changed', open)
  }

  /** The sidebar's width in CSS pixels. */
  get width(): number {
    return this.sidebarWidth
  }

  /** Records the sidebar's width, brought within its limits, and saves it. */
  setWidth(width: number): void {
    const within = sidebarWidthWithin(width)
    if (within === this.sidebarWidth) return
    this.sidebarWidth = within
    try {
      this.config.set('sidebarWidth', within)
    } catch (error) {
      // The sidebar keeps its width until Hoot quits.
      console.error('Could not save the width of the sidebar:', error)
    }
  }

  /** The groups collapsed in the sidebar. */
  get collapsedGroups(): SidebarGroupId[] {
    return [...this.collapsedGroupIds]
  }

  /** Records whether a group is collapsed in the sidebar and saves it. */
  setGroupCollapsed(group: SidebarGroupId, collapsed: boolean): void {
    if (this.collapsedGroupIds.has(group) === collapsed) return
    if (collapsed) this.collapsedGroupIds.add(group)
    else this.collapsedGroupIds.delete(group)
    try {
      this.config.set('collapsedGroups', [...this.collapsedGroupIds])
    } catch (error) {
      // The groups stay as they are until Hoot quits.
      console.error('Could not save which groups of the sidebar are collapsed:', error)
    }
  }

  /** The ids of the projects collapsed in the sidebar. */
  get collapsedProjects(): number[] {
    return [...this.collapsed]
  }

  /** Records whether a project is collapsed in the sidebar and saves it. */
  setProjectCollapsed(id: number, collapsed: boolean): void {
    if (this.collapsed.has(id) === collapsed) return
    if (collapsed) this.collapsed.add(id)
    else this.collapsed.delete(id)
    this.saveCollapsedProjects()
  }

  /**
   * Forgets whether the projects other than `ids`, the projects in the list,
   * were collapsed: a project added to the list, also one added again, is
   * expanded.
   */
  retainProjects(ids: Iterable<number>): void {
    const listed = new Set(ids)
    const kept = [...this.collapsed].filter((id) => listed.has(id))
    if (kept.length === this.collapsed.size) return
    this.collapsed = new Set(kept)
    this.saveCollapsedProjects()
  }

  private saveCollapsedProjects(): void {
    try {
      this.config.set('collapsedProjects', [...this.collapsed])
    } catch (error) {
      // The projects stay as they are until Hoot quits.
      console.error('Could not save which projects are collapsed:', error)
    }
  }

  /** The roots of the worktrees collapsed in the sidebar. */
  get collapsedWorktrees(): string[] {
    return [...this.collapsedRoots]
  }

  /** Records whether a worktree is collapsed in the sidebar and saves it. */
  setWorktreeCollapsed(root: string, collapsed: boolean): void {
    if (this.collapsedRoots.has(root) === collapsed) return
    if (collapsed) this.collapsedRoots.add(root)
    else this.collapsedRoots.delete(root)
    try {
      this.config.set('collapsedWorktrees', [...this.collapsedRoots])
    } catch (error) {
      // The worktrees stay as they are until Hoot quits.
      console.error('Could not save which worktrees are collapsed:', error)
    }
  }

  /** The roots of the projects whose Local row is collapsed in the sidebar. */
  get collapsedLocal(): string[] {
    return [...this.collapsedLocalRoots]
  }

  /** Records whether a project's Local row is collapsed in the sidebar and saves it. */
  setLocalCollapsed(projectRoot: string, collapsed: boolean): void {
    if (this.collapsedLocalRoots.has(projectRoot) === collapsed) return
    if (collapsed) this.collapsedLocalRoots.add(projectRoot)
    else this.collapsedLocalRoots.delete(projectRoot)
    try {
      this.config.set('collapsedLocal', [...this.collapsedLocalRoots])
    } catch (error) {
      // The Local rows stay as they are until Hoot quits.
      console.error('Could not save which Local rows are collapsed:', error)
    }
  }
}
