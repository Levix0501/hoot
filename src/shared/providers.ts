import { CODING_TOOL_IDS, getCodingTool, type CodingToolId } from './tools'

/**
 * The ways an agent talks to a model provider: Anthropic's Messages API,
 * which Claude Code speaks, and OpenAI's Responses API, which Codex speaks.
 */
export type WireFormat = 'anthropic' | 'responses'

/**
 * The formats in which each agent can run a provider of the user's, the one
 * it takes first leading; an agent with none runs only on its own models.
 * Codex runs a provider at its Responses address alone; OpenCode at its
 * Anthropic-compatible one.
 */
export const FORMATS_OF: Readonly<Record<CodingToolId, readonly WireFormat[]>> = {
  claude: ['anthropic'],
  codex: ['responses'],
  opencode: ['anthropic'],
}

/**
 * How a provider takes its key: as a bearer token, as most do, or in
 * Anthropic's own `x-api-key` header, as Anthropic's API does.
 */
export type KeyHeader = 'bearer' | 'x-api-key'

/** The marks Hoot draws for providers; `custom` for one it does not know. */
export type ProviderMark =
  | 'ai302'
  | 'aihubmix'
  | 'anthropic'
  | 'azure'
  | 'bailian'
  | 'bedrock'
  | 'commandcode'
  | 'deepseek'
  | 'fireworks'
  | 'groq'
  | 'huaweicloud'
  | 'kimi'
  | 'minimax'
  | 'modelscope'
  | 'ollama'
  | 'openai'
  | 'opencode'
  | 'openrouter'
  | 'qwen'
  | 'siliconcloud'
  | 'stepfun'
  | 'tencentcloud'
  | 'vertexai'
  | 'volcengine'
  | 'xai'
  | 'xiaomimimo'
  | 'zai'
  | 'zhipu'
  | 'custom'

/**
 * A cloud that Claude Code reaches through its own support for it rather
 * than at an address: Amazon Bedrock with an API key, in a region; Vertex AI
 * with the machine's Google Cloud sign-in, in a region and a project.
 */
export type ProviderCloud =
  | { kind: 'bedrock'; region: string }
  | { kind: 'vertex'; region: string; project: string }

/** A plan or a region of a preset: the addresses it serves at, its models and its keys. */
export interface PresetPlan {
  id: string
  name: string
  /** Its address for each format it serves. */
  urls: Partial<Record<WireFormat, string>>
  /** The models.dev provider whose models it serves, when not the preset's. */
  catalog?: string
  /** Where it gives out keys, when not where the preset does. */
  keyUrl?: string
}

/** A provider Hoot knows, which a provider of the user's can be made from with a key. */
export interface ProviderPreset {
  id: string
  name: string
  mark: ProviderMark
  /** A maker of models serving its own, or a gateway serving many makers'. */
  group: 'vendor' | 'gateway'
  /** Its address for each format it serves, when it has no plans. */
  urls?: Partial<Record<WireFormat, string>>
  /** Its plans or regions, each at addresses of its own, the first the one picked at first. */
  plans?: readonly PresetPlan[]
  /** What its plans are: plans, or regions. */
  planLabel?: 'Plan' | 'Region'
  /** The models.dev provider whose models it serves (see `ModelCatalogs`). */
  catalog: string
  keyHeader: KeyHeader
  /** Where it gives out keys. */
  keyUrl: string
  /** Other names it is searched by, such as its name in Chinese. */
  aliases?: readonly string[]
  /**
   * It is reached at the user's own resource, whose address this is an
   * example of, its Responses API under `AZURE_PATH`.
   */
  endpoint?: string
  /** Claude Code reaches it through the cloud's own support (see `ProviderCloud`). */
  cloud?: ProviderCloud['kind']
}

/** Where an Azure OpenAI resource serves the Responses API, under its endpoint. */
export const AZURE_PATH = '/openai/v1'

const BEDROCK_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'eu-central-1',
  'eu-west-1',
  'eu-west-3',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
]

/** Vertex AI's regions that serve the current Claude models: everywhere, and the US's and the EU's. */
const VERTEX_REGIONS = ['global', 'us', 'eu']

function regions(
  ids: readonly string[],
  urls: (id: string) => Partial<Record<WireFormat, string>>,
): PresetPlan[] {
  return ids.map((id) => ({ id, name: id, urls: urls(id) }))
}

