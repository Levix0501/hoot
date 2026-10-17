import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getCodingTool } from '../../shared/tools'
import { detectInstallMethod, npmPrefixOf, type InstallMethodContext } from './install-method'

let root: string
let home: string

function file(target: string, mode = 0o755): string {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '#!/bin/sh\n', { mode })
  return target
}

function link(from: string, to: string): string {
  fs.mkdirSync(path.dirname(from), { recursive: true })
  fs.symlinkSync(to, from)
  return from
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-method-')))
  home = path.join(root, 'home')
  fs.mkdirSync(home)
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

function context(overrides: Partial<InstallMethodContext> = {}): InstallMethodContext {
  return {
    home,
    agentsDirectory: path.join(home, '.hoot', 'agents'),
    env: {},
    computerNpm: null,
    npmGlobalFolder: async () => null,
    ...overrides,
  }
}

describe('detectInstallMethod', () => {
  it("tells an agent installed in Hoot's folder", async () => {
    const agents = path.join(home, '.hoot', 'agents')
    const target = file(
      path.join(agents, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    )
    const command = link(path.join(agents, 'bin', 'codex'), target)
    expect(await detectInstallMethod(getCodingTool('codex'), command, context())).toEqual({
      kind: 'hoot',
    })
  })

  it("tells an agent installed by the computer's npm into its global folder", async () => {
    const prefix = path.join(root, 'nvm', 'v24')
    const target = file(
      path.join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    )
    const command = link(path.join(prefix, 'bin', 'claude'), target)
    const npm = path.join(prefix, 'bin', 'npm')
    expect(
      await detectInstallMethod(
        getCodingTool('claude'),
        command,
        context({ computerNpm: { path: npm, prefix, usable: true } }),
      ),
    ).toEqual({ kind: 'npm', prefix, npm, computer: true })
  })

  it('tells an agent installed by the npm of another global folder', async () => {
    const prefix = path.join(root, 'other-node')
    const target = file(
      path.join(prefix, 'lib', 'node_modules', '@opencode', 'cli', 'bin', 'opencode'),
    )
    const command = link(path.join(prefix, 'bin', 'opencode'), target)
    const npm = file(path.join(prefix, 'bin', 'npm'))
    const asked: string[] = []
    const npmGlobalFolder = async (other: string) => {
      asked.push(other)
      return other === npm ? prefix : null
    }
    expect(
      await detectInstallMethod(getCodingTool('opencode'), command, context({ npmGlobalFolder })),
    ).toEqual({ kind: 'npm', prefix, npm, computer: false })
    expect(asked).toEqual([npm])
    // Without an npm whose global folder it is, Hoot cannot tell.
    expect(
      await detectInstallMethod(
        getCodingTool('opencode'),
        command,
        context({ npmGlobalFolder: async () => path.join(root, 'elsewhere') }),
      ),
    ).toEqual({ kind: 'unknown' })
  })

  it('tells a formula or a cask of Homebrew, beside its brew', async () => {
    const brewPrefix = path.join(root, 'homebrew')
    const brew = file(path.join(brewPrefix, 'bin', 'brew'))
    const cask = link(
      path.join(brewPrefix, 'bin', 'claude'),
      file(path.join(brewPrefix, 'Caskroom', 'claude-code', '2.1.0', 'claude')),
    )
    expect(await detectInstallMethod(getCodingTool('claude'), cask, context())).toEqual({
      kind: 'homebrew',
      brew,
      name: 'claude-code',
      cask: true,
    })
    const formula = link(
      path.join(brewPrefix, 'bin', 'opencode'),
      file(path.join(brewPrefix, 'Cellar', 'opencode', '1.0.0', 'bin', 'opencode')),
    )
    expect(await detectInstallMethod(getCodingTool('opencode'), formula, context())).toEqual({
      kind: 'homebrew',
      brew,
      name: 'opencode',
      cask: false,
    })
    // A Cellar folder without a brew beside it is not Homebrew's.
    const loose = file(path.join(root, 'loose', 'Cellar', 'codex', '1.0.0', 'codex'))
    expect(await detectInstallMethod(getCodingTool('codex'), loose, context())).toEqual({
      kind: 'unknown',
    })
  })

  it("tells each agent's official installer", async () => {
    const claude = link(
      path.join(home, '.local', 'bin', 'claude'),
      file(path.join(home, '.local', 'share', 'claude', 'versions', '2.1.0')),
    )
    expect(await detectInstallMethod(getCodingTool('claude'), claude, context())).toEqual({
      kind: 'official',
    })

    const codex = link(
      path.join(home, '.local', 'bin', 'codex'),
      file(path.join(home, '.codex', 'packages', 'standalone', 'releases', '0.1.0', 'codex')),
    )
    expect(await detectInstallMethod(getCodingTool('codex'), codex, context())).toEqual({
      kind: 'official',
    })
    // Where CODEX_HOME says Codex keeps its files.
    const codexHome = path.join(root, 'codex-home')
    const elsewhere = link(
      path.join(root, 'bin', 'codex'),
      file(path.join(codexHome, 'packages', 'standalone', 'codex')),
    )
    expect(
      await detectInstallMethod(
        getCodingTool('codex'),
        elsewhere,
        context({ env: { CODEX_HOME: codexHome } }),
      ),
    ).toEqual({ kind: 'official' })
    expect(await detectInstallMethod(getCodingTool('codex'), elsewhere, context())).toEqual({
      kind: 'unknown',
    })

    const opencode = file(path.join(home, '.opencode', 'bin', 'opencode'))
    expect(await detectInstallMethod(getCodingTool('opencode'), opencode, context())).toEqual({
      kind: 'official',
    })
  })

  it('cannot tell a command that is none of these', async () => {
    const command = file(path.join(root, 'manual', 'claude'))
    expect(await detectInstallMethod(getCodingTool('claude'), command, context())).toEqual({
      kind: 'unknown',
    })
  })
})

describe('npmPrefixOf', () => {
  it('tells the global folder a package was installed into, on each platform', () => {
    expect(
      npmPrefixOf(
        '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
        '@openai/codex',
        'darwin',
      ),
    ).toBe('/usr/local')
    // At the root of the file system, the global folder is the root itself.
    expect(
      npmPrefixOf('/lib/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'linux'),
    ).toBe('/')
    expect(
      npmPrefixOf(
        '/Users/me/.hoot/agents/lib/node_modules/@openai/codex/bin/codex.js',
        '@openai/codex',
        'darwin',
      ),
    ).toBe('/Users/me/.hoot/agents')

    // On Windows the global folder holds packages in `node_modules` itself.
    expect(
      npmPrefixOf(
        'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
        '@openai/codex',
        'win32',
      ),
    ).toBe('C:\\Users\\me\\AppData\\Roaming\\npm')
    // Node.js's npm installs its packages into the folder of Node.js itself.
    expect(
      npmPrefixOf('D:\\software\\node\\node_modules\\npm\\bin\\npm-cli.js', 'npm', 'win32'),
    ).toBe('D:\\software\\node')
    expect(
      npmPrefixOf(
        'D:\\software\\node\\node_modules\\@openai\\codex\\bin\\codex.js',
        '@openai/codex',
        'win32',
      ),
    ).toBe('D:\\software\\node')

    // A file that is in no global folder.
    expect(npmPrefixOf('/usr/local/bin/claude', '@anthropic-ai/claude-code', 'darwin')).toBeNull()
    expect(npmPrefixOf('C:\\tools\\claude.exe', '@anthropic-ai/claude-code', 'win32')).toBeNull()
    // Another package's file, in the same folder, is no match.
    expect(
      npmPrefixOf(
        '/usr/local/lib/node_modules/other/bin/claude',
        '@anthropic-ai/claude-code',
        'darwin',
      ),
    ).toBeNull()
  })
})
