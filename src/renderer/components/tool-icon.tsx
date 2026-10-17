import { SquareTerminalIcon } from 'lucide-react'
import type { ToolId } from '../../shared/tools'
import ClaudeCodeIcon from '../assets/brand-icons/claude-code.svg?react'
import CodexIcon from '../assets/brand-icons/codex.svg?react'
import OpenCodeOnDarkIcon from '../assets/brand-icons/opencode-on-dark.svg?react'
import OpenCodeOnLightIcon from '../assets/brand-icons/opencode-on-light.svg?react'
import { cn } from '../lib/utils'

export function ToolIcon({ toolId, className }: { toolId: ToolId; className?: string }) {
  const props = { className, 'data-tool-icon': toolId }
  switch (toolId) {
    case 'claude':
      // Claude Code's own mark in its own orange, without the title its file has, which
      // would show as a tooltip.
      return <ClaudeCodeIcon {...props} title="" aria-hidden />
    case 'codex':
      // The blossom is one color, which is the text's.
      return <CodexIcon {...props} aria-hidden />
    case 'opencode':
      // opencode's logo comes in two sets of grays, one for each kind of background.
      return (
        <>
          <OpenCodeOnLightIcon {...props} className={cn(className, 'dark:hidden')} aria-hidden />
          <OpenCodeOnDarkIcon
            {...props}
            className={cn(className, 'hidden dark:block')}
            aria-hidden
          />
        </>
      )
    case 'shell':
      return <SquareTerminalIcon {...props} />
  }
}