/**
 * The providers Hoot knows, by name, a maker of models or a gateway, with the
 * addresses their documentation gives for Claude Code and Codex (November
 * 2026): those that serve an Anthropic-compatible API or OpenAI's Responses
 * API and whose models models.dev lists.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: '302ai',
    name: '302.AI',
    mark: 'ai302',
    group: 'gateway',
    urls: { anthropic: 'https://api.302.ai', responses: 'https://api.302.ai/v1' },
    catalog: '302ai',
    keyHeader: 'bearer',
    keyUrl: 'https://302.ai/api-keys/list',
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    mark: 'aihubmix',
    group: 'gateway',
    urls: { anthropic: 'https://aihubmix.com', responses: 'https://aihubmix.com/v1' },
    catalog: 'aihubmix',
    keyHeader: 'bearer',
    keyUrl: 'https://console.aihubmix.com/workspaces/default/keys',
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    mark: 'bedrock',
    group: 'vendor',
    cloud: 'bedrock',
    aliases: ['aws', 'amazon'],
    planLabel: 'Region',
    plans: regions(BEDROCK_REGIONS, (region) => ({
      anthropic: `https://bedrock-runtime.${region}.amazonaws.com/anthropic`,
      responses: `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`,
    })),
    catalog: 'amazon-bedrock',
    keyHeader: 'x-api-key',
    keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    mark: 'anthropic',
    group: 'vendor',
    aliases: ['claude'],
    urls: { anthropic: 'https://api.anthropic.com' },
    catalog: 'anthropic',
    keyHeader: 'x-api-key',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    mark: 'azure',
    group: 'vendor',
    aliases: ['microsoft'],
    endpoint: 'https://<resource>.openai.azure.com',
    catalog: 'azure',
    keyHeader: 'bearer',
    keyUrl: 'https://ai.azure.com',
  },
  {
    id: 'bailian-plan',
    name: 'Bailian Plan',
    mark: 'bailian',
    group: 'vendor',
    aliases: ['百炼', '阿里', 'alibaba', 'aliyun', 'token plan'],
    urls: {
      anthropic: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
      responses: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    },
    catalog: 'alibaba-token-plan-cn',
    keyHeader: 'bearer',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal',
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    mark: 'commandcode',
    group: 'gateway',
    urls: {
      anthropic: 'https://api.commandcode.ai/provider',
      responses: 'https://api.commandcode.ai/provider/v1',
    },
    catalog: 'commandcode',
    keyHeader: 'bearer',
    keyUrl: 'https://commandcode.ai/settings/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    mark: 'deepseek',
    group: 'vendor',
    aliases: ['深度求索'],
    urls: {
      anthropic: 'https://api.deepseek.com/anthropic',
      responses: 'https://api.deepseek.com',
    },
    catalog: 'deepseek',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    mark: 'fireworks',
    group: 'gateway',
    urls: {
      anthropic: 'https://api.fireworks.ai/inference',
      responses: 'https://api.fireworks.ai/inference/v1',
    },
    catalog: 'fireworks-ai',
    keyHeader: 'bearer',
    keyUrl: 'https://app.fireworks.ai/settings/users/api-keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    mark: 'groq',
    group: 'vendor',
    urls: { responses: 'https://api.groq.com/openai/v1' },
    catalog: 'groq',
    keyHeader: 'bearer',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'huaweicloud',
    name: 'Huawei Cloud',
    mark: 'huaweicloud',
    group: 'vendor',
    aliases: ['华为', 'huawei', 'maas'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'plan',
        name: 'Token Plan',
        urls: { anthropic: 'https://api.modelarts-maas.com/plan/anthropic' },
      },
      {
        id: 'api',
        name: 'Pay as you go',
        urls: { anthropic: 'https://api.modelarts-maas.com/anthropic' },
      },
    ],
    catalog: 'huawei-maas',
    keyHeader: 'bearer',
    keyUrl: 'https://console.huaweicloud.com/maas/?#/model-studio/authmanage',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    mark: 'kimi',
    group: 'vendor',
    aliases: ['moonshot', '月之暗面'],
    planLabel: 'Region',
    plans: [
      {
        id: 'cn',
        name: 'China',
        urls: {
          anthropic: 'https://api.moonshot.cn/anthropic',
          responses: 'https://api.moonshot.cn/v1',
        },
        catalog: 'moonshotai-cn',
      },
      {
        id: 'global',
        name: 'Global',
        urls: {
          anthropic: 'https://api.moonshot.ai/anthropic',
          responses: 'https://api.moonshot.ai/v1',
        },
        catalog: 'moonshotai',
        keyUrl: 'https://platform.kimi.ai/console/api-keys',
      },
    ],
    catalog: 'moonshotai-cn',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Code',
    mark: 'kimi',
    group: 'vendor',
    aliases: ['kimi for coding', 'moonshot', '月之暗面'],
    planLabel: 'Region',
    plans: [
      {
        id: 'cn',
        name: 'China',
        urls: {
          anthropic: 'https://api.kimi.com/coding/',
          responses: 'https://api.kimi.com/coding/v1',
        },
        catalog: 'kimi-code-plan-cn',
      },
      {
        id: 'global',
        name: 'Global',
        urls: {
          anthropic: 'https://api.kimi.ai/coding/',
          responses: 'https://api.kimi.ai/coding/v1',
        },
        catalog: 'kimi-code-plan-global',
      },
    ],
    catalog: 'kimi-code-plan-cn',
    keyHeader: 'x-api-key',
    keyUrl: 'https://www.kimi.com/code/console',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    mark: 'minimax',
    group: 'vendor',
    aliases: ['海螺', 'hailuo'],
    planLabel: 'Region',
    plans: [
      {
        id: 'cn',
        name: 'China',
        urls: {
          anthropic: 'https://api.minimax.cn/anthropic',
          responses: 'https://api.minimax.cn/v1',
        },
        catalog: 'minimax-cn',
      },
      {
        id: 'global',
        name: 'Global',
        urls: {
          anthropic: 'https://api.minimax.io/anthropic',
          responses: 'https://api.minimax.io/v1',
        },
        catalog: 'minimax',
        keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
      },
    ],
    catalog: 'minimax-cn',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.minimax.cn/user-center/basic-information/interface-key',
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    mark: 'modelscope',
    group: 'gateway',
    aliases: ['魔搭'],
    urls: {
      anthropic: 'https://api-inference.modelscope.cn',
      responses: 'https://api-inference.modelscope.cn/v1',
    },
    catalog: 'modelscope',
    keyHeader: 'x-api-key',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    mark: 'ollama',
    group: 'vendor',
    aliases: ['ollama'],
    urls: { anthropic: 'https://ollama.com', responses: 'https://ollama.com/v1' },
    catalog: 'ollama-cloud',
    keyHeader: 'bearer',
    keyUrl: 'https://ollama.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    mark: 'openai',
    group: 'vendor',
    aliases: ['gpt'],
    urls: { responses: 'https://api.openai.com/v1' },
    catalog: 'openai',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.openai.com/settings/organization/api-keys',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    mark: 'opencode',
    group: 'gateway',
    urls: {
      anthropic: 'https://opencode.ai/inference/go/anthropic',
      responses: 'https://opencode.ai/inference/go/openai/v1',
    },
    catalog: 'opencode-go',
    keyHeader: 'bearer',
    keyUrl: 'https://opencode.ai/auth',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    mark: 'opencode',
    group: 'gateway',
    aliases: ['opencode console'],
    urls: {
      anthropic: 'https://opencode.ai/inference/anthropic',
      responses: 'https://opencode.ai/inference/openai/v1',
    },
    catalog: 'opencode',
    keyHeader: 'bearer',
    keyUrl: 'https://opencode.ai/auth',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    mark: 'openrouter',
    group: 'gateway',
    urls: { anthropic: 'https://openrouter.ai/api', responses: 'https://openrouter.ai/api/v1' },
    catalog: 'openrouter',
    keyHeader: 'bearer',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    mark: 'qwen',
    group: 'vendor',
    aliases: ['通义', '千问', 'dashscope', 'alibaba', '阿里'],
    planLabel: 'Region',
    plans: [
      {
        id: 'cn',
        name: 'China',
        urls: {
          anthropic: 'https://dashscope.aliyuncs.com/apps/anthropic',
          responses: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
        catalog: 'alibaba-cn',
      },
      {
        id: 'intl',
        name: 'Global',
        urls: {
          anthropic: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
          responses: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        },
        catalog: 'alibaba',
        keyUrl: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key',
      },
    ],
    catalog: 'alibaba-cn',
    keyHeader: 'bearer',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
  },
  {
    id: 'qwen-plan',
    name: 'Qwen Plan',
    mark: 'qwen',
    group: 'vendor',
    aliases: ['千问', 'qianwen', 'token plan'],
    urls: {
      anthropic: 'https://token-plan.maas.qianwenaiapi.com/apps/anthropic',
      responses: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1',
    },
    catalog: 'alibaba-token-plan-cn',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.qianwenai.com/home/analytics/token-plan/individual',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    mark: 'siliconcloud',
    group: 'gateway',
    aliases: ['硅基流动', 'siliconcloud'],
    planLabel: 'Region',
    plans: [
      {
        id: 'cn',
        name: 'China',
        urls: { anthropic: 'https://api.siliconflow.cn' },
        catalog: 'siliconflow-cn',
      },
      {
        id: 'intl',
        name: 'Global',
        urls: { anthropic: 'https://api.siliconflow.com' },
        catalog: 'siliconflow',
        keyUrl: 'https://cloud.siliconflow.com/account/ak',
      },
    ],
    catalog: 'siliconflow-cn',
    keyHeader: 'x-api-key',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    mark: 'stepfun',
    group: 'vendor',
    aliases: ['阶跃星辰'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'plan-cn',
        name: 'Step Plan · China',
        urls: {
          anthropic: 'https://api.stepfun.com/step_plan',
          responses: 'https://api.stepfun.com/step_plan/v1',
        },
        catalog: 'stepfun-step-plan',
      },
      {
        id: 'plan-global',
        name: 'Step Plan · Global',
        urls: {
          anthropic: 'https://api.stepfun.ai/step_plan',
          responses: 'https://api.stepfun.ai/step_plan/v1',
        },
        catalog: 'stepfun-ai-step-plan',
        keyUrl: 'https://platform.stepfun.ai/interface-key',
      },
      {
        id: 'api-cn',
        name: 'Pay as you go · China',
        urls: { anthropic: 'https://api.stepfun.com', responses: 'https://api.stepfun.com/v1' },
        catalog: 'stepfun',
      },
      {
        id: 'api-global',
        name: 'Pay as you go · Global',
        urls: { anthropic: 'https://api.stepfun.ai', responses: 'https://api.stepfun.ai/v1' },
        catalog: 'stepfun-ai',
        keyUrl: 'https://platform.stepfun.ai/interface-key',
      },
    ],
    catalog: 'stepfun-step-plan',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.stepfun.com/interface-key',
  },
  {
    id: 'tencent-cloud',
    name: 'Tencent Cloud',
    mark: 'tencentcloud',
    group: 'vendor',
    aliases: ['腾讯', '混元', 'hunyuan', 'tokenhub'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'plan',
        name: 'Token Plan · China',
        urls: {
          anthropic: 'https://tokenhub.tencentmaas.com/plan/anthropic',
          responses: 'https://tokenhub.tencentmaas.com/plan/v3',
        },
        catalog: 'tencent-token-plan',
      },
      {
        id: 'cn',
        name: 'Pay as you go · China',
        urls: {
          anthropic: 'https://tokenhub.tencentmaas.com',
          responses: 'https://tokenhub.tencentmaas.com/v1',
        },
        catalog: 'tencent-tokenhub',
        keyUrl: 'https://console.cloud.tencent.com/tokenhub/apikey',
      },
      {
        id: 'intl',
        name: 'Pay as you go · Global',
        urls: {
          anthropic: 'https://tokenhub-intl.tencentcloudmaas.com',
          responses: 'https://tokenhub-intl.tencentcloudmaas.com/v1',
        },
        catalog: 'tencent-tokenhub',
        keyUrl: 'https://console.tencentcloud.com/tokenhub/apikey',
      },
      {
        id: 'enterprise-intl',
        name: 'Enterprise plan · Global',
        urls: {
          anthropic: 'https://tokenhub-intl.tencentmaas.com/plan/anthropic',
          responses: 'https://tokenhub-intl.tencentmaas.com/plan/v3',
        },
        catalog: 'tencent-token-plan',
        keyUrl: 'https://console.cloud.tencent.com/tokenhub/tokenplan-e',
      },
    ],
    catalog: 'tencent-token-plan',
    keyHeader: 'bearer',
    keyUrl: 'https://console.cloud.tencent.com/tokenhub/tokenplan',
  },
  {
    id: 'vertex',
    name: 'Vertex AI',
    mark: 'vertexai',
    group: 'vendor',
    cloud: 'vertex',
    aliases: ['google', 'gcp', 'google cloud'],
    planLabel: 'Region',
    plans: regions(VERTEX_REGIONS, () => ({})),
    catalog: 'google-vertex-anthropic',
    keyHeader: 'bearer',
    keyUrl: 'https://console.cloud.google.com/vertex-ai/model-garden',
  },
  {
    id: 'doubao',
    name: 'Volcengine Ark',
    mark: 'volcengine',
    group: 'vendor',
    aliases: ['火山', '方舟', 'doubao', '豆包', 'bytedance', '字节'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        urls: {
          anthropic: 'https://ark.cn-beijing.volces.com/api/coding',
          responses: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        },
      },
      {
        id: 'agent',
        name: 'Agent Plan',
        urls: {
          anthropic: 'https://ark.cn-beijing.volces.com/api/plan',
          responses: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        },
        keyUrl: 'https://ark.volcengine.com/region:cn-beijing/subscription/agent-plan',
      },
      {
        id: 'api',
        name: 'Pay as you go',
        urls: {
          anthropic: 'https://ark.cn-beijing.volces.com/api/compatible',
          responses: 'https://ark.cn-beijing.volces.com/api/v3',
        },
        catalog: 'volcengine',
      },
    ],
    catalog: 'volcengine-coding-plan',
    keyHeader: 'bearer',
    keyUrl: 'https://ark.volcengine.com/region:cn-beijing/apikey',
  },
  {
    id: 'xai',
    name: 'xAI',
    mark: 'xai',
    group: 'vendor',
    aliases: ['grok'],
    urls: { responses: 'https://api.x.ai/v1' },
    catalog: 'xai',
    keyHeader: 'bearer',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    mark: 'xiaomimimo',
    group: 'vendor',
    aliases: ['小米', 'mimo'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'api',
        name: 'Pay as you go',
        urls: {
          anthropic: 'https://api.xiaomimimo.com/anthropic',
          responses: 'https://api.xiaomimimo.com/v1',
        },
      },
      {
        id: 'plan-cn',
        name: 'Token Plan · China',
        urls: {
          anthropic: 'https://token-plan-cn.xiaomimimo.com/anthropic',
          responses: 'https://token-plan-cn.xiaomimimo.com/v1',
        },
        catalog: 'xiaomi-token-plan-cn',
        keyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
      },
      {
        id: 'plan-sgp',
        name: 'Token Plan · Singapore',
        urls: {
          anthropic: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
          responses: 'https://token-plan-sgp.xiaomimimo.com/v1',
        },
        catalog: 'xiaomi-token-plan-sgp',
        keyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
      },
      {
        id: 'plan-ams',
        name: 'Token Plan · Europe',
        urls: {
          anthropic: 'https://token-plan-ams.xiaomimimo.com/anthropic',
          responses: 'https://token-plan-ams.xiaomimimo.com/v1',
        },
        catalog: 'xiaomi-token-plan-ams',
        keyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
      },
    ],
    catalog: 'xiaomi',
    keyHeader: 'bearer',
    keyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
  },
  {
    id: 'zai',
    name: 'Z.ai',
    mark: 'zai',
    group: 'vendor',
    aliases: ['glm', 'zhipu'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        urls: { anthropic: 'https://api.z.ai/api/anthropic', responses: 'https://api.z.ai/api/v1' },
      },
      {
        id: 'api',
        name: 'Pay as you go',
        urls: { anthropic: 'https://api.z.ai/api/anthropic', responses: 'https://api.z.ai/api/v1' },
        catalog: 'zai',
      },
    ],
    catalog: 'zai-coding-plan',
    keyHeader: 'bearer',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    mark: 'zhipu',
    group: 'vendor',
    aliases: ['智谱', 'bigmodel', 'glm'],
    planLabel: 'Plan',
    plans: [
      {
        id: 'coding',
        name: 'Coding Plan',
        urls: {
          anthropic: 'https://open.bigmodel.cn/api/anthropic',
          responses: 'https://open.bigmodel.cn/api/v1',
        },
        keyUrl: 'https://bigmodel.cn/coding-plan/personal/overview',
      },
      {
        id: 'api',
        name: 'Pay as you go',
        urls: {
          anthropic: 'https://open.bigmodel.cn/api/anthropic',
          responses: 'https://open.bigmodel.cn/api/v1',
        },
        catalog: 'zhipuai',
      },
    ],
    catalog: 'zhipuai-coding-plan',
    keyHeader: 'bearer',
    keyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
]

export function presetById(id: string | null): ProviderPreset | undefined {
  return id === null ? undefined : PROVIDER_PRESETS.find((preset) => preset.id === id)
}

/** A preset's plans: its own, else the one it is without any, under its id. */
export function presetPlans(preset: ProviderPreset): readonly PresetPlan[] {
  return preset.plans ?? [{ id: preset.id, name: preset.name, urls: preset.urls ?? {} }]
}

