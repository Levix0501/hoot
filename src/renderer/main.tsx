import '@xterm/xterm/css/xterm.css'
import './index.css'
import { ThemeProvider } from 'next-themes'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DatabaseErrorPage } from './components/database-error-page'
import { api } from './lib/api'
import { useAppStore } from './store/app-store'
import { loadTerminalFont } from './terminal/terminal-font'

function render(content: ReactNode): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* The interface follows the system appearance; there is no manual theme choice. */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {content}
      </ThemeProvider>
    </StrictMode>,
  )
}

const startup = await api.getStartupState()
if (startup.kind === 'database-error') {
  render(<DatabaseErrorPage message={startup.message} path={startup.path} />)
} else {
  // Terminals measure their cells with their font when they open, and the
  // sidebar opens as it was left.
  await Promise.all([loadTerminalFont(), useAppStore.getState().initializeWindow()])
  render(<App />)
}
