import { EventEmitter } from 'node:events'
import Conf from 'conf'
import {
  fileEditorWidthWithin,
  fileTreeWidthWithin,
  type FilePanelLayout,
} from '../../shared/file-panel'

interface StoredSettings {
  /** Whether the file panel was shown when it was last shown or hidden. */
  filePanelOpen?: boolean
  /** The width of the panel's tree in CSS pixels, as it was last resized. */
  fileTreeWidth?: number
  /** The width of the panel's open files in CSS pixels, as it was last resized. */
  fileEditorWidth?: number
}

/**
 * Whether the file panel is shown and how wide its tree and its open files
 * are, kept in `settings.json` in the user data directory, beside the
 * sidebar's state, so that Hoot opens with the panel as it was left. Conf
 * reads the file before every change and writes all of it, so the settings
 * do not overwrite each other.
 */
export class FilePanelStore extends EventEmitter<{ changed: [open: boolean] }> {
  private readonly config: Conf<StoredSettings>
  private current: FilePanelLayout

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    this.current = {
      // Hidden until it is shown for the first time.
      open: this.config.get('filePanelOpen') === true,
      treeWidth: fileTreeWidthWithin(this.config.get('fileTreeWidth')),
      editorWidth: fileEditorWidthWithin(this.config.get('fileEditorWidth')),
    }
  }

  get layout(): FilePanelLayout {
    return { ...this.current }
  }

  /** Records whether the panel is shown and saves it. */
  setOpen(open: boolean): void {
    if (open === this.current.open) return
    this.current.open = open
    this.save('filePanelOpen', open)
    this.emit('changed', open)
  }

  /** Records the tree's width, brought within its limits, and saves it. */
  setTreeWidth(width: number): void {
    const within = fileTreeWidthWithin(width)
    if (within === this.current.treeWidth) return
    this.current.treeWidth = within
    this.save('fileTreeWidth', within)
  }

  /** Records the open files' width, brought within their limits, and saves it. */
  setEditorWidth(width: number): void {
    const within = fileEditorWidthWithin(width)
    if (within === this.current.editorWidth) return
    this.current.editorWidth = within
    this.save('fileEditorWidth', within)
  }

  private save<Key extends keyof StoredSettings>(key: Key, value: StoredSettings[Key]): void {
    try {
      this.config.set(key, value)
    } catch (error) {
      // The panel stays as it is until Hoot quits.
      console.error('Could not save the state of the file panel:', error)
    }
  }
}
