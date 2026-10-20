import type { SessionState } from '../lib/session-state'
import { cn } from '../lib/utils'
import { Spinner } from './ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** A filled circle of a color. */
function Dot({ className }: { className: string }) {
  return <span className={cn('size-2 rounded-full', className)} />
}

/** The shape of each state's light. */
function Shape({ state }: { state: SessionState }) {
  switch (state) {
    case 'starting':
      return <Spinner className="size-3 text-muted-foreground" />
    case 'working':
      // 70% of the color of the text around it.
      return <Spinner className="size-3 text-current/70" />
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
