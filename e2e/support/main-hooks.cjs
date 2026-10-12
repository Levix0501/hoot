// Loaded into Hoot's main process before Hoot's own code (`-r`), for the
// end-to-end tests:
//
// - It stands in for the appearance macOS uses, so that the tests can set it
//   and change it without changing the Mac's own. Hoot sets
//   `nativeTheme.themeSource`; while Hoot sets it to `system`, the stand-in
//   applies the appearance the test gave macOS instead, as macOS would apply
//   its own, and Hoot still reads `system` back. Light and dark apply as set.
// - It records the background color of each window from its creation on.
// - With `--hoot-e2e-record-first-paint`, it records in each page what the
//   window shows at every frame from the page's start (see
//   first-paint-recorder.cjs).
const path = require('node:path')
const { app, nativeTheme, session } = require('electron')

/** The value of a `--name=value` switch Hoot was started with, or `null`. */
function switchValue(name) {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument === undefined ? null : argument.slice(prefix.length)
}

/** The accessor Electron defines for `themeSource`, on the object or a prototype of it. */
function themeSourceAccessor() {
  for (let object = nativeTheme; object; object = Object.getPrototypeOf(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, 'themeSource')
    if (descriptor) return descriptor
  }
  throw new Error('nativeTheme has no themeSource')
}

const accessor = themeSourceAccessor()
/** What Hoot set. */
let themeSource = accessor.get.call(nativeTheme)
/** The appearance macOS uses as the test has it, or `null` for the Mac's own. */
let systemAppearance = switchValue('hoot-e2e-system-appearance')

function applyThemeSource() {
  const applied = themeSource === 'system' && systemAppearance ? systemAppearance : themeSource
  if (accessor.get.call(nativeTheme) !== applied) accessor.set.call(nativeTheme, applied)
}

Object.defineProperty(nativeTheme, 'themeSource', {
  configurable: true,
  enumerable: true,
  get: () => themeSource,
  set: (value) => {
    themeSource = value
    applyThemeSource()
  },
})
applyThemeSource()

/** The background colors each window had, in the order of their creation, as they changed. */
const windowBackgrounds = []

app.on('browser-window-created', (_event, window) => {
  const colors = []
  windowBackgrounds.push(colors)
  // Electron reports the window before it applies the options it was created
  // with; they are applied once its constructor returns, before anything is drawn.
  queueMicrotask(() => colors.push(window.getBackgroundColor()))
  const setBackgroundColor = window.setBackgroundColor.bind(window)
  window.setBackgroundColor = (color) => {
    setBackgroundColor(color)
    colors.push(window.getBackgroundColor())
  }
})

if (process.argv.includes('--hoot-e2e-record-first-paint')) {
  // Before Hoot's own code opens the window, which waits for the same event.
  void app.whenReady().then(() => {
    session.defaultSession.registerPreloadScript({
      type: 'frame',
      filePath: path.join(__dirname, 'first-paint-recorder.cjs'),
    })
  })
}

globalThis.hootE2e = {
  /** Changes the appearance macOS uses, as the Mac's settings would. */
  setSystemAppearance(appearance) {
    systemAppearance = appearance
    applyThemeSource()
  },
  windowBackgrounds,
}
