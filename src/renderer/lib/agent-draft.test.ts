import { describe, expect, it } from 'vitest'
import type { AgentLaunchOptions, AgentState } from '../../shared/agents'
import { ownProvider, presetById, type ModelCatalogs, type Provider } from '../../shared/providers'
import {
  defaultEffortOf,
  draftChange,
  draftOnProvider,
  draftWithModel,
  effortsOf,
  followMap,
  impliedModel,
  leavesRoles,
  mapsRoles,
  modelGroups,
  shownDraft,
  typedName,
  withRole,
  type AgentDraft,
} from './agent-draft'

const bailian: Provider = {
  id: 'p-bailian',
  name: 'Bailian Plan',
  presetId: 'bailian-plan',
  planId: null,
  apiKey: 'sk-bailian',
  keyHeader: 'bearer',
  // At the addresses of its preset, whose models models.dev lists.
  urls: { ...presetById('bailian-plan')!.urls },
  models: ['deepseek-v4.1-flash-1017', 'qwen3.8-max', 'deepseek-v4-flash-0731'],
  cloud: null,
  own: null,
}

const deepseek: Provider = {
  ...bailian,
  id: 'p-deepseek',
  name: 'DeepSeek',
  presetId: 'deepseek',
  urls: { ...presetById('deepseek')!.urls },
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
}

