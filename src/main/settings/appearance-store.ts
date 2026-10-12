import { EventEmitter } from 'node:events'
import Conf from 'conf'
import { DEFAULT_APPEARANCE, isAppearance, type Appearance } from '../../shared/appearance'

interface StoredSettings {
  /** The appearance picked last; macOS's until one is picked. */
  appearance?: Appearance
}

/**
 * The appearance picked on the settings' Appearance page, kept in
 * `settings.json` in the user data directory next to the permission levels
 * and the sidebar's state, so that Hoot opens with it. Conf reads the file
 * before every change and writes all of it, so the settings do not overwrite
 * each other.
 */
export class AppearanceStore extends EventEmitter<{ changed: [appearance: Appearance] }> {
  private readonly config: Conf<StoredSettings>
  private picked: Appearance

  constructor(directory: string) {
    super()
    this.config = new Conf<StoredSettings>({
      cwd: directory,
      configName: 'settings',
      clearInvalidConfig: true,
    })
    const stored: unknown = this.config.get('appearance')
    this.picked = isAppearance(stored) ? stored : DEFAULT_APPEARANCE
  }

  get appearance(): Appearance {
    return this.picked
  }

  /** Records the appearance picked and saves it. */
  select(appearance: Appearance): void {
    if (appearance === this.picked) return
    this.picked = appearance
    try {
      this.config.set('appearance', appearance)
    } catch (error) {
      // The appearance still applies until Hoot quits.
      console.error('Could not save the appearance:', error)
    }
    this.emit('changed', appearance)
  }
}
