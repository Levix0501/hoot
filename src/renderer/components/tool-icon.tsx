import { BotIcon, CodeIcon, SquareTerminalIcon } from 'lucide-react'
import type { ToolId } from '../../shared/tools'
import ClaudeCodeIcon from '../assets/brand-icons/claude-code.svg?react'
import { cn } from '../lib/utils'

export function ToolIcon({ toolId, className }: { toolId: ToolId; className?: string }) {
  const props = { className, 'data-tool-icon': toolId }
  switch (toolId) {
    case 'claude':
      // Claude Code's own mark, without the title its file has. It is drawn
      // in the color of the text around it, also where the other icons get a
      // color of their own.
      return (
        <ClaudeCodeIcon
          {...props}
          className={cn(className, 'text-inherit!')}
          title=""
          aria-hidden
        />
      )
    case 'codex':
      return <CodeIcon {...props} />
    case 'opencode':
      return <BotIcon {...props} />
    case 'shell':
      return <SquareTerminalIcon {...props} />
  }
}
