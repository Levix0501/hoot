import { CODING_TOOL_IDS, getCodingTool, normalizeHarnessOrder, type CodingToolId } from './tools'

/**
 * The ways an agent talks to a model provider: Anthropic's Messages API,
 * which Claude Code speaks, and OpenAI's Responses API, which Codex speaks.
 */
export type WireFormat = 'anthropic' | 'responses'

/**
 * The formats in which each agent can run a provider of the user's, the one
 * it takes first leading; an agent with none runs only on its own models.
 * Codex runs a provider at its Responses address alone; OpenCode at its
 * Anthropic-compatible one, else at its Responses one; Antigravity CLI runs
 * only the models of the Google account it is signed in with.
 */
export const FORMATS_OF: Readonly<Record<CodingToolId, readonly WireFormat[]>> = {
  claude: ['anthropic'],
  codex: ['responses'],
  opencode: ['anthropic', 'responses'],
  antigravity: [],
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
  | 'google'
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

/**
 * A model a models.dev provider lists, as Hoot keeps it: its id, how many
 * tokens of context it takes and of answer it gives, and the effort levels
 * it takes.
 */
export interface CatalogModel {
  id: string
  context: number | null
  /** The most tokens it answers with, its thinking included; `null` where that is not known. */
  output: number | null
  /** The effort levels it takes, by models.dev's names, lowest first; none where it takes none. */
  efforts: string[]
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

/**
 * What models.dev tells of a model an agent runs on a provider of the
 * user's, by the plan of its preset the provider is on, and on a Custom one,
 * of the models of its harness's maker (see `makerCatalog`); `null` for a
 * model its catalog lacks, and for one of an agent's own models.
 */
export function catalogModelOf(
  catalogs: ModelCatalogs,
  harness: CodingToolId,
  provider: Pick<Provider, 'presetId' | 'planId' | 'urls' | 'cloud' | 'own'>,
  model: string,
): CatalogModel | null {
  const found = providerPlan(provider)
  const catalog =
    found !== undefined
      ? planCatalog(found.preset, found.plan)
      : isCustomProvider(provider)
        ? makerCatalog(harness, provider)
        : null
  if (catalog === null) return null
  const id = bareModel(model)
  return (catalogs[catalog] ?? []).find((entry) => entry.id === id) ?? null
}

/**
 * The models.dev provider of Claude's own models, which an agent on a Custom
 * provider at an Anthropic-compatible address offers besides the provider's
 * (see `addedModels`), as such a provider often relays Claude's.
 */
export const CLAUDE_CATALOG = 'anthropic'

/**
 * The models.dev provider of OpenAI's own models, which an agent on a Custom
 * provider at a Responses address offers besides the provider's, as such a
 * provider often relays OpenAI's.
 */
export const CODEX_CATALOG = 'openai'

/**
 * The models.dev provider of the models an agent on a Custom provider offers
 * besides the provider's (see `addedModels`): of the maker of the format it
 * runs the provider in, Claude's at an Anthropic-compatible address and
 * OpenAI's at a Responses one, as for Claude Code and Codex, which those
 * makers make; none where it runs the provider at neither.
 */
export function makerCatalog(
  harness: CodingToolId,
  provider: Pick<Provider, 'urls'>,
): string | null {
  switch (providerFormat(provider, harness)) {
    case 'anthropic':
      return CLAUDE_CATALOG
    case 'responses':
      return CODEX_CATALOG
    case null:
      return null
  }
}

/** Whether a provider is a Custom one: of the user's, made of no preset. */
export function isCustomProvider(provider: Pick<Provider, 'presetId' | 'own'>): boolean {
  return provider.own === null && provider.presetId === null
}

/**
 * The models of a maker an agent on a provider offers besides the provider's
 * own: on a Custom provider, those of models.dev's that the provider does
 * not list itself, newest first (see `makerCatalog`); none on another.
 */
export function addedModels(
  harness: CodingToolId,
  provider: Pick<Provider, 'presetId' | 'own' | 'models' | 'urls'>,
  catalogs: ModelCatalogs,
): string[] {
  const catalog = makerCatalog(harness, provider)
  if (catalog === null || !isCustomProvider(provider)) return []
  return catalogModelIds(catalogs, catalog).filter((id) => !provider.models.includes(id))
}

/** The models of Claude's a Claude Code agent on a provider offers besides the provider's (see `addedModels`). */
export function addedClaudeModels(
  provider: Pick<Provider, 'presetId' | 'own' | 'models' | 'urls'>,
  catalogs: ModelCatalogs,
): string[] {
  return addedModels('claude', provider, catalogs)
}

/**
 * The models an agent on a provider of the user's offers: the provider's,
 * then a maker's on a Custom one (see `addedModels`).
 */
export function agentModels(
  harness: CodingToolId,
  provider: Pick<Provider, 'presetId' | 'own' | 'models' | 'urls'>,
  catalogs: ModelCatalogs,
): string[] {
  return [...provider.models, ...addedModels(harness, provider, catalogs)]
}

/**
 * The models a Claude Code agent on a provider of the user's offers: the
 * provider's, then Claude's on a Custom one (see `addedClaudeModels`).
 */
export function claudeAgentModels(
  provider: Pick<Provider, 'presetId' | 'own' | 'models' | 'urls'>,
  catalogs: ModelCatalogs,
): string[] {
  return agentModels('claude', provider, catalogs)
}

/**
 * The model a Claude Code agent on a Custom provider without models of its
 * own starts with: Claude's newest Opus, which Claude Code starts with
 * itself, else Claude's newest; `null` while models.dev lists none.
 */
export function firstClaudeModel(catalogs: ModelCatalogs): string | null {
  const ids = catalogModelIds(catalogs, CLAUDE_CATALOG)
  return ids.find((id) => id.startsWith('claude-opus-')) ?? ids[0] ?? null
}

/**
 * The model a Codex agent on a Custom provider without models of its own
 * starts with: OpenAI's newest GPT of a tier alone, such as `gpt-6.2-sol`,
 * as Codex starts with one itself, rather than one for a field or a size,
 * such as `gpt-6.2-sol-healthcare`; else OpenAI's newest; `null` while
 * models.dev lists none.
 */
export function firstCodexModel(catalogs: ModelCatalogs): string | null {
  const ids = catalogModelIds(catalogs, CODEX_CATALOG)
  return ids.find((id) => /^gpt-[\d.]+(?:-[a-z]+)?$/.test(id)) ?? ids[0] ?? null
}

/**
 * The model an agent on a provider of the user's starts with while it names
 * none: the provider's first; on a Custom one without models of its own, the
 * one the maker's it offers starts with (see `firstClaudeModel` and
 * `firstCodexModel`); `null` where it offers none.
 */
export function providerFirstModel(
  harness: CodingToolId,
  provider: Pick<Provider, 'presetId' | 'own' | 'models' | 'urls'>,
  catalogs: ModelCatalogs,
): string | null {
  const first = provider.models[0]
  if (first !== undefined) return first
  if (addedModels(harness, provider, catalogs).length === 0) return null
  switch (makerCatalog(harness, provider)) {
    case CLAUDE_CATALOG:
      return firstClaudeModel(catalogs)
    case CODEX_CATALOG:
      return firstCodexModel(catalogs)
    default:
      return null
  }
}

/**
 * Whether a Claude Code agent on a provider of the user's leaves each of
 * Claude Code's roles it does not map to Claude Code, which then runs its own
 * model of the role, as on Claude's own API: on a Custom provider, while the
 * agent runs one of Claude's models, as models.dev lists them (see
 * `CLAUDE_CATALOG`), or the provider has no models of its own. Elsewhere a
 * role it does not map runs the model the agent runs, since Claude Code's own
 * would be one the provider lacks.
 */
export function leavesRolesToClaude(
  provider: Pick<Provider, 'presetId' | 'own' | 'models'>,
  model: string | null,
  catalogs: ModelCatalogs,
): boolean {
  if (!isCustomProvider(provider)) return false
  const runs = model ?? provider.models[0] ?? null
  return runs === null || catalogModelIds(catalogs, CLAUDE_CATALOG).includes(bareModel(runs))
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
  antigravity: 'google-account',
}

const OWN_PROVIDER_NAMES: Readonly<Record<CodingToolId, string>> = {
  claude: 'Claude subscription',
  codex: 'ChatGPT subscription',
  opencode: 'OpenCode free models',
  // After Google's AI plans, such as Google AI Pro, which the account it is
  // signed in with may be on, or on none.
  antigravity: 'Google AI',
}

/**
 * An agent's own models: its subscription, for OpenCode the free models it
 * comes with, and for Antigravity CLI those of the Google account it is
 * signed in with.
 */
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
 * The effort levels OpenCode gives a model of a provider of the user's
 * that it is told no levels of, its variants, by the format it runs the
 * provider in: Claude Code's at an Anthropic-compatible address, three at a
 * Responses one.
 */
export const OPENCODE_FORMAT_EFFORTS: Readonly<Record<WireFormat, readonly string[]>> = {
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  responses: ['low', 'medium', 'high'],
}

/**
 * The effort levels an OpenCode agent offers for a model of a provider of
 * the user's, which OpenCode runs it in the format of: those models.dev
 * lists for it, as they are, which Hoot tells OpenCode as the model's
 * variants (see `openCodeEntry`); for one it lists none for, those OpenCode
 * gives it itself (see `OPENCODE_FORMAT_EFFORTS`).
 */
export function openCodeEffortsOf(
  model: Pick<CatalogModel, 'efforts'> | null,
  format: WireFormat,
): string[] {
  const listed = model?.efforts ?? []
  return [...(listed.length > 0 ? listed : OPENCODE_FORMAT_EFFORTS[format])]
}

/**
 * The effort level an OpenCode session on a provider of the user's starts
 * at while its agent picks none, as Claude Code's and Codex's do, where
 * models.dev lists levels for the model: `high`, unless the model takes
 * other levels and not that one, then the highest of them below it, else
 * the lowest. None for a model it lists none for, which OpenCode then runs
 * without a variant, as it does itself, since the model may not reason.
 */
export function openCodeDefaultEffort(model: Pick<CatalogModel, 'efforts'> | null): string | null {
  const listed = model?.efforts ?? []
  return listed.length === 0 ? null : levelAtHigh(listed)
}

/**
 * The effort level an OpenCode session on a provider of the user's starts
 * at: its agent's, while the model takes it (see `openCodeEffortsOf`), else
 * the model's (see `openCodeDefaultEffort`), as a model picked with
 * `/models` may not take the agent's.
 */
export function openCodeSessionEffort(
  effort: string | null,
  model: Pick<CatalogModel, 'efforts'> | null,
  format: WireFormat,
): string | null {
  return effort !== null && openCodeEffortsOf(model, format).includes(effort)
    ? effort
    : openCodeDefaultEffort(model)
}

/** The effort levels Codex knows by name, lowest first; it sends any other as it is too. */
export const CODEX_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const

/**
 * The effort levels a Codex agent offers for a model of a provider of the
 * user's: those models.dev lists for it, as they are, as Codex sends the
 * provider any level it is given; none for a model models.dev lists none for.
 */
export function codexEffortsOf(model: Pick<CatalogModel, 'efforts'> | null): string[] {
  return [...(model?.efforts ?? [])]
}

/**
 * The effort level a Codex session on a provider of the user's starts at
 * while its agent picks none, in place of the user's own level, which Codex
 * would send the provider as it is: `high`, as Hoot gives a model it knows
 * no levels of, unless the model takes other levels and not that one; then
 * the highest of them below it, else the lowest.
 */
export function codexDefaultEffort(levels: readonly string[]): string {
  return levels.length === 0 ? 'high' : levelAtHigh(levels)
}

/**
 * Of some effort levels, `high`, else the highest of them below it, else the
 * lowest, by their order among `CODEX_EFFORTS`, which has models.dev's names.
 */
function levelAtHigh(levels: readonly string[]): string {
  if (levels.includes('high')) return 'high'
  const below = levels.filter((level) => codexEffortRank(level) < codexEffortRank('high'))
  return below.toSorted(byCodexEffort).at(-1) ?? levels.toSorted(byCodexEffort)[0]!
}

/** Where an effort level stands among `CODEX_EFFORTS`: one Codex does not know, above them all. */
function codexEffortRank(level: string): number {
  const known = CODEX_EFFORTS.indexOf(level as (typeof CODEX_EFFORTS)[number])
  return known === -1 ? CODEX_EFFORTS.length : known
}

/** Orders effort levels lowest first (see `codexEffortRank`). */
function byCodexEffort(a: string, b: string): number {
  return codexEffortRank(a) - codexEffortRank(b)
}

/**
 * The effort level a Codex session on a provider of the user's starts at:
 * its agent's, while the model takes it or models.dev lists no levels for
 * it, else the model's (see `codexDefaultEffort`), as a model picked with
 * `/model` may not take the agent's.
 */
export function codexSessionEffort(effort: string | null, levels: readonly string[]): string {
  return effort !== null && (levels.length === 0 || levels.includes(effort))
    ? effort
    : codexDefaultEffort(levels)
}

/** Whether a model's id names one of Claude's, whose limits and effort levels Claude Code knows itself. */
export function namesClaudeModel(model: string): boolean {
  return /claude-/i.test(model)
}

/** The effort levels Claude Code takes, lowest first. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The effort levels a Claude Code agent offers for a model of a provider of
 * the user's: those models.dev lists for it that Claude Code takes too, which
 * it sends the provider as they are; none for a model models.dev lists none
 * for, such as one told how many tokens to think with instead.
 */
export function claudeEffortsOf(model: Pick<CatalogModel, 'efforts'> | null): string[] {
  const levels = new Set(model?.efforts ?? [])
  return CLAUDE_EFFORTS.filter((level) => levels.has(level))
}

/**
 * The effort level a Claude Code session on a provider of the user's starts
 * at while its agent picks none, in place of the user's own level, which
 * Claude Code would send the provider as it is: `high`, as Claude Code sends
 * a model it does not know, unless the model takes other levels and not that
 * one; then the highest of them below it, else the lowest. `null` where that
 * is `max`, which Claude Code's settings cannot keep.
 */
export function claudeDefaultEffort(levels: readonly string[]): string | null {
  const known = CLAUDE_EFFORTS.filter((level) => levels.includes(level))
  if (known.length === 0 || known.includes('high')) return 'high'
  const below = known.filter(
    (level) => CLAUDE_EFFORTS.indexOf(level) < CLAUDE_EFFORTS.indexOf('high'),
  )
  const level = below.at(-1) ?? known[0]!
  return level === 'max' ? null : level
}

/**
 * The roles Claude Code gives models besides the one a session starts with:
 * its tiers, which `/model` offers and some of its own work runs on, Haiku's
 * most, and the model its subagents start with where they name none.
 */
export const CLAUDE_ROLES = ['opus', 'sonnet', 'haiku', 'fable', 'subagent'] as const

export type ClaudeRole = (typeof CLAUDE_ROLES)[number]

/** How the Agents page names each of Claude Code's roles. */
export const CLAUDE_ROLE_NAMES: Readonly<Record<ClaudeRole, string>> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
  subagent: 'Subagent',
}

/**
 * What Claude Code runs a role on that an agent leaves to it (see
 * `leavesRolesToClaude`), by the name Claude Code gives it: its own model of
 * each tier, and for subagents, the model of the session they run in.
 */
export const CLAUDE_ROLE_DEFAULTS: Readonly<Record<ClaudeRole, string>> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
  fable: 'fable',
  subagent: 'inherit',
}