/** A preset's plan: the one of that id, else its first. */
export function presetPlan(preset: ProviderPreset, planId: string | null): PresetPlan {
  const plans = presetPlans(preset)
  return plans.find((plan) => plan.id === planId) ?? plans[0]!
}

/** The models.dev provider whose models a preset's plan serves. */
export function planCatalog(preset: ProviderPreset, plan: PresetPlan): string {
  return plan.catalog ?? preset.catalog
}

/**
 * Whether an agent can run a preset's plan: Claude Code a cloud's through
 * its own support for it, an agent at an address it serves in a format the
 * agent speaks, Codex Azure's at the user's resource.
 */
export function planRuns(preset: ProviderPreset, plan: PresetPlan, harness: CodingToolId): boolean {
  if (preset.cloud !== undefined && harness === 'claude') return true
  if (preset.endpoint !== undefined) return FORMATS_OF[harness].includes('responses')
  return FORMATS_OF[harness].some((format) => (plan.urls[format] ?? '').trim() !== '')
}

/** The agents that can run a preset at one of its plans, in the order of `CODING_TOOL_IDS`. */
export function presetHarnesses(preset: ProviderPreset): CodingToolId[] {
  return CODING_TOOL_IDS.filter((harness) =>
    presetPlans(preset).some((plan) => planRuns(preset, plan, harness)),
  )
}

