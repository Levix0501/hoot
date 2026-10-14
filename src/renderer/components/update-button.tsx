import { cn } from 'cn'
import { DownloadIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore } from '../store/app-store'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'

/** The curve of every motion of the button. */
const EASE = 'ease-[cubic-bezier(0.25,0.46,0.45,0.94)]'

/**
 * The button beside Settings while a newer version of Hoot is out: a blue
 * circle with a download icon, which widens to say Update while the pointer
 * is on it or it has the keyboard focus. Clicking it downloads the version,
 * the button staying wide to show how much has arrived, and then restarts
 * Hoot into it; the circle shows a spinner while Hoot restarts.
 */
export function UpdateButton({ className }: { className?: string }) {
  const update = useAppStore((state) => state.update)
  const installUpdate = useAppStore((state) => state.installUpdate)
  if (update.kind === 'none') return null

  const downloading = update.kind === 'downloading'
  const restarting = update.kind === 'restarting'
  const label = restarting ? 'Restarting' : 'Update'
  // While downloading, the percentage takes the place of the label, as wide
  // as 100% is, so that the button keeps its width as the number grows.
  const text: ReactNode = downloading ? (
    <span className="grid text-xs leading-3">
      <span className="invisible col-start-1 row-start-1">100%</span>
      <span className="col-start-1 row-start-1 text-center">{update.percent}%</span>
    </span>
  ) : (
    label
  )

  return (
    <Button
      className={cn(
        // Its width is the padding alone while its one column is closed, and
        // grows by the text's when the column opens.
        'grid h-5 max-w-36 min-w-5 items-center justify-center overflow-visible rounded-full border-0 bg-chart-1 px-2.5 text-[10px] leading-3 font-semibold text-white shadow-sm contain-layout contain-style transition-[grid-template-columns,background-color] duration-220 hover:bg-[color-mix(in_srgb,var(--color-chart-1)_92%,black)] focus-visible:transition-none active:bg-chart-1/80 disabled:opacity-100 motion-reduce:transition-none',
        EASE,
        downloading
          ? 'grid-cols-[1fr]'
          : 'grid-cols-[0fr] hover:grid-cols-[1fr] focus-visible:grid-cols-[1fr]',
        className,
      )}
      disabled={downloading || restarting}
      onClick={installUpdate}
      aria-label={
        downloading
          ? `Downloading Hoot ${update.version}, ${update.percent}%`
          : restarting
            ? `Restarting into Hoot ${update.version}`
            : `Update to Hoot ${update.version}`
      }
      data-testid="update-button"
      data-state={update.kind}
    >
      {/* The icon, which shrinks away as the button widens, and comes back once it has nearly closed. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center transition-[opacity,scale] duration-80 group-focus-visible/button:transition-none motion-reduce:transition-none',
          EASE,
          downloading
            ? 'scale-90 opacity-0'
            : 'delay-140 group-hover/button:scale-90 group-hover/button:opacity-0 group-hover/button:delay-0 group-focus-visible/button:scale-90 group-focus-visible/button:opacity-0 group-focus-visible/button:delay-0',
        )}
      >
        {restarting ? <Spinner className="size-3" /> : <DownloadIcon className="size-3" />}
      </span>
      {/* Sets how wide the open column is. */}
      <span
        aria-hidden
        className={cn(
          'invisible min-w-0 truncate tabular-nums',
          downloading && 'text-xs leading-3',
        )}
      >
        {downloading ? '100%' : label}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        {/*
          The text slides in from the right as the button widens, faded out
          at its right edge, which stays inside the padding; once it is in,
          an unfaded copy takes its place.
        */}
        <span
          className={cn(
            'absolute inset-x-2.5 inset-y-0 flex items-center justify-center overflow-visible transition-opacity duration-30 [mask-image:linear-gradient(to_left,transparent,black_8px,black)] group-focus-visible/button:transition-none motion-reduce:transition-none',
            EASE,
            downloading
              ? 'opacity-0 delay-190'
              : 'opacity-100 group-hover/button:opacity-0 group-hover/button:delay-190 group-focus-visible/button:opacity-0',
          )}
        >
          <span
            className={cn(
              'whitespace-nowrap tabular-nums transition-transform duration-220 group-focus-visible/button:transition-none motion-reduce:transition-none',
              EASE,
              downloading
                ? 'translate-x-0'
                : 'translate-x-[calc(100%+12px)] group-hover/button:translate-x-0 group-focus-visible/button:translate-x-0',
            )}
          >
            {text}
          </span>
        </span>
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center whitespace-nowrap tabular-nums transition-opacity duration-30 group-focus-visible/button:transition-none motion-reduce:transition-none',
            EASE,
            downloading
              ? 'opacity-100 delay-190'
              : 'opacity-0 group-hover/button:opacity-100 group-hover/button:delay-190 group-focus-visible/button:opacity-100',
          )}
        >
          {text}
        </span>
      </span>
    </Button>
  )
}