/**
 * The models of its provider a Claude Code agent on a provider of the user's
 * runs Claude Code's roles on, by role; a role left out runs the model the
 * session starts with.
 */
export type ModelMap = Partial<Record<ClaudeRole, string>>

/** A model map without blank models and roles Claude Code does not have. */
export function cleanModelMap(map: ModelMap): ModelMap {
  const clean: ModelMap = {}
  for (const role of CLAUDE_ROLES) {
    const model = map[role]?.trim()
    if (model) clean[role] = model
  }
  return clean
}

/**
 * A model map on another provider: the roles mapped to a model that provider
 * offers too (see `claudeAgentModels`).
 */
export function modelMapOn(
  map: ModelMap,
  provider: Pick<Provider, 'models' | 'own' | 'presetId' | 'urls'>,
  catalogs: ModelCatalogs,
): ModelMap {
  if (provider.own !== null) return {}
  const offered = claudeAgentModels(provider, catalogs)
  const kept: ModelMap = {}
  for (const role of CLAUDE_ROLES) {
    const model = map[role]
    if (model !== undefined && offered.includes(model)) kept[role] = model
  }
  return kept
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
    case 'antigravity':
      return 'google'
    case null:
      return presetById(provider.presetId)?.mark ?? 'custom'
  }
}

