// A preload script for the end-to-end tests (see main-hooks.cjs). From the
// start of the page, before its own scripts run, it records at every frame,
// before the frame is drawn, the colors of what the window shows then: the
// page's background, and once they are there the sidebar's and the main
// area's (or the database error page's). It stops a second after those are
// there. The tests read the records as `window.hootE2eFirstPaint.records()`.
const { contextBridge } = require('electron')

const records = []
const paints = []
let shownSince = null

const backgroundOf = (selector) => {
  const element = document.querySelector(selector)
  return element ? getComputedStyle(element).backgroundColor : null
}

function record(time) {
  const root = document.documentElement
  const entry = {
    time,
    dark: root.classList.contains('dark'),
    light: root.classList.contains('light'),
    page: document.body ? getComputedStyle(document.body).backgroundColor : null,
    sidebar: backgroundOf('[data-slot="sidebar-inner"]'),
    main: backgroundOf('[data-slot="sidebar-inset"]'),
    databaseError: backgroundOf('[data-testid="database-error"]'),
  }
  records.push(entry)
  if (shownSince === null && ((entry.sidebar && entry.main) || entry.databaseError)) {
    shownSince = time
  }
  if ((shownSince === null || time - shownSince < 1_000) && records.length < 5_000) {
    requestAnimationFrame(record)
  }
}

requestAnimationFrame(record)
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) paints.push({ name: entry.name, time: entry.startTime })
}).observe({ type: 'paint', buffered: true })

contextBridge.exposeInMainWorld('hootE2eFirstPaint', {
  records: () => ({ records, paints }),
})
