import { EventEmitter } from 'node:events'
import Conf from 'conf'

interface StoredSettings {
  /** Whether the sidebar was collapsed when it was last shown or hidden. */
  sidebarCollapsed?: boolean
}

/**
 * Whether the sidebar is expanded, kept in `settings.json` in the user data
 * directory, next to the permission levels, so that Hoot opens with the
 * sidebar as it was left. Conf reads the file before every change and writes
 * all of it, so the two settings do not overwrite each other.
 */
export class SidebarStateStore extends EventEmitter<{ changed: [open: boolean] }> {
  private readonly config: Conf<StoredSettings>
  private expanded: boolean

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    // Expanded until the sidebar is collapsed for the first time.
    this.expanded = this.config.get('sidebarCollapsed') !== true
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
}