/** An address without the spaces around it and the slashes at its end, as addresses compare. */
export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** The format an agent runs a provider in: the first of those it speaks that the provider serves; `null` for none. */
export function providerFormat(
  provider: Pick<Provider, 'urls'>,
  harness: CodingToolId,
): WireFormat | null {
  return FORMATS_OF[harness].find((format) => (provider.urls[format] ?? '').trim() !== '') ?? null
}

/** The address an agent runs a provider at, in its format (see `providerFormat`); `''` for none. */
export function providerUrl(provider: Pick<Provider, 'urls'>, harness: CodingToolId): string {
  const format = providerFormat(provider, harness)
  return format === null ? '' : (provider.urls[format] ?? '').trim()
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
  /**
   * For Claude Code on a provider of the user's, the models of it Claude
   * Code's roles run on; empty for every role's default.
   */
  modelMap: ModelMap
  /** Milliseconds since the Unix epoch, when it was made, which orders the agents. */
  createdAt: number
}

/** An agent to make: what its maker picks; it starts turned on, with no effort or extra arguments. */
export interface NewAgent {
  harness: CodingToolId
  providerId: string
  model: string | null
  name?: string | null
  effort?: string | null
  extraArgs?: string[]
  modelMap?: ModelMap
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
  /** Its whole model map, in place of the one it has. */
  modelMap?: ModelMap
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
    ...(change.modelMap === undefined ? {} : { modelMap: cleanModelMap(change.modelMap) }),
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
 * The providers and agents, as the window shows them. Hoot reads no agent's
 * own configuration for them, and makes one agent alone by itself: that of
 * each harness's own models, as the harness is found installed (see
 * `ProviderService.ensureOwnAgents`). Every other agent is made by hand, and
 * each session is given its provider by itself.
 */
