import Conf from 'conf'
import {
  issueWindowPositionWithin,
  type IssueWindowLayout,
  type IssueWindowPosition,
} from '../../shared/issue-window'

interface StoredSettings {
  /** Whether the Issues window was open when it was last opened or closed. */
  issueWindowOpen?: boolean
  /** Where it was last moved to. */
  issueWindowPosition?: IssueWindowPosition
}

/**
 * Whether the Issues window is open and where it sits, kept in
 * `settings.json` in the user data directory, beside the file panel's
 * layout, so that Hoot opens with it as it was left. Conf reads the file
 * before every change and writes all of it, so the settings do not
 * overwrite each other.
 */
export class IssueWindowStore {
  private readonly config: Conf<StoredSettings>
  private current: IssueWindowLayout

  constructor(directory: string) {
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    this.current = {
      // Closed to its button until it is opened for the first time.
      open: this.config.get('issueWindowOpen') === true,
      position: issueWindowPositionWithin(this.config.get('issueWindowPosition')),
    }
  }

  get layout(): IssueWindowLayout {
    return { open: this.current.open, position: { ...this.current.position } }
  }

  /** Records whether the window is open and saves it. */
  setOpen(open: boolean): void {
    if (open === this.current.open) return
    this.current.open = open
    this.save('issueWindowOpen', open)
  }

  /** Records where the window sits, as a position it can have, and saves it. */
  setPosition(position: IssueWindowPosition): void {
    const within = issueWindowPositionWithin(position)
    const { side, x, edge, y } = this.current.position
    if (within.side === side && within.x === x && within.edge === edge && within.y === y) return
    this.current.position = within
    this.save('issueWindowPosition', within)
  }

  private save<Key extends keyof StoredSettings>(key: Key, value: StoredSettings[Key]): void {
    try {
      this.config.set(key, value)
    } catch (error) {
      // The window stays as it is until Hoot quits.
      console.error('Could not save the state of the Issues window:', error)
    }
  }
}
