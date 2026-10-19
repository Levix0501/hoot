import { useState } from 'react'
import type { SessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** How long a spinner takes to turn once, in milliseconds. */
const TURN_MS = 2_000

/**
 * A ring whose track is at 30% opacity, with an arc of 270° on it that turns
 * at a steady pace, in step with every other spinner; it stands still when
 * the system reduces motion.
 */
function Spinner({ className }: { className?: string }) {
  // As far into its turn as every spinner is, whenever it starts.
  const [delay] = useState(() => -(performance.now() % TURN_MS))
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn('size-3 animate-spin motion-reduce:animate-none', className)}
      style={{ animationDuration: `${TURN_MS}ms`, animationDelay: `${delay}ms` }}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity={0.3} />
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={360}
        strokeDasharray="270 360"
      />
    </svg>
  )
}

/** A filled circle of a color. */
function Dot({ className }: { className: string }) {
  return <span className={cn('size-2 rounded-full', className)} />
}

/** The shape of each state's light. */
function Shape({ state }: { state: SessionState }) {
  switch (state) {
    case 'starting':
      return <Spinner className="text-muted-foreground" />
    case 'working':
      // 70% of the color of the text around it.
      return <Spinner className="text-current/70" />
    case 'waiting':
      return <Dot className="bg-amber-500" />
    case 'done':
      return <Dot className="bg-[#339cff]" />
    case 'idle':
    case 'running':
      return <Dot className="bg-emerald-500" />
    case 'error':
    case 'ended-unexpectedly':
      return <Dot className="bg-red-500" />
    case 'ended':
      return <span className="size-2 rounded-full border-[1.5px] border-muted-foreground" />
  }
}

/**
 * The light of a session state, in a place of its own that is as wide
 * whatever the state: a spinner while the session starts or Claude Code
 * works, a hollow circle once the session ended, and a dot otherwise.
 */
export function StateLight({ state, className }: { state: SessionState; className?: string }) {
  return (
    <span
      className={cn('flex size-3 shrink-0 items-center justify-center', className)}
      data-state={state}
      aria-hidden
    >
      <Shape state={state} />
    </span>
  )
}

/** The light of a session state, which says what it shows in a tooltip when pointed at. */
export function StateLightWithTooltip({
  state,
  tooltip,
  testId,
}: {
  state: SessionState
  tooltip: string
  testId: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        // Shown only when pointed at for a moment, as a row's details are.
        delay={400}
        render={<span />}
        className="flex shrink-0"
        data-state={state}
        data-testid={testId}
      >
        <StateLight state={state} />
        <span className="sr-only">{tooltip}</span>
      </TooltipTrigger>
      <TooltipContent data-testid={`${testId}-tooltip`}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