function sameUrls(
  a: Partial<Record<WireFormat, string>>,
  b: Partial<Record<WireFormat, string>>,
): boolean {
  return (['anthropic', 'responses'] as const).every(
    (format) => trimUrl(a[format] ?? '') === trimUrl(b[format] ?? ''),
  )
}

/**
 * The preset a provider of the user's was made from and the plan it is on:
 * the one it names; else, for one made before plans, a cloud's by its
 * region, Azure's the one it has, another's the one whose addresses its
 * are; none for a provider whose addresses no plan has.
 */
export function providerPlan(
  provider: Pick<Provider, 'presetId' | 'planId' | 'urls' | 'cloud'>,
): { preset: ProviderPreset; plan: PresetPlan } | undefined {
  const preset = presetById(provider.presetId)
  if (preset === undefined) return undefined
  const plans = presetPlans(preset)
  const cloud = provider.cloud
  const plan =
    plans.find((candidate) => candidate.id === provider.planId) ??
    (cloud !== null
      ? plans.find((candidate) => candidate.id === cloud.region)
      : preset.endpoint !== undefined
        ? plans[0]
        : plans.find((candidate) => sameUrls(candidate.urls, provider.urls)))
  return plan === undefined ? undefined : { preset, plan }
}

/** The id a provider keeps of its preset's plan: `null` for a preset without plans. */
export function planIdOf(preset: ProviderPreset, plan: PresetPlan): string | null {
  return preset.plans === undefined ? null : plan.id
}