const catalogs: ModelCatalogs = {
  'alibaba-token-plan-cn': [
    {
      id: 'deepseek-v4.1-flash-1017',
      context: 1_000_000,
      output: 384_000,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    { id: 'qwen3.8-max', context: 983_616, output: 65_536, efforts: ['low', 'medium'] },
    { id: 'deepseek-v4-flash-0731', context: 1_000_000, output: 384_000, efforts: ['high', 'max'] },
  ],
  deepseek: [
    {
      id: 'deepseek-v4-pro',
      context: 1_000_000,
      output: 384_000,
      efforts: ['low', 'high', 'max'],
    },
    { id: 'deepseek-v4-flash', context: 1_000_000, output: 384_000, efforts: ['low', 'medium'] },
  ],
  // OpenAI's, which Codex agents on a Custom provider offer.
  openai: [
    { id: 'gpt-6.2-sol-healthcare', context: 1_050_000, output: 128_000, efforts: ['low', 'high'] },
    { id: 'gpt-6.2-sol', context: 1_050_000, output: 128_000, efforts: ['low', 'high'] },
  ],
}

const subscription = ownProvider('claude')

function stateWith(options: Partial<AgentLaunchOptions>): AgentState {
  return {
    id: 'claude',
    checking: false,
    detected: true,
    installation: null,
    latest: null,
    latestFailed: false,
    stable: null,
    releases: null,
    follow: { kind: 'latest' },
    installRoute: 'official',
    copies: [],
    nodeRequirement: null,
    operation: null,
    launchOptions: {
      models: [
        { value: 'fable', label: 'Fable', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'haiku', label: 'Haiku', efforts: [] },
      ],
      defaultEfforts: [],
      defaultModel: null,
      defaultEffort: null,
      ...options,
    },
  }
}

function draft(change: Partial<AgentDraft> = {}): AgentDraft {
  return {
    harness: 'claude',
    providerId: bailian.id,
    name: null,
    enabled: true,
    model: 'deepseek-v4.1-flash-1017',
    effort: null,
    extraArgs: [],
    modelMap: {},
    ...change,
  }
}

/** The level an agent's sessions start at, of a draft with a change. */
function startsAt(change: Partial<AgentDraft>, provider: Provider, state?: AgentState) {
  const d = draft(change)
  return defaultEffortOf(d.harness, d.model, provider, state, catalogs)
}

describe('the model an agent runs while it names none', () => {
  it('is its provider’s first, or on its harness’s own models, what its configuration names', () => {
    expect(impliedModel('claude', bailian, undefined, catalogs)).toBe('deepseek-v4.1-flash-1017')
    expect(impliedModel('claude', { ...bailian, models: [] }, undefined, catalogs)).toBeNull()
    expect(impliedModel('claude', undefined, undefined, catalogs)).toBeNull()
    // Claude Code starts with Opus where nothing else is named.
    expect(impliedModel('claude', subscription, stateWith({}), catalogs)).toBe('opus')
    expect(
      impliedModel(
        'claude',
        subscription,
        stateWith({ defaultModel: { value: 'fable', source: 'x' } }),
        catalogs,
      ),
    ).toBe('fable')
    // A named model that is not offered counts as none.
    expect(
      impliedModel(
        'claude',
        subscription,
        stateWith({ defaultModel: { value: 'gone', source: 'x' } }),
        catalogs,
      ),
    ).toBe('opus')
    expect(
      impliedModel(
        'codex',
        ownProvider('codex'),
        stateWith({ models: [{ value: 'gpt', label: 'gpt', efforts: [] }] }),
        catalogs,
      ),
    ).toBe('gpt')
    // Before its detection read what it offers, it is not known.
    expect(impliedModel('claude', subscription, undefined, catalogs)).toBeNull()
  })

  it('offers Codex on a Custom provider OpenAI’s models after its own, starting on a GPT of a tier alone', () => {
    const relay: Provider = {
      ...deepseek,
      presetId: null,
      urls: { responses: 'https://relay.example.com/v1' },
      models: [],
    }
    expect(modelGroups('codex', relay, undefined, catalogs)).toEqual([
      [
        {
          value: 'gpt-6.2-sol-healthcare',
          label: 'gpt-6.2-sol-healthcare',
          efforts: ['low', 'high'],
        },
        { value: 'gpt-6.2-sol', label: 'gpt-6.2-sol', efforts: ['low', 'high'] },
      ],
    ])
    expect(impliedModel('codex', relay, undefined, catalogs)).toBe('gpt-6.2-sol')
    const own = { ...relay, models: ['glm-5'] }
    expect(modelGroups('codex', own, undefined, catalogs).map((group) => group.length)).toEqual([
      1, 2,
    ])
    expect(impliedModel('codex', own, undefined, catalogs)).toBe('glm-5')
  })

  it('is the one the panel shows for an agent made without one', () => {
    expect(shownDraft(draft({ model: null }), bailian, undefined, catalogs).model).toBe(
      'deepseek-v4.1-flash-1017',
    )
    expect(shownDraft(draft({ model: 'qwen3.8-max' }), bailian, undefined, catalogs).model).toBe(
      'qwen3.8-max',
    )
  })
})

describe('the roles of Claude Code', () => {
  it('are mapped for Claude Code on a provider of the user’s alone', () => {
    expect(mapsRoles('claude', bailian)).toBe(true)
    expect(mapsRoles('claude', subscription)).toBe(false)
    expect(mapsRoles('codex', deepseek)).toBe(false)
    expect(mapsRoles('claude', undefined)).toBe(false)
  })

  it('follow the agent’s model, unless given one of their own', () => {
    const runs = 'deepseek-v4.1-flash-1017'
    expect(withRole({}, 'haiku', 'qwen3.8-max', runs, false)).toEqual({ haiku: 'qwen3.8-max' })
    // Given the agent's model, a role follows it again.
    expect(withRole({ haiku: 'qwen3.8-max' }, 'haiku', runs, runs, false)).toEqual({})
  })

  it('go with the agent’s model to another, those given one of their own staying', () => {
    const map = { haiku: 'deepseek-v4-flash-0731', fable: 'qwen3.8-max' }
    expect(followMap(map, 'deepseek-v4.1-flash-1017', 'qwen3.8-max', false, false)).toEqual({
      haiku: 'deepseek-v4-flash-0731',
    })
    const moved = draftWithModel(
      draft({ modelMap: map }),
      'qwen3.8-max',
      bailian,
      undefined,
      catalogs,
    )
    expect(moved.modelMap).toEqual({ haiku: 'deepseek-v4-flash-0731' })
  })
})

describe('an agent on another provider', () => {
  it('keeps its model and roles where that provider offers them, else takes its first', () => {
    const both = { ...deepseek, models: ['deepseek-v4-pro', 'qwen3.8-max'] }
    const kept = draftOnProvider(
      draft({ model: 'qwen3.8-max', effort: 'low', modelMap: { haiku: 'deepseek-v4-flash-0731' } }),
      both,
      undefined,
      catalogs,
      bailian,
    )
    expect(kept).toMatchObject({ providerId: both.id, model: 'qwen3.8-max', effort: null })
    expect(kept.modelMap).toEqual({})
    const moved = draftOnProvider(
      draft({ modelMap: { haiku: 'qwen3.8-max', opus: 'deepseek-v4-flash-0731' } }),
      both,
      undefined,
      catalogs,
      bailian,
    )
    expect(moved).toMatchObject({ model: 'deepseek-v4-pro', modelMap: { haiku: 'qwen3.8-max' } })
  })

  it('takes the model its harness starts with on its own models, and maps no roles there', () => {
    const own = draftOnProvider(
      draft({ modelMap: { haiku: 'qwen3.8-max' } }),
      subscription,
      stateWith({}),
      catalogs,
      bailian,
    )
    expect(own).toMatchObject({ providerId: subscription.id, model: 'opus', modelMap: {} })
    const back = draftOnProvider(own, bailian, undefined, catalogs, subscription)
    expect(back.model).toBe('deepseek-v4.1-flash-1017')
  })
})

describe('the effort level of an agent', () => {
  it('offers what models.dev lists for its model', () => {
    expect(effortsOf('claude', 'deepseek-v4-flash-0731', bailian, undefined, catalogs)).toEqual([
      'high',
      'max',
    ])
    expect(effortsOf('claude', 'unknown', bailian, undefined, catalogs)).toEqual([])
    expect(effortsOf('codex', 'deepseek-v4-pro', deepseek, undefined, catalogs)).toEqual([
      'low',
      'high',
      'max',
    ])
    expect(effortsOf('codex', 'unknown', deepseek, undefined, catalogs)).toEqual([])
    expect(effortsOf('opencode', 'deepseek-v4-pro', deepseek, undefined, catalogs)).toEqual([
      'low',
      'high',
      'max',
    ])
    // For a model models.dev lists no levels for, those OpenCode gives it itself.
    expect(effortsOf('opencode', 'unknown', deepseek, undefined, catalogs)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('starts where Hoot starts its sessions, where Hoot knows it', () => {
    expect(startsAt({}, bailian)).toBe('high')
    // A model without `high` starts at the highest level below it.
    expect(startsAt({ model: 'qwen3.8-max' }, bailian)).toBe('medium')
    expect(startsAt({ harness: 'codex', model: 'deepseek-v4-pro' }, deepseek)).toBe('high')
    expect(startsAt({ harness: 'codex', model: 'deepseek-v4-flash' }, deepseek)).toBe('medium')
    expect(startsAt({ harness: 'codex', model: 'unknown' }, deepseek)).toBe('high')
    expect(startsAt({ harness: 'opencode', model: 'deepseek-v4-pro' }, deepseek)).toBe('high')
    expect(startsAt({ harness: 'opencode', model: 'deepseek-v4-flash' }, deepseek)).toBe('medium')
    // OpenCode runs a model models.dev lists no levels for without one.
    expect(startsAt({ harness: 'opencode', model: 'unknown' }, deepseek)).toBeNull()
    // On its own models, and for one of Claude's, the level its configuration names, where the model takes it.
    const xhigh = stateWith({ defaultEffort: { value: 'xhigh', source: 'settings.json' } })
    expect(startsAt({ model: 'opus' }, subscription, xhigh)).toBe('xhigh')
    expect(startsAt({ model: 'haiku' }, subscription, xhigh)).toBeNull()
    expect(startsAt({ model: 'opus' }, subscription, stateWith({}))).toBeNull()
    const claude = {
      ...bailian,
      models: ['claude-opus-5-5'],
    }
    const withClaude = {
      'alibaba-token-plan-cn': [
        { id: 'claude-opus-5-5', context: 1_000_000, output: 128_000, efforts: ['high', 'xhigh'] },
      ],
    }
    expect(defaultEffortOf('claude', 'claude-opus-5-5', claude, xhigh, withClaude)).toBe('xhigh')
    expect(defaultEffortOf('claude', 'claude-opus-5-5', claude, undefined, withClaude)).toBeNull()
  })

  it('goes back to its new model’s where that model does not take it', () => {
    const max = draft({ effort: 'max' })
    expect(draftWithModel(max, 'deepseek-v4-flash-0731', bailian, undefined, catalogs).effort).toBe(
      'max',
    )
    expect(draftWithModel(max, 'qwen3.8-max', bailian, undefined, catalogs).effort).toBeNull()
  })
})

describe('a change to an agent', () => {
  it('names only what changed', () => {
    const before = draft({ extraArgs: ['--verbose'] })
    expect(draftChange(before, { ...before })).toEqual({})
    expect(
      draftChange(before, {
        ...before,
        model: 'qwen3.8-max',
        extraArgs: ['--verbose'],
        modelMap: { haiku: 'deepseek-v4-flash-0731' },
      }),
    ).toEqual({ model: 'qwen3.8-max', modelMap: { haiku: 'deepseek-v4-flash-0731' } })
    expect(draftChange(before, { ...before, effort: 'max', extraArgs: [] })).toEqual({
      effort: 'max',
      extraArgs: [],
    })
  })

  it('takes a name typed as none where it is blank or the one it gets anyway', () => {
    expect(typedName('  ', 'Bailian Plan')).toBeNull()
    expect(typedName(' Bailian Plan ', 'Bailian Plan')).toBeNull()
    expect(typedName(' Fast ', 'Bailian Plan')).toBe('Fast')
  })
})

/** The models of each group of a model picker. */
const ids = (groups: { value: string }[][]) => groups.map((group) => group.map((m) => m.value))

/** A draft of an agent on a provider, with a change. */
const on = (provider: Provider, change: Partial<AgentDraft>) =>
  draft({ providerId: provider.id, model: null, ...change })

describe('Claude Code on a Custom provider', () => {
  const OPUS = {
    id: 'claude-opus-5-5',
    context: 1_000_000,
    output: 128_000,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  }
  const HAIKU = { id: 'claude-haiku-4-5', context: 200_000, output: 64_000, efforts: [] }
  const FABLE = { ...OPUS, id: 'claude-fable-5-2' }
  const withClaude: ModelCatalogs = { ...catalogs, anthropic: [FABLE, OPUS, HAIKU] }
  const CLAUDE_IDS = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-haiku-4-5']
  // A relay of Claude's models, with none of its own.
  const relay: Provider = {
    ...bailian,
    id: 'p-relay',
    name: 'Relay',
    presetId: null,
    urls: { anthropic: 'https://relay.example.com' },
    models: [],
  }
  // A relay with models of its own besides Claude's.
  const mixed: Provider = { ...relay, id: 'p-mixed', models: ['glm-5', 'claude-haiku-4-5'] }

  it('offers Claude’s models after the provider’s own, to the agents at its Anthropic-compatible address', () => {
    expect(ids(modelGroups('claude', relay, undefined, withClaude))).toEqual([CLAUDE_IDS])
    expect(ids(modelGroups('claude', mixed, undefined, withClaude))).toEqual([
      ['glm-5', 'claude-haiku-4-5'],
      ['claude-fable-5-2', 'claude-opus-5-5'],
    ])
    expect(ids(modelGroups('opencode', relay, undefined, withClaude))).toEqual([CLAUDE_IDS])
    expect(ids(modelGroups('claude', bailian, undefined, withClaude))).toEqual([bailian.models])
  })

  it('starts on Claude’s newest Opus without models of its own, else on its first', () => {
    expect(impliedModel('claude', relay, undefined, withClaude)).toBe('claude-opus-5-5')
    expect(impliedModel('opencode', relay, undefined, withClaude)).toBe('claude-opus-5-5')
    expect(impliedModel('claude', mixed, undefined, withClaude)).toBe('glm-5')
    const made = draftOnProvider(draft(), relay, undefined, withClaude, bailian)
    expect(made).toMatchObject({ providerId: relay.id, model: 'claude-opus-5-5', modelMap: {} })
    // One with models of its own starts on its first, though it offers Claude's too ...
    const moved = draftOnProvider(made, mixed, undefined, withClaude, relay)
    expect(moved.model).toBe('glm-5')
    // ... unless the agent's model is one of them; one without keeps Claude's.
    const haiku = { ...made, model: 'claude-haiku-4-5' }
    expect(draftOnProvider(haiku, mixed, undefined, withClaude, relay).model).toBe(
      'claude-haiku-4-5',
    )
    const back = draftOnProvider(
      { ...moved, model: 'claude-fable-5-2' },
      relay,
      undefined,
      withClaude,
      mixed,
    )
    expect(back.model).toBe('claude-fable-5-2')
  })

  it('offers the effort levels models.dev lists for Claude’s models, Claude Code’s own default', () => {
    expect(effortsOf('claude', 'claude-opus-5-5', relay, undefined, withClaude)).toEqual(
      OPUS.efforts,
    )
    expect(effortsOf('claude', null, relay, undefined, withClaude)).toEqual(OPUS.efforts)
    expect(effortsOf('claude', 'glm-5', mixed, undefined, withClaude)).toEqual([])
    const xhigh = stateWith({ defaultEffort: { value: 'xhigh', source: 'settings.json' } })
    expect(defaultEffortOf('claude', 'claude-opus-5-5', relay, xhigh, withClaude)).toBe('xhigh')
    expect(defaultEffortOf('claude', 'claude-opus-5-5', relay, undefined, withClaude)).toBeNull()
  })

  it('leaves the roles it does not map to Claude Code while it runs one of Claude’s models', () => {
    expect(leavesRoles('claude', relay, 'claude-opus-5-5', withClaude)).toBe(true)
    expect(leavesRoles('claude', mixed, 'claude-haiku-4-5', withClaude)).toBe(true)
    expect(leavesRoles('claude', mixed, 'glm-5', withClaude)).toBe(false)
    expect(leavesRoles('claude', bailian, 'deepseek-v4.1-flash-1017', withClaude)).toBe(false)
    expect(leavesRoles('opencode', relay, 'claude-opus-5-5', withClaude)).toBe(false)
  })

  it('keeps a role the user mapped while the roles are left to Claude Code, the agent’s model too', () => {
    const runs = 'claude-opus-5-5'
    expect(withRole({}, 'haiku', runs, runs, true)).toEqual({ haiku: runs })
    expect(withRole({ haiku: runs }, 'haiku', null, runs, true)).toEqual({})
    expect(withRole({}, 'haiku', 'claude-haiku-4-5', runs, true)).toEqual({
      haiku: 'claude-haiku-4-5',
    })
  })

  it('switches the roles not mapped between following the model and Claude Code', () => {
    // On its own model, a role on Claude's: mapped by the user.
    const own = on(mixed, { model: 'glm-5', modelMap: { haiku: 'claude-haiku-4-5' } })
    const claude = draftWithModel(own, 'claude-opus-5-5', mixed, undefined, withClaude)
    expect(claude.modelMap).toEqual({ haiku: 'claude-haiku-4-5' })
    const back = draftWithModel(claude, 'glm-5', mixed, undefined, withClaude)
    expect(back.modelMap).toEqual({ haiku: 'claude-haiku-4-5' })
    // A role mapped to the agent's model stays where roles are left to Claude Code ...
    const pinned = on(relay, { model: 'claude-opus-5-5', modelMap: { haiku: 'claude-opus-5-5' } })
    expect(
      draftWithModel(pinned, 'claude-haiku-4-5', relay, undefined, withClaude).modelMap,
    ).toEqual({ haiku: 'claude-opus-5-5' })
    // ... and follows it once on a model of the provider's own, the one it is on.
    const onGlm = on(mixed, { model: 'claude-opus-5-5', modelMap: { opus: 'glm-5' } })
    expect(draftWithModel(onGlm, 'glm-5', mixed, undefined, withClaude).modelMap).toEqual({})
  })

  it('keeps on another provider the roles mapped to models it offers', () => {
    const anthropic: Provider = {
      ...relay,
      id: 'p-anthropic',
      presetId: 'anthropic',
      urls: { ...presetById('anthropic')!.urls },
      models: ['claude-opus-5-5', 'claude-haiku-4-5'],
    }
    const left = on(relay, { model: 'claude-opus-5-5', modelMap: { haiku: 'claude-haiku-4-5' } })
    const moved = draftOnProvider(left, anthropic, undefined, withClaude, relay)
    expect(moved).toMatchObject({
      model: 'claude-opus-5-5',
      modelMap: { haiku: 'claude-haiku-4-5' },
    })
    expect(draftOnProvider(moved, relay, undefined, withClaude, anthropic).modelMap).toEqual({
      haiku: 'claude-haiku-4-5',
    })
  })
})
