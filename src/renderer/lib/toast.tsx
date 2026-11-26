import { CircleAlertIcon, CircleCheckIcon, InfoIcon, XIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { toast as sonner } from 'sonner'
import { Button } from '../components/ui/button'
import { Toaster } from '../components/ui/sonner'
import { cn } from './utils'

/** How a toast reads: neutral, or tinted for something that went well, a warning or a failure. */
type ToastLevel = 'info' | 'success' | 'warning' | 'error'

/** A toast's button, which closes the toast once it has done its work. */
export interface ToastAction {
  label: ReactNode
  onClick: () => void
}

export interface ToastOptions {
  /** More about it, below the title. */
  description?: ReactNode
  action?: ToastAction
  /** The icon at its left, in place of the level's. */
  icon?: ReactNode
  /** How long it shows, in milliseconds, unless the pointer is on the toasts. */
  duration?: number
}

/**
 * The card and the icon of each level. The description is as tinted as the
 * title, except on a neutral toast, where it is fainter.
 */
const LEVELS: Record<ToastLevel, { card: string; icon: ReactNode }> = {
  info: { card: 'border-border bg-popover text-popover-foreground', icon: <InfoIcon /> },
  success: {
    card: 'border-[#00a240]/20 bg-[#edfaf2] text-[#00a240] dark:border-[#40c977]/20 dark:bg-[#011c0b] dark:text-[#40c977]',
    icon: <CircleCheckIcon />,
  },
  warning: {
    card: 'border-[#e25507]/15 bg-[#fff5f0] text-[#e25507] dark:border-[#ff8549]/40 dark:bg-[#281105] dark:text-[#ff8549]',
    icon: <CircleAlertIcon />,
  },
  error: {
    card: 'border-[#e02e2a]/15 bg-[#fff0f0] text-[#e02e2a] dark:border-[#fa423e]/40 dark:bg-[#280b0a] dark:text-[#ff6764]',
    icon: <CircleAlertIcon />,
  },
}

/** The 16px icons of a toast, in strokes about 1px wide. */
const ICON = 'flex size-6 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:stroke-[1.6]'

/**
 * A toast: a rounded card with the level's icon, the title and, below it,
 * the description, and at its right end the button and the close button.
 * With a description, the button goes to a row of its own below. Behind a
 * newer toast, while the toasts are stacked, it is as tall as that one, and
 * what it says fades out.
 */
function Toast({
  id,
  level,
  title,
  description,
  action,
  icon,
}: { id: string | number; level: ToastLevel; title: ReactNode } & Omit<ToastOptions, 'duration'>) {
  const inline = description === undefined
  const button = action && (
    <Button
      size="xs"
      // A quarter rounder than the buttons around, its corners superellipses;
      // it changes at once on hover, and its text is as heavy as the toast's.
      className="h-6 rounded-[12.5px] border-border bg-clip-border px-2 text-xs leading-4 font-normal transition-none [corner-shape:superellipse(1.5)]"
      onClick={() => {
        action.onClick()
        sonner.dismiss(id)
      }}
      data-testid="toast-action"
    >
      {action.label}
    </Button>
  )
  return (
    <div
      className={cn(
        // Centered in the row of toasts, as wide as what it says.
        'mx-auto flex h-full w-max max-w-full flex-col gap-2 overflow-hidden rounded-[15px] border px-3 py-2 font-sans text-sm leading-normal shadow-[0_4px_12px_#0000001a] [corner-shape:superellipse(1.5)]',
        '*:transition-opacity *:duration-300 group-data-[expanded=false]/toast:group-data-[front=false]/toast:*:opacity-0',
        LEVELS[level].card,
      )}
      data-testid="toast"
      data-level={level}
    >
      <div className="flex min-w-0 items-start gap-1">
        <span className={ICON} aria-hidden>
          {icon ?? LEVELS[level].icon}
        </span>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="min-w-0 flex-1 break-words">
            <div
              className="flex min-h-6 items-center font-medium whitespace-pre-wrap"
              data-testid="toast-title"
            >
              {title}
            </div>
            {!inline && (
              <div
                className={cn(level === 'info' && 'text-popover-foreground/70')}
                data-testid="toast-description"
              >
                {description}
              </div>
            )}
          </div>
          {inline && button}
        </div>
        <button
          type="button"
          aria-label="Close"
          className={cn(
            ICON,
            'rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
          onClick={() => sonner.dismiss(id)}
          data-testid="toast-close"
        >
          <XIcon />
        </button>
      </div>
      {!inline && button && <div className="flex justify-end">{button}</div>}
    </div>
  )
}

/**
 * Where the toasts show: 2px below the window's top row, centered on the
 * window, each as wide as what it says, up to 790px. A newer one comes in
 * over the older ones in 300ms, and they stack behind it until the pointer
 * is on them; each goes after 5 seconds, which wait while the pointer is on
 * them.
 */
export function Toasts() {
  return (
    <Toaster
      position="top-center"
      offset={{ top: 48 }}
      gap={8}
      duration={5000}
      swipeDirections={['right']}
      // A toast is placed out of the row's flow, and centered all the same.
      className="flex justify-center"
      style={{ '--width': 'min(790px, calc(100vw - 16px))' } as CSSProperties}
      toastOptions={{
        unstyled: true,
        className: 'group/toast pointer-events-auto w-max max-w-full',
        classNames: { content: 'contents', title: 'contents' },
        style: { transitionDuration: '300ms' },
      }}
    />
  )
}

function show(level: ToastLevel, title: ReactNode, options: ToastOptions = {}): string | number {
  const { duration, ...rest } = options
  return sonner.custom((id) => <Toast id={id} level={level} title={title} {...rest} />, {
    duration,
  })
}

/** Shows a toast at the top of the window, of one level or another (see `Toasts`). */
export const toast = {
  info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
  success: (title: ReactNode, options?: ToastOptions) => show('success', title, options),
  warning: (title: ReactNode, options?: ToastOptions) => show('warning', title, options),
  error: (title: ReactNode, options?: ToastOptions) => show('error', title, options),
}