/** A model a models.dev provider lists, as Hoot keeps it: its id and how many tokens of context it takes. */
export interface CatalogModel {
  id: string
  context: number | null
}

/**
 * The models of the models.dev providers Hoot's presets name, each newest
 * first: those still served that call tools and answer in text, which a
 * coding agent can run.
 */
export type ModelCatalogs = Readonly<Record<string, readonly CatalogModel[]>>

/** The ids of a models.dev provider's models; none for one the catalogs lack. */
export function catalogModelIds(catalogs: ModelCatalogs, catalog: string | null): string[] {
  return catalog === null ? [] : (catalogs[catalog] ?? []).map((model) => model.id)
}

/** Up to this many, a provider's models are all picked as it is made; past it, none are. */
export const ALL_PICKED_UP_TO = 12

/** The models picked as a provider is made, before the user picks: a short list whole, a long one none of. */
export function firstPicks(models: readonly string[]): string[] {
  return models.length <= ALL_PICKED_UP_TO ? [...models] : []
}

/**
 * A model provider: one of the user's, with a key, or an agent's own models,
 * which the agent reaches by its own sign-in, or has bundled, without a key.
 */
export interface Provider {
  id: string
  name: string
  /** The preset it was made from, which gives its mark; `null` for one Hoot does not know. */
  presetId: string | null
  /**
   * The plan or region of its preset it is on; `null` for a preset without
   * plans, and for one made before plans, whose addresses tell its plan.
   */
  planId: string | null
  /** Kept as the agents' own configuration files keep it, in plain text. */
  apiKey: string
  keyHeader: KeyHeader
  /** Its address for each format it serves. */
  urls: Partial<Record<WireFormat, string>>
  /** Its models, which its agents offer, the one a new agent takes first leading. */
  models: string[]
  /** The cloud Claude Code reaches it through, in place of an address; `null` for none. */
  cloud: ProviderCloud | null
  /** For an agent's own models, that agent, the only one that can run them; `null` otherwise. */
  own: CodingToolId | null
}

