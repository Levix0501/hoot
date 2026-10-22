/**
 * How many issues are neither done nor canceled, as a sidebar row shows it
 * right of its name; nothing when there are none.
 */
export function OpenIssueCount({ count, testId }: { count: number; testId: string }) {
  if (count === 0) return null
  return (
    <span
      className="shrink-0 rounded-full bg-sidebar-foreground/10 px-1.5 text-xs font-medium tabular-nums"
      data-testid={testId}
    >
      {count}
    </span>
  )
}
