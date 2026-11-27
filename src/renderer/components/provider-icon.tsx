import { ServerIcon } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { findProvider, providerMark, type ProviderMark } from '../../shared/providers'
import type { CodingToolId, ToolId } from '../../shared/tools'
import Ai302Icon from '../assets/provider-icons/ai302-color.svg?react'
import AiHubMixIcon from '../assets/provider-icons/aihubmix-color.svg?react'
import AnthropicIcon from '../assets/provider-icons/anthropic.svg?react'
import AzureIcon from '../assets/provider-icons/azure-color.svg?react'
import BailianIcon from '../assets/provider-icons/bailian-color.svg?react'
import BedrockIcon from '../assets/provider-icons/bedrock-color.svg?react'
import CommandCodeIcon from '../assets/provider-icons/commandcode.svg?react'
import DeepSeekIcon from '../assets/provider-icons/deepseek-color.svg?react'
import FireworksIcon from '../assets/provider-icons/fireworks-color.svg?react'
import GoogleIcon from '../assets/provider-icons/google-color.svg?react'
import GroqIcon from '../assets/provider-icons/groq.svg?react'
import HuaweiCloudIcon from '../assets/provider-icons/huaweicloud-color.svg?react'
import KimiIcon from '../assets/provider-icons/kimi-color.svg?react'
import MiniMaxIcon from '../assets/provider-icons/minimax-color.svg?react'
import ModelScopeIcon from '../assets/provider-icons/modelscope-color.svg?react'
import OllamaIcon from '../assets/provider-icons/ollama.svg?react'
import OpenAIIcon from '../assets/provider-icons/openai.svg?react'
import OpenRouterIcon from '../assets/provider-icons/openrouter.svg?react'
import QwenIcon from '../assets/provider-icons/qwen-color.svg?react'
import SiliconCloudIcon from '../assets/provider-icons/siliconcloud-color.svg?react'
import StepFunIcon from '../assets/provider-icons/stepfun-color.svg?react'
import TencentCloudIcon from '../assets/provider-icons/tencentcloud-color.svg?react'
import VertexAIIcon from '../assets/provider-icons/vertexai-color.svg?react'
import VolcengineIcon from '../assets/provider-icons/volcengine-color.svg?react'
import XAIIcon from '../assets/provider-icons/xai.svg?react'
import XiaomiMiMoIcon from '../assets/provider-icons/xiaomimimo.svg?react'
import ZaiIcon from '../assets/provider-icons/zai.svg?react'
import ZhipuIcon from '../assets/provider-icons/zhipu-color.svg?react'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app-store'
import { ToolIcon } from './tool-icon'

type Svg = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>

/** The providers' marks, in their own colors where they have them, else in the text's. */
const MARKS: Record<Exclude<ProviderMark, 'custom' | 'opencode'>, Svg> = {
  ai302: Ai302Icon,
  aihubmix: AiHubMixIcon,
  anthropic: AnthropicIcon,
  azure: AzureIcon,
  bailian: BailianIcon,
  bedrock: BedrockIcon,
  commandcode: CommandCodeIcon,
  deepseek: DeepSeekIcon,
  fireworks: FireworksIcon,
  google: GoogleIcon,
  groq: GroqIcon,
  huaweicloud: HuaweiCloudIcon,
  kimi: KimiIcon,
  minimax: MiniMaxIcon,
  modelscope: ModelScopeIcon,
  ollama: OllamaIcon,
  openai: OpenAIIcon,
  openrouter: OpenRouterIcon,
  qwen: QwenIcon,
  siliconcloud: SiliconCloudIcon,
  stepfun: StepFunIcon,
  tencentcloud: TencentCloudIcon,
  vertexai: VertexAIIcon,
  volcengine: VolcengineIcon,
  xai: XAIIcon,
  xiaomimimo: XiaomiMiMoIcon,
  zai: ZaiIcon,
  zhipu: ZhipuIcon,
}

/** A provider's mark: its maker's, OpenCode's for its free models, or a plain one Hoot does not know. */
export function ProviderMarkIcon({ mark, className }: { mark: ProviderMark; className?: string }) {
  if (mark === 'custom') return <ServerIcon className={className} aria-hidden />
  if (mark === 'opencode') return <ToolIcon toolId="opencode" className={className} />
  const Mark = MARKS[mark]
  // Without the title its file has, which would show as a tooltip.
  return <Mark className={className} title="" aria-hidden />
}

/**
 * Where the badge sits in the icon's 24-unit box: its center, its diameter,
 * and the radius of the hole cut out of the agent's mark around it. It is a
 * little larger than a quarter of the icon, and reaches past its corner.
 */
const BADGE = { center: 19, diameter: 15, cut: 9.3 }

/** A mask that keeps the whole box but a circle: the hole the badge sits in. */
function holeMask(center: number, radius: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path fill-rule="evenodd" d="M-8 -8H32V32H-8Z M${center - radius} ${center}` +
    `a${radius} ${radius} 0 1 0 ${2 * radius} 0a${radius} ${radius} 0 1 0 ${-2 * radius} 0Z"/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const HOLE = holeMask(BADGE.center, BADGE.cut)
const BADGE_AT = `${((BADGE.center - BADGE.diameter / 2) / 24) * 100}%`
const BADGE_SIZE = `${(BADGE.diameter / 24) * 100}%`

/** A harness's mark with a provider's in a hole at its bottom right. */
function BadgedIcon({
  harness,
  mark,
  className,
}: {
  harness: CodingToolId
  mark: ProviderMark
  className?: string
}) {
  return (
    <span
      className={cn('relative inline-block shrink-0', className)}
      data-tool-icon={harness}
      data-provider-mark={mark}
      aria-hidden
    >
      <span
        className="block size-full"
        style={{
          maskImage: HOLE,
          WebkitMaskImage: HOLE,
          maskSize: '100% 100%',
          WebkitMaskSize: '100% 100%',
          maskRepeat: 'no-repeat',
        }}
      >
        <ToolIcon toolId={harness} className="block size-full" />
      </span>
      <span
        className="absolute flex"
        style={{ left: BADGE_AT, top: BADGE_AT, width: BADGE_SIZE, height: BADGE_SIZE }}
      >
        <ProviderMarkIcon mark={mark} className="size-full" />
      </span>
    </span>
  )
}

/**
 * The icon of an agent, or of a session of one: its harness's mark, with the
 * mark of the provider it runs on as a badge, unless that is the harness's
 * own models or not known. A Terminal session's is the terminal's. Give it a
 * size: menus size only bare SVGs.
 */
export function AgentIcon({
  toolId,
  providerId,
  className,
}: {
  toolId: ToolId
  providerId: string | null
  className?: string
}) {
  // A string, so that the selector's result compares equal while nothing changed.
  const mark = useAppStore((state) => {
    if (toolId === 'shell' || providerId === null) return ''
    const provider = findProvider(state.providers?.providers ?? [], providerId)
    return provider === undefined || provider.own !== null ? '' : providerMark(provider)
  })
  if (toolId === 'shell' || mark === '') return <ToolIcon toolId={toolId} className={className} />
  return <BadgedIcon harness={toolId} mark={mark as ProviderMark} className={className} />
}