/** The ids of the agents' own models, which are no provider of the user's. */
export const OWN_PROVIDER_IDS: Readonly<Record<CodingToolId, string>> = {
  claude: 'claude-subscription',
  codex: 'chatgpt-subscription',
  opencode: 'opencode-free',
}

const OWN_PROVIDER_NAMES: Readonly<Record<CodingToolId, string>> = {
  claude: 'Claude subscription',
  codex: 'ChatGPT subscription',
  opencode: 'OpenCode free models',
}

/** An agent's own models: its subscription, or for OpenCode, the free models it comes with. */
export function ownProvider(harness: CodingToolId): Provider {
  return {
    id: OWN_PROVIDER_IDS[harness],
    name: OWN_PROVIDER_NAMES[harness],
    presetId: null,
    planId: null,
    apiKey: '',
    keyHeader: 'bearer',
    urls: {},
    models: [],
    cloud: null,
    own: harness,
  }
}

/** The model OpenCode's free models start with, when none is picked. */
export const OPENCODE_DEFAULT_FREE_MODEL = 'big-pickle'

/**
 * OpenCode's id of a provider, under which Hoot writes one of the user's into
 * OpenCode's own configuration: `opencode` for its free models.
 */
export function openCodeProviderId(provider: Pick<Provider, 'id' | 'own'>): string {
  return provider.own === 'opencode' ? 'opencode' : `hoot-${provider.id}`
}

/** The provider of Hoot's that OpenCode's id stands for; `null` for one that is not Hoot's. */
export function providerOfOpenCodeId(openCodeId: string): string | null {
  if (openCodeId === 'opencode') return OWN_PROVIDER_IDS.opencode
  return openCodeId.startsWith('hoot-') && openCodeId.length > 5 ? openCodeId.slice(5) : null
}

/**
 * A model as OpenCode and Codex take it: without the mark at its end that
 * tells Claude Code its context, such as `[1m]`.
 */
export function bareModel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '')
}

/**
 * The effort levels each agent offers on a provider of the user's: none for
 * Claude Code, whose levels other providers' models do not tell; for Codex,
 * those every provider Hoot knows takes; for OpenCode, the variants it gives
 * a model at an Anthropic-compatible address.
 */
export const PROVIDER_EFFORTS: Readonly<Record<CodingToolId, readonly string[]>> = {
  claude: [],
  codex: ['low', 'high'],
  opencode: ['low', 'medium', 'high'],
}

/** Whether an agent's own models need it signed in: OpenCode's free ones do not. */
export function ownNeedsSignIn(harness: CodingToolId): boolean {
  return harness !== 'opencode'
}

/** The mark Hoot draws for a provider. */
export function providerMark(provider: Pick<Provider, 'presetId' | 'own'>): ProviderMark {
  switch (provider.own) {
    case 'claude':
      return 'anthropic'
    case 'codex':
      return 'openai'
    case 'opencode':
      return 'opencode'
    case null:
      return presetById(provider.presetId)?.mark ?? 'custom'
  }
}

/** An address without the spaces around it and the slashes at its end, as addresses compare. */
export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** The address an agent runs a provider at: the first of the formats it speaks that the provider serves. */
export function providerUrl(provider: Provider, harness: CodingToolId): string {
  for (const format of FORMATS_OF[harness]) {
    const url = (provider.urls[format] ?? '').trim()
    if (url !== '') return url
  }
  return ''
}

/** Whether an agent can run a provider: Claude Code a cloud's, any at an address it takes. */
export function canRun(provider: Provider, harness: CodingToolId): boolean {
  if (provider.own !== null) return provider.own === harness
  if (provider.cloud !== null && harness === 'claude') return true
  return providerUrl(provider, harness) !== ''
}

/** The agents that can run a provider, in the order of `CODING_TOOL_IDS`. */
export function harnessesOf(provider: Provider): CodingToolId[] {
  return CODING_TOOL_IDS.filter((harness) => canRun(provider, harness))
}

/**
 * An agent of Hoot's: a coding tool, its harness, run on a provider's model.
 * The new session menus list those turned on.
 */
export interface Agent {
  id: string
  harness: CodingToolId
  providerId: string
  /** The name the user gave it; `null` for the one made from its provider. */
  name: string | null
  /** Whether the new session menus list it. */
  enabled: boolean
  /** The model its sessions start with; `null` for the harness's default. */
  model: string | null
  /** The effort level its sessions start with; `null` for the harness's default. */
  effort: string | null
  /** Arguments added to the end of its sessions' own arguments, in order. */
  extraArgs: string[]
  /** Milliseconds since the Unix epoch, when it was made, which orders the agents. */
  createdAt: number
}

/** An agent to make: what its maker picks; it starts turned on, with no effort or extra arguments. */
export interface NewAgent {
  harness: CodingToolId
  providerId: string
  model: string | null
  name?: string | null
}

/**
 * What changes about an agent; what is left out stays as it is. Its chats
 * keep the provider they began on.
 */
export interface AgentChange {
  providerId?: string
  name?: string | null
  enabled?: boolean
  model?: string | null
  effort?: string | null
  extraArgs?: string[]
}

