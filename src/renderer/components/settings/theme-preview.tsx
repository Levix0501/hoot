import { useId } from 'react'
import type { Appearance } from '../../../shared/appearance'
import { terminalTheme, type ColorScheme } from '../../terminal/themes'

/** The size of the drawing, which scales to the card's width. */
const WIDTH = 160
const HEIGHT = 100
/** The radius of the window's corners. */
const RADIUS = 6
/** Where the sidebar ends and the terminal begins. */
const SIDEBAR_WIDTH = 52

/** Bars standing for the sidebar's rows: where each starts down the sidebar, and its length. */
const SIDEBAR_ROWS = [
  [14, 34],
  [24, 24],
  [34, 30],
  [44, 20],
] as const
/** Bars standing for the terminal's lines, the first level with the sidebar's first row. */
const TERMINAL_LINES = [
  [14, 80],
  [23, 56],
  [32, 66],
] as const

/**
 * A Hoot window drawn small in the colors of one appearance, whatever the
 * window's own appearance is: the scheme's class gives the interface's colors
 * inside it, and the terminal's colors are its theme's.
 */
function WindowDrawing({ scheme, clipPath }: { scheme: ColorScheme; clipPath?: string }) {
  const terminal = terminalTheme(scheme)
  return (
    <g className={scheme} clipPath={clipPath} data-scheme={scheme}>
      {/*
        A ground under the parts: where their edges meet, it shows through
        instead of what lies under the drawing, which changes with the
        window's appearance.
      */}
      <rect width={WIDTH} height={HEIGHT} fill={terminal.background} />
      <rect width={SIDEBAR_WIDTH} height={HEIGHT} className="fill-sidebar" data-part="sidebar" />
      {SIDEBAR_ROWS.map(([y, width]) => (
        <rect
          key={y}
          x={8}
          y={y}
          width={width}
          height={4}
          rx={2}
          className="fill-sidebar-foreground/25"
          data-part="bar"
        />
      ))}
      <rect
        x={SIDEBAR_WIDTH}
        width={WIDTH - SIDEBAR_WIDTH}
        height={HEIGHT}
        fill={terminal.background}
        data-part="terminal"
      />
      <line
        x1={SIDEBAR_WIDTH - 0.5}
        x2={SIDEBAR_WIDTH - 0.5}
        y2={HEIGHT}
        strokeWidth={1}
        className="stroke-sidebar-border"
      />
      {TERMINAL_LINES.map(([y, width]) => (
        <rect
          key={y}
          x={SIDEBAR_WIDTH + 8}
          y={y}
          width={width}
          height={3.5}
          rx={1.75}
          fill={terminal.brightBlack}
          data-part="bar"
        />
      ))}
      <rect
        x={0.5}
        y={0.5}
        width={WIDTH - 1}
        height={HEIGHT - 1}
        rx={RADIUS - 0.5}
        fill="none"
        strokeWidth={1}
        className="stroke-border"
      />
    </g>
  )
}

/**
 * What an appearance looks like, as a card of the Appearance page shows it:
 * a Hoot window in light or dark colors, or for macOS's appearance its left
 * half in light colors and its right half in dark ones. Drawn in the page, it
 * looks the same in either appearance of the window.
 */
export function ThemePreview({ appearance }: { appearance: Appearance }) {
  const windowClip = useId()
  const rightHalfClip = useId()
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="block h-auto w-full"
      aria-hidden
      data-testid="theme-preview"
    >
      <defs>
        <clipPath id={windowClip}>
          <rect width={WIDTH} height={HEIGHT} rx={RADIUS} />
        </clipPath>
        <clipPath id={rightHalfClip}>
          <rect x={WIDTH / 2} width={WIDTH / 2} height={HEIGHT} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${windowClip})`}>
        {appearance === 'system' ? (
          <>
            <WindowDrawing scheme="light" />
            <WindowDrawing scheme="dark" clipPath={`url(#${rightHalfClip})`} />
          </>
        ) : (
          <WindowDrawing scheme={appearance} />
        )}
      </g>
    </svg>
  )
}
