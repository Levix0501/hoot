import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** A line across the top of an open file, saying what is wrong with it, with what can be done. */
export function Notice({ tone, children }: { tone?: 'error'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/50 px-3 py-2 text-[13px]',
        tone === 'error' && 'text-destructive',
      )}
      data-testid="file-notice"
    >
      {children}
    </div>
  )
}