/** An agent with a change applied: a blank name or model is none. */
export function withAgentChange(agent: Agent, change: AgentChange): Agent {
  return {
    ...agent,
    ...(change.providerId === undefined ? {} : { providerId: change.providerId }),
    ...(change.name === undefined ? {} : { name: change.name?.trim() || null }),
    ...(change.enabled === undefined ? {} : { enabled: change.enabled }),
    ...(change.model === undefined ? {} : { model: change.model?.trim() || null }),
    ...(change.effort === undefined ? {} : { effort: change.effort }),
    ...(change.extraArgs === undefined ? {} : { extraArgs: [...change.extraArgs] }),
  }
}

/** A provider to make: what the Providers page asks for. */
export interface NewProvider {
  name: string
  presetId: string | null
  planId: string | null
  apiKey: string
  keyHeader: KeyHeader
  urls: Partial<Record<WireFormat, string>>
  models: string[]
  cloud: ProviderCloud | null
}

/** What changes about a provider; what is left out stays as it is. */
export type ProviderChange = Partial<NewProvider>

/**
 * The harnesses whose own configuration Hoot reads for their global, the
 * provider they run on outside Hoot, and writes when that is changed here:
 * Codex and OpenCode. Claude Code's own settings are left alone: Hoot
 * neither reads a global from them nor writes them, and makes no agent of
 * them, its Claude Code agents being made by hand.
 */
export const GLOBAL_HARNESSES = ['codex', 'opencode'] as const satisfies readonly CodingToolId[]

/** A harness whose own configuration names its global (see `GLOBAL_HARNESSES`). */
export type GlobalHarness = (typeof GLOBAL_HARNESSES)[number]

/** Whether a harness's own configuration names its global (see `GLOBAL_HARNESSES`). */
export function isGlobalHarness(harness: CodingToolId): harness is GlobalHarness {
  return GLOBAL_HARNESSES.some((global) => global === harness)
}

/**
 * What an agent's own configuration names, as Hoot reads it: the provider
 * that agent runs on outside Hoot, and the model.
 */
export interface HarnessGlobal {
  /** One of the user's providers, or the agent's own models. */
  providerId: string
  /** The model it names; `null` when it names none. */
  model: string | null
  /** For its own models, whether it is signed in to them; OpenCode's free models need no sign-in. */
  signedIn: boolean
}

/** The providers and agents, and each installed agent's global, as the window shows them. */
export interface ProvidersState {
  /** The user's providers, in the order they were made; the agents' own are not among them. */
  providers: Provider[]
  /** In the order they were made. */
  agents: Agent[]
  /**
   * For each installed harness of `GLOBAL_HARNESSES` Hoot read the
   * configuration of, what it names; never Claude Code.
   */
  globals: Partial<Record<CodingToolId, HarnessGlobal>>
  /**
   * Whether Hoot has read the installed harnesses' configurations since it
   * opened, and made the agents it makes as it opens.
   */
  ready: boolean
}

/** A provider by id: one of the user's, or an agent's own models. */
export function findProvider(providers: readonly Provider[], id: string): Provider | undefined {
  const harness = CODING_TOOL_IDS.find((candidate) => OWN_PROVIDER_IDS[candidate] === id)
  return harness === undefined
    ? providers.find((provider) => provider.id === id)
    : ownProvider(harness)
}

/**
 * The name an agent shows: the one the user gave it; else, on the harness's
 * own models, the harness's name; else its provider's, with its model when
 * another agent of the harness runs the same provider.
 */
export function agentName(
  agent: Agent,
  state: Pick<ProvidersState, 'providers' | 'agents'>,
): string {
  if (agent.name !== null && agent.name.trim() !== '') return agent.name.trim()
  const provider = findProvider(state.providers, agent.providerId)
  if (provider === undefined) return getCodingTool(agent.harness).label
  if (provider.own !== null) return getCodingTool(agent.harness).label
  const shared = state.agents.some(
    (other) =>
      other.id !== agent.id &&
      other.harness === agent.harness &&
      other.providerId === agent.providerId &&
      (other.name === null || other.name.trim() === ''),
  )
  return shared ? `${provider.name} · ${agent.model ?? 'Default'}` : provider.name
}

/**
 * The agents a new session can start with: those turned on whose harness is
 * installed and whose provider is there and runs on it, grouped by harness in
 * the order of `CODING_TOOL_IDS`, each harness's in the order they were made.
 */
export function usableAgents(
  state: Pick<ProvidersState, 'providers' | 'agents'>,
  installed: (harness: CodingToolId) => boolean,
): Agent[] {
  return CODING_TOOL_IDS.flatMap((harness) =>
    installed(harness)
      ? state.agents.filter((agent) => {
          if (agent.harness !== harness || !agent.enabled) return false
          const provider = findProvider(state.providers, agent.providerId)
          return provider !== undefined && canRun(provider, harness)
        })
      : [],
  )
}

/**
 * The agent a new session starts with: the one asked for while it is usable,
 * else the default agent while it is, else the first usable one; `null` when
 * none is.
 */
export function sessionAgent(
  usable: readonly Agent[],
  defaultAgent: string | null,
  asked: string | null = null,
): Agent | null {
  return (
    usable.find((agent) => agent.id === asked) ??
    usable.find((agent) => agent.id === defaultAgent) ??
    usable[0] ??
    null
  )
}

/**
 * The agent work on an issue starts with, which Claude Code alone is sent:
 * the default agent while it is a usable Claude Code agent, else the first
 * usable Claude Code agent; `null` when there is none.
 */
