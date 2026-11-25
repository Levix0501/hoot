import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownProvider } from '../../shared/providers'
import {
  claudeConfigDirectory,
  claudeSessionEnv,
  claudeSettingsFile,
  claudeUserVariables,
  isClaudeProviderVariable,
} from './claude-config'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-claude-config-'))
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const file = () => claudeSettingsFile(home, {})

function writeSettings(settings: unknown): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(settings), { mode: 0o644 })
}

/** Writes a file of a project's Claude Code settings, `name` in the `.claude` of `folder`; text as it is. */
function writeProject(folder: string, name: string, content: unknown): void {
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true })
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  fs.writeFileSync(path.join(folder, '.claude', name), text)
}

describe("Claude Code's own configuration", () => {
  it('lives in CLAUDE_CONFIG_DIR when it is set, else in ~/.claude', () => {
    expect(claudeConfigDirectory('/home/me', {})).toBe(path.join('/home/me', '.claude'))
    expect(claudeConfigDirectory('/home/me', { CLAUDE_CONFIG_DIR: '/elsewhere' })).toBe(
      '/elsewhere',
    )
  })

  it('knows the variables that say which provider it runs on', () => {
    expect(isClaudeProviderVariable('ANTHROPIC_CUSTOM_HEADERS')).toBe(true)
    expect(isClaudeProviderVariable('CLAUDE_CODE_USE_VERTEX')).toBe(true)
    expect(isClaudeProviderVariable('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false)
    expect(isClaudeProviderVariable('CLAUDE_CODE_USE_POWERSHELL_TOOL')).toBe(false)
  })

  it('lists the provider variables the user’s settings and the login shell set', async () => {
    writeSettings({ model: 'opus', env: { ANTHROPIC_BASE_URL: 'x', DISABLE_TELEMETRY: '1' } })
    const project = path.join(home, 'project')
    fs.mkdirSync(project)
    expect(
      (
        await claudeUserVariables(home, { ANTHROPIC_API_KEY: 'y', PATH: '/bin' }, project)
      ).toSorted(),
    ).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'])
    // A settings file that cannot be read counts as none.
    fs.writeFileSync(file(), '{ not json')
    expect(await claudeUserVariables(home, {}, project)).toEqual([])
    // It is only read.
    expect(fs.readFileSync(file(), 'utf8')).toBe('{ not json')
  })

  it('lists those of the project’s settings too, in its folder and the folders above it', async () => {
    const repository = path.join(home, 'repository')
    const folder = path.join(repository, 'packages', 'app')
    writeProject(folder, 'settings.json', { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'x' } })
    writeProject(folder, 'settings.local.json', { env: { ANTHROPIC_CUSTOM_HEADERS: 'x' } })
    // Claude Code reads a project's local settings at the root of its repository.
    writeProject(repository, 'settings.local.json', { env: { ANTHROPIC_BETAS: 'x', FOO: '1' } })
    // A file that cannot be read counts as none.
    writeProject(repository, 'settings.json', '{ not json')
    expect((await claudeUserVariables(home, {}, folder)).toSorted()).toEqual([
      'ANTHROPIC_BETAS',
      'ANTHROPIC_CUSTOM_HEADERS',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
    ])
  })

  it('gives a session on its subscription no provider, and unsets the user’s', () => {
    const env = claudeSessionEnv(ownProvider('claude'), null, ['ANTHROPIC_CUSTOM_HEADERS'])
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('')
    expect(env.ANTHROPIC_BASE_URL).toBe('')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
    expect(Object.values(env).every((value) => value === '')).toBe(true)
  })
})
