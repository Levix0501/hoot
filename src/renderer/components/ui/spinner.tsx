import { cn } from 'cn'
import { Loader2Icon } from 'lucide-react'
import { useState } from 'react'

/** How long a spinner takes to turn once, in milliseconds. */
const TURN_MS = 1_000

/**
 * Lucide's loader, turning at a steady pace in step with every other spinner;
 * it stands still when the system reduces motion. The span turns rather than
 * the icon: Chromium keeps an svg's transform animation off the compositor
 * unless its effective zoom is 1, which a Retina screen's device scale factor
 * rules out (crbug.com/1186312), so a turning svg stutters whenever the main
 * thread is busy.
 */
function Spinner({ className, style, ...props }: React.ComponentProps<'span'>) {
  // As far into its turn as every spinner is, whenever it starts.
  const [delay] = useState(() => -(performance.now() % TURN_MS))
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-flex size-4 shrink-0 animate-spin motion-reduce:animate-none',
        className,
      )}
      style={{ animationDuration: `${TURN_MS}ms`, animationDelay: `${delay}ms`, ...style }}
      {...props}
    >
      <Loader2Icon className="size-full" aria-hidden />
    </span>
  )
}

export { Spinner }