export function issueAgent(usable: readonly Agent[], defaultAgent: string | null): Agent | null {
  const claude = usable.filter((agent) => agent.harness === 'claude')
  return claude.find((agent) => agent.id === defaultAgent) ?? claude[0] ?? null
}

/**
 * What a harness's own configuration says of its provider: the address and
 * the key, empty where it gives none, how it sends the key, and the model,
 * which is the harness's own setting, not the provider's.
 */
export interface GlobalConfig {
  url: string
  apiKey: string
  keyHeader: KeyHeader
  model: string | null
}

/**
 * Whether a harness's configuration names this provider: one of its addresses
 * and its key, or for its own models, neither. The model does not count.
 */
export function namesProvider(
  provider: Provider,
  harness: CodingToolId,
  config: GlobalConfig,
): boolean {
  if (!canRun(provider, harness)) return false
  if (provider.own !== null) return trimUrl(config.url) === '' && config.apiKey === ''
  const url = trimUrl(config.url)
  return (
    url !== '' &&
    FORMATS_OF[harness].some((format) => trimUrl(provider.urls[format] ?? '') === url) &&
    provider.apiKey === config.apiKey
  )
}

/** The preset and plan one of whose addresses, in one of a harness's formats, an address is. */
export function presetPlanOfUrl(
  url: string,
  harness: CodingToolId,
): { preset: ProviderPreset; plan: PresetPlan } | undefined {
  const wanted = trimUrl(url)
  if (wanted === '') return undefined
  for (const preset of PROVIDER_PRESETS) {
    for (const plan of presetPlans(preset)) {
      const urls = plan.urls
      if (FORMATS_OF[harness].some((format) => trimUrl(urls[format] ?? '') === wanted)) {
        return { preset, plan }
      }
    }
  }
  return undefined
}

/** A name no provider has yet: `base`, else `base` with 2, 3, … after it. */
export function freeProviderName(providers: readonly Provider[], base: string): string {
  const taken = new Set(providers.map((provider) => provider.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null
  } catch {
    return null
  }
}

/**
 * The provider to make of a harness's configuration that names none of the
 * user's: the preset and plan of its address, with the plan's other
 * addresses and the models picked of its catalog at first (see
 * `firstPicks`), the configuration's model first; otherwise one named after
 * the address's host.
 */
export function providerFromConfig(
  providers: readonly Provider[],
  harness: CodingToolId,
  config: GlobalConfig,
  catalogs: ModelCatalogs,
): NewProvider {
  const found = presetPlanOfUrl(config.url, harness)
  const models = found
    ? firstPicks(catalogModelIds(catalogs, planCatalog(found.preset, found.plan)))
    : []
  if (config.model !== null && config.model !== '' && !models.includes(config.model)) {
    models.unshift(config.model)
  }
  const format = FORMATS_OF[harness][0] ?? 'anthropic'
  return {
    name: freeProviderName(providers, found?.preset.name ?? hostOf(config.url) ?? 'Custom'),
    presetId: found?.preset.id ?? null,
    planId: found ? planIdOf(found.preset, found.plan) : null,
    apiKey: config.apiKey,
    keyHeader: config.keyHeader,
    urls: found ? { ...found.plan.urls } : { [format]: config.url.trim() },
    models,
    cloud: null,
  }
}

/**
 * The provider a harness's configuration names: the global it has already
 * when that is still it, else the first of the user's that it names, else
 * none, and a new one must be made of it.
 */
export function providerNamed(
  providers: readonly Provider[],
  harness: CodingToolId,
  config: GlobalConfig,
  current: string | null,
): Provider | null {
  const candidates = [ownProvider(harness), ...providers]
  const kept = candidates.find((provider) => provider.id === current)
  if (kept !== undefined && namesProvider(kept, harness, config)) return kept
  return candidates.find((provider) => namesProvider(provider, harness, config)) ?? null
}

/**
 * Whether a harness has a global, which a new agent can be made of: a
 * provider of the user's that it can run, or its own models while it is
 * signed in to them where they need it.
 */
export function hasGlobal(
  state: Pick<ProvidersState, 'providers' | 'globals'>,
  harness: CodingToolId,
): boolean {
  const global = state.globals[harness]
  if (global === undefined) return false
  const provider = findProvider(state.providers, global.providerId)
  if (provider === undefined || !canRun(provider, harness)) return false
  return provider.own === null || !ownNeedsSignIn(harness) || global.signedIn
}

/**
 * The agents to make as Hoot opens, or as harnesses get installed: one for
 * each of `harnesses` that is installed, has a global and has no agent, on
 * that global's provider and model, as one made by hand would be.
 */
export function agentsToMake(
  state: Pick<ProvidersState, 'providers' | 'agents' | 'globals'>,
  harnesses: readonly CodingToolId[],
): NewAgent[] {
  return harnesses.flatMap((harness) => {
    if (state.agents.some((agent) => agent.harness === harness)) return []
    if (!hasGlobal(state, harness)) return []
    const global = state.globals[harness]!
    return [{ harness, providerId: global.providerId, model: global.model }]
  })
}

/** The models an agent on a provider offers, besides the harness's default. */
export function providerModels(provider: Provider | undefined): string[] {
  return provider === undefined || provider.own !== null ? [] : provider.models
}

/** The key as the Providers page shows it: its first characters and its last four. */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed === '') return ''
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`
}