export interface ProvidersState {
  /** The user's providers, in the order they were made; the agents' own are not among them. */
  providers: Provider[]
  /** In the order they were made. */
  agents: Agent[]
}

/** The harness whose own models a provider id stands for; `null` for a provider of the user's. */
export function ownHarnessOf(providerId: string): CodingToolId | null {
  return CODING_TOOL_IDS.find((candidate) => OWN_PROVIDER_IDS[candidate] === providerId) ?? null
}

/** A provider by id: one of the user's, or an agent's own models. */
export function findProvider(providers: readonly Provider[], id: string): Provider | undefined {
  const harness = ownHarnessOf(id)
  return harness === null ? providers.find((provider) => provider.id === id) : ownProvider(harness)
}

/**
 * Whether an agent can be deleted: any but the last that runs on its
 * harness's own models, which Hoot makes itself and keeps; there is one
 * such agent, unless more were made by hand before Hoot made them.
 */
export function canDeleteAgent(
  agent: Pick<Agent, 'id' | 'providerId'>,
  agents: readonly Pick<Agent, 'id' | 'providerId'>[],
): boolean {
  return (
    ownHarnessOf(agent.providerId) === null ||
    agents.some((other) => other.id !== agent.id && other.providerId === agent.providerId)
  )
}

/**
 * The name an agent shows: the one the user gave it; else its provider's, as
 * Claude subscription for Claude Code's own, with the model it runs when
 * another agent of the harness runs the same provider: its own, or the
 * provider's first, which an agent made without one runs.
 */
