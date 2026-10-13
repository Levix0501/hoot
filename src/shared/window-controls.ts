/**
 * The window's own buttons, and the room the page leaves for them in the
 * window's top row:
 *
 * - `traffic-lights`: macOS's traffic lights, at the left end of the row. The
 *   navigation starts past them, or near the window's edge in full screen,
 *   where macOS hides them.
 * - `overlay`: the minimize, maximize and close buttons of Windows, which
 *   Windows draws over the right end of the row. The navigation starts near
 *   the window's edge, and the content of the row stops short of them.
 * - `placeholder`: on macOS started with the {@link WINDOWS_LAYOUT_SWITCH},
 *   the traffic lights, and an empty area at the right end of the row as wide
 *   as the buttons of Windows, which the content of the row stops short of as
 *   it does on Windows. It shows on a Mac whether the buttons of Windows would
 *   cover anything.
 */
export type WindowControls = 'traffic-lights' | 'overlay' | 'placeholder'

/** The command-line switch that starts Hoot on macOS with the placeholder. */
export const WINDOWS_LAYOUT_SWITCH = 'windows-layout'

/** The window's buttons on `platform` (a `process.platform` value). */
export function windowControlsFor(platform: string, windowsLayoutSwitch: boolean): WindowControls {
  if (platform === 'win32') return 'overlay'
  return windowsLayoutSwitch ? 'placeholder' : 'traffic-lights'
}

const ARGUMENT_PREFIX = '--hoot-window-controls='

/** The argument that passes the window's buttons on to the window's preload script. */
export function windowControlsArgument(controls: WindowControls): string {
  return `${ARGUMENT_PREFIX}${controls}`
}

/** The window's buttons as passed in the preload script's `argv`, macOS's when missing. */
export function windowControlsFromArguments(argv: readonly string[]): WindowControls {
  const value = argv.find((argument) => argument.startsWith(ARGUMENT_PREFIX))
  const controls = value?.slice(ARGUMENT_PREFIX.length)
  return controls === 'overlay' || controls === 'placeholder' ? controls : 'traffic-lights'
}
