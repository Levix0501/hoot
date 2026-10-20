import { describe, expect, it } from 'vitest'
import type { AgentLaunchSettings } from './launch-settings'
import {
  commandSegments,
  displayCommand,
  extraArgumentKinds,
  splitArguments,
  YOLO_ARGUMENTS,
} from './launch-command'

const settings = (overrides: Partial<AgentLaunchSettings> = {}): AgentLaunchSettings => ({
  enabled: true,
  model: null,
  effort: null,
  extraArgs: [],
  ...overrides,
})

describe('extraArgumentKinds', () => {
  it('finds the arguments that decide permissions, models and effort', () => {
    expect(extraArgumentKinds('claude', ['--permission-mode', 'plan'])).toEqual({
      permission: true,
      model: false,
      effort: false,
    })
    expect(extraArgumentKinds('claude', ['--permission-mode=plan', '--model=opus'])).toEqual({
      permission: true,
      model: true,
      effort: false,
    })
    expect(
      extraArgumentKinds('claude', ['--dangerously-skip-permissions', '--effort', 'max']),
    ).toEqual({ permission: true, model: false, effort: true })
    expect(extraArgumentKinds('codex', ['-s', 'read-only', '-a', 'on-request'])).toEqual({
      permission: true,
      model: false,
      effort: false,
    })
    expect(
      extraArgumentKinds('codex', [
        '--approve-for-me',
        '-m',
        'gpt-5.5',
        '-c',
        'model_reasoning_effort=low',
      ]),
    ).toEqual({ permission: true, model: true, effort: true })
    expect(
      extraArgumentKinds('codex', ['--config=sandbox_mode=danger-full-access', '--yolo']),
    ).toEqual({ permission: true, model: false, effort: false })
    expect(extraArgumentKinds('opencode', ['--auto'])).toEqual({
      permission: true,
      model: false,
      effort: false,
    })
    expect(extraArgumentKinds('opencode', ['--verbose'])).toEqual({
      permission: false,
      model: false,
      effort: false,
    })
  })

  it('does not take the value of a config override for another option', () => {
    expect(extraArgumentKinds('codex', ['-c', 'model=gpt-5.5', '--verbose'])).toEqual({
      permission: false,
      model: true,
      effort: false,
    })
  })
})

describe('commandSegments', () => {
  it('shows the program, the YOLO argument and the empty model and effort choices', () => {
    const segments = commandSegments({
      tool: 'claude',
      program: 'claude',
      yoloMode: true,
      settings: settings(),
      modelEfforts: [],
      defaultEfforts: ['low', 'high', 'max'],
    })
    expect(segments.map((segment) => segment.text)).toEqual([
      'claude',
      '--dangerously-skip-permissions',
      '+ model',
      '+ effort',
    ])
    expect(segments[1]).toMatchObject({ locked: true, note: 'Added by YOLO mode' })
    expect(displayCommand(segments)).toBe('claude --dangerously-skip-permissions')
  })

  it('shows the chosen model and effort as their arguments', () => {
    const segments = commandSegments({
      tool: 'claude',
      program: 'claude',
      yoloMode: false,
      settings: settings({ model: 'opus', effort: 'max', extraArgs: ['--verbose'] }),
      modelEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEfforts: [],
    })
    expect(segments.map((segment) => segment.text)).toEqual([
      'claude',
      '--model opus',
      '--effort max',
      '--verbose',
    ])
    expect(displayCommand(segments)).toBe('claude --model opus --effort max --verbose')
  })

  it('leaves out the model and effort that extra arguments decide, and leaves their arguments alone', () => {
    const segments = commandSegments({
      tool: 'codex',
      program: 'codex',
      yoloMode: true,
      settings: settings({
        model: 'opus',
        effort: 'max',
        extraArgs: ['-c', 'model_reasoning_effort=low', '--model', 'sonnet'],
      }),
      modelEfforts: [],
      defaultEfforts: [],
    })
    expect(segments.filter((segment) => segment.kind === 'permission')).toEqual([
      {
        kind: 'permission',
        args: ['--dangerously-bypass-approvals-and-sandbox'],
        text: '--dangerously-bypass-approvals-and-sandbox',
        locked: true,
        note: 'Added by YOLO mode',
      },
    ])
    expect(segments.find((segment) => segment.kind === 'model')).toBeUndefined()
    expect(segments.find((segment) => segment.kind === 'effort')).toBeUndefined()
    expect(
      segments
        .filter((segment) => segment.kind === 'argument')
        .map((segment) => [segment.text, segment.extraIndex]),
    ).toEqual([
      ['-c', 0],
      ['model_reasoning_effort=low', 1],
      ['--model', 2],
      ['sonnet', 3],
    ])
    expect(displayCommand(segments)).toBe(
      'codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort=low --model sonnet',
    )
  })

  it('leaves out the YOLO argument when extra arguments set permissions', () => {
    const segments = commandSegments({
      tool: 'claude',
      program: 'claude',
      yoloMode: true,
      settings: settings({ extraArgs: ['--permission-mode', 'plan'] }),
      modelEfforts: [],
      defaultEfforts: [],
    })
    expect(segments.find((segment) => segment.kind === 'permission')).toBeUndefined()
    expect(displayCommand(segments)).toBe('claude --permission-mode plan')
    expect(YOLO_ARGUMENTS.claude).toEqual(['--dangerously-skip-permissions'])
  })

  it('quotes arguments that have a space, as a shell would take them', () => {
    const segments = commandSegments({
      tool: 'claude',
      program: 'claude',
      yoloMode: false,
      settings: settings({ extraArgs: ['--append-system-prompt', 'Be brief'] }),
      modelEfforts: [],
      defaultEfforts: [],
    })
    expect(displayCommand(segments)).toBe('claude --append-system-prompt "Be brief"')
  })
})

describe('splitArguments', () => {
  it('splits at spaces and keeps quoted text as one argument', () => {
    expect(splitArguments('--model opus  --effort max')).toEqual([
      '--model',
      'opus',
      '--effort',
      'max',
    ])
    expect(splitArguments(`--append-system-prompt "Be brief" -c 'a b'`)).toEqual([
      '--append-system-prompt',
      'Be brief',
      '-c',
      'a b',
    ])
    expect(splitArguments('   ')).toEqual([])
  })
})
