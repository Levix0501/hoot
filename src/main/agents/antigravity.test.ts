import { describe, expect, it, vi } from 'vitest'
import {
  antigravityModelsOf,
  readAntigravityLaunchOptions,
  withoutAntigravityUpdates,
} from './antigravity'
import type { CommandResult } from './processes'

/** What `agy models` 1.5.18 prints for a Google account. */
const MODELS = [
  'Fetching available models...',
  'gemini-4-neon-high\tGemini 4 Neon (High)',
  'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)',
  'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
  'gemini-4-neon-low\tGemini 4 Neon (Low)',
  'gemini-4-carbon-medium\tGemini 4 Carbon (Medium)',
  'gemini-4-carbon-high\tGemini 4 Carbon (High)',
  'gemini-4-carbon-low\tGemini 4 Carbon (Low)',
  'gemini-pro-orchestrator-neon\tOrchestrator (Neon)',
  'gemini-pro-orchestrator\tOrchestrator (Carbon)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  '',
].join('\n')

function result(code: number, stdout: string): CommandResult {
  return { code, signal: null, error: null, stdout, output: stdout, timedOut: false }
}

/** How `agy models` ends for a computer signed in with no Google account. */
const signedOut = async () =>
  result(
    1,
    'Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\n',
  )

describe('antigravityModelsOf', () => {
  it('makes one model of the variants of each effort level, with its levels in their order', () => {
    expect(antigravityModelsOf(MODELS)).toEqual([
      {
        value: 'gemini-4-neon',
        label: 'Gemini 4 Neon',
        efforts: ['low', 'medium', 'high', 'xhigh'],
      },
      { value: 'gemini-4-carbon', label: 'Gemini 4 Carbon', efforts: ['low', 'medium', 'high'] },
      // An orchestrator comes in no levels: its name is its own.
      { value: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)', efforts: [] },
      { value: 'gemini-pro-orchestrator', label: 'Orchestrator (Carbon)', efforts: [] },
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'high'] },
      { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['low', 'high'] },
      { value: 'gpt-oss-120b', label: 'GPT-OSS 120B', efforts: ['medium'] },
    ])
  })

  it('passes over what is no model', () => {
    expect(antigravityModelsOf('Error: Please sign in\n\nnot a\tmodel id\n')).toEqual([])
  })
})

describe('readAntigravityLaunchOptions', () => {
  it('lists the models with `agy models`, its own updater off', async () => {
    const run = vi.fn<typeof signedOut>(async () => result(0, MODELS))
    const options = await readAntigravityLaunchOptions({
      command: '/home/me/.local/bin/agy',
      env: { PATH: '/usr/bin', HOME: '/home/me' },
      home: '/home/me',
      platform: 'darwin',
      run,
    })
    expect(options.models.map((model) => model.value)).toContain('gemini-4-neon')
    expect(options).toMatchObject({ defaultEfforts: [], defaultModel: null, defaultEffort: null })
    expect(run).toHaveBeenCalledWith(
      {
        file: '/home/me/.local/bin/agy',
        args: ['models'],
        env: { PATH: '/usr/bin', HOME: '/home/me', AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
        cwd: '/home/me',
      },
      30_000,
    )
  })

  it('offers no model when it is signed in with no Google account', async () => {
    expect(
      await readAntigravityLaunchOptions({
        command: '/home/me/.local/bin/agy',
        env: {},
        home: '/home/me',
        platform: 'darwin',
        run: signedOut,
      }),
    ).toEqual({ models: [], defaultEfforts: [], defaultModel: null, defaultEffort: null })
  })
})

describe('withoutAntigravityUpdates', () => {
  it('turns its updater off in a copy of the environment', () => {
    const env = { PATH: '/usr/bin', AGY_CLI_DISABLE_AUTO_UPDATE: 'false' }
    expect(withoutAntigravityUpdates(env)).toEqual({
      PATH: '/usr/bin',
      AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
    })
    expect(env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('false')
  })
})
