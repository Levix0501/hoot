import { SendIcon } from 'lucide-react'
import { useState } from 'react'
import type { Issue } from '../../../shared/issues'
import { cn } from '../../lib/utils'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
import { ChatAgentMenuEntries } from '../chat-agent-menu'
import { dropdownMenuParts } from '../menu-parts'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Spinner } from '../ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/**
 * The button that sends an open issue to an agent: clicking it opens the
 * usable agents menu; choosing one creates a new worktree for the issue in
 * its project and starts a saved session of that agent in it with the issue
 * as its first message. Disabled while the issue has no project or while its
 * worktree is being created, with a tooltip explaining why.
 */
export function IssueSendButton({
  issue,
  tooltipSide,
  size = 'icon-sm',
  open,
  onOpenChange,
  finalFocus = focusAfterOverlay,
  className,
  buttonClassName,
}: {
  issue: Issue
  tooltipSide: 'top' | 'bottom'
  size?: 'icon-xs' | 'icon-sm'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  finalFocus?: () => HTMLElement | boolean
  /** Places the button, as its row, page or window needs. */
  className?: string
  /** Extra classes for the trigger button itself. */
  buttonClassName?: string
}) {
  const hasProject = useAppStore(
    (state) =>
      issue.projectId !== null && state.projects.some((project) => project.id === issue.projectId),
  )
  const sending = useAppStore((state) => state.sendingIssues.includes(issue.id))
  const sendIssueToAgent = useAppStore((state) => state.sendIssueToAgent)
  const [internalOpen, setInternalOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const disabled = !hasProject || sending
  const menuOpen = (open ?? internalOpen) && !disabled

  const handleOpenChange = (next: boolean) => {
    if (next && disabled) return
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const tooltipText = !hasProject
    ? 'Set a Project first'
    : sending
      ? 'Creating worktree…'
      : 'Send to agent'

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <Tooltip open={tooltipOpen && !menuOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger render={<span className={cn('flex shrink-0', className)} />}>
          {/* While it cannot be used, it is still what the pointer is on so its tooltip shows. */}
          <DropdownMenuTrigger
            disabled={disabled}
            render={
              <Button
                variant="ghost"
                size={size}
                className={cn(
                  'text-muted-foreground disabled:pointer-events-auto',
                  buttonClassName,
                )}
                disabled={disabled}
                aria-label={sending ? 'Creating worktree' : 'Send to agent'}
                aria-busy={sending || undefined}
                data-testid="issue-send"
                data-issue-id={issue.id}
                data-sending={sending || undefined}
              />
            }
          >
            {sending ? <Spinner /> : <SendIcon />}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} data-testid="issue-send-tooltip">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-auto min-w-48 [app-region:no-drag]"
        finalFocus={finalFocus}
      >
        <ChatAgentMenuEntries
          components={dropdownMenuParts}
          onSelect={(agentId) => void sendIssueToAgent(issue.id, agentId)}
          testId="issue-send-agent"
          failure="Could not start a session."
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
