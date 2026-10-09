import '@xterm/xterm/css/xterm.css'
import './index.css'
import { ThemeProvider } from 'next-themes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadTerminalFont } from './terminal/terminal-font'

// Terminals measure their cells with their font when they open.
await loadTerminalFont()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The interface follows the system appearance; there is no manual theme choice. */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
