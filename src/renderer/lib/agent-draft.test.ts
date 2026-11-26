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
  mapsRoles,
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
    installCommand: null,
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
    expect(impliedModel(bailian, undefined)).toBe('deepseek-v4.1-flash-1017')
    expect(impliedModel({ ...bailian, models: [] }, undefined)).toBeNull()
    expect(impliedModel(undefined, undefined)).toBeNull()
    // Claude Code starts with Opus where nothing else is named.
    expect(impliedModel(subscription, stateWith({}))).toBe('opus')
    expect(
      impliedModel(subscription, stateWith({ defaultModel: { value: 'fable', source: 'x' } })),
    ).toBe('fable')
    // A named model that is not offered counts as none.
    expect(
      impliedModel(subscription, stateWith({ defaultModel: { value: 'gone', source: 'x' } })),
    ).toBe('opus')
    expect(
      impliedModel(
        ownProvider('codex'),
        stateWith({ models: [{ value: 'gpt', label: 'gpt', efforts: [] }] }),
      ),
    ).toBe('gpt')
    // Before its detection read what it offers, it is not known.
    expect(impliedModel(subscription, undefined)).toBeNull()
  })

  it('is the one the panel shows for an agent made without one', () => {
    expect(shownDraft(draft({ model: null }), bailian, undefined).model).toBe(
      'deepseek-v4.1-flash-1017',
    )
    expect(shownDraft(draft({ model: 'qwen3.8-max' }), bailian, undefined).model).toBe(
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
    expect(withRole({}, 'haiku', 'qwen3.8-max', runs)).toEqual({ haiku: 'qwen3.8-max' })
    // Given the agent's model, a role follows it again.
    expect(withRole({ haiku: 'qwen3.8-max' }, 'haiku', runs, runs)).toEqual({})
  })

  it('go with the agent’s model to another, those given one of their own staying', () => {
    const map = { haiku: 'deepseek-v4-flash-0731', fable: 'qwen3.8-max' }
    expect(followMap(map, 'deepseek-v4.1-flash-1017', 'qwen3.8-max')).toEqual({
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
    )
    expect(kept).toMatchObject({ providerId: both.id, model: 'qwen3.8-max', effort: null })
    expect(kept.modelMap).toEqual({})
    const moved = draftOnProvider(
      draft({ modelMap: { haiku: 'qwen3.8-max', opus: 'deepseek-v4-flash-0731' } }),
      both,
      undefined,
    )
    expect(moved).toMatchObject({ model: 'deepseek-v4-pro', modelMap: { haiku: 'qwen3.8-max' } })
  })

  it('takes the model its harness starts with on its own models, and maps no roles there', () => {
    const own = draftOnProvider(
      draft({ modelMap: { haiku: 'qwen3.8-max' } }),
      subscription,
      stateWith({}),
    )
    expect(own).toMatchObject({ providerId: subscription.id, model: 'opus', modelMap: {} })
    const back = draftOnProvider(own, bailian, undefined)
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
    ])
  })

  it('starts where Hoot starts its sessions, where Hoot knows it', () => {
    expect(startsAt({}, bailian)).toBe('high')
    // A model without `high` starts at the highest level below it.
    expect(startsAt({ model: 'qwen3.8-max' }, bailian)).toBe('medium')
    expect(startsAt({ harness: 'codex', model: 'deepseek-v4-pro' }, deepseek)).toBe('high')
    expect(startsAt({ harness: 'opencode', model: 'deepseek-v4-pro' }, deepseek)).toBeNull()
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