export function agentName(
  agent: Agent,
  state: Pick<ProvidersState, 'providers' | 'agents'>,
): string {
  if (agent.name !== null && agent.name.trim() !== '') return agent.name.trim()
  const provider = findProvider(state.providers, agent.providerId)
  if (provider === undefined) return getCodingTool(agent.harness).label
  const shared = state.agents.some(
    (other) =>
      other.id !== agent.id &&
      other.harness === agent.harness &&
      other.providerId === agent.providerId &&
      (other.name === null || other.name.trim() === ''),
  )
  const model = agent.model ?? provider.models[0] ?? null
  return shared && model !== null ? `${provider.name} · ${model}` : provider.name
}

/**
 * The agents a new session can start with: those turned on whose harness is
 * installed and whose provider is there and runs on it, grouped by harness in
 * `order` (defaulting to `CODING_TOOL_IDS`), each harness's in the order they
 * were made.
 */
export function usableAgents(
  state: Pick<ProvidersState, 'providers' | 'agents'>,
  installed: (harness: CodingToolId) => boolean,
  order: readonly CodingToolId[] = CODING_TOOL_IDS,
): Agent[] {
  return normalizeHarnessOrder(order).flatMap((harness) =>
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

/** A name no provider has yet: `base`, else `base` with 2, 3, … after it. */
export function freeProviderName(providers: readonly Provider[], base: string): string {
  const taken = new Set(providers.map((provider) => provider.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** The host of an address; `null` for one that is not a URL. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null
  } catch {
    return null
  }
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
