import { BotIcon, CodeIcon, SparklesIcon, SquareTerminalIcon } from 'lucide-react'
import type { ToolId } from '../../shared/tools'

export function ToolIcon({ toolId, className }: { toolId: ToolId; className?: string }) {
  const props = { className, 'data-tool-icon': toolId }
  switch (toolId) {
    case 'claude':
      return <SparklesIcon {...props} />
    case 'codex':
      return <CodeIcon {...props} />
    case 'opencode':
      return <BotIcon {...props} />
    case 'shell':
      return <SquareTerminalIcon {...props} />
  }
}
