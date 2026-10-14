import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  agentPaths,
  canonicalPath,
  homeDisplayPath,
  isInside,
  lastOnSessionPath,
  withHootNode,
} from './agent-paths'

describe('agentPaths', () => {
  it("keeps Hoot's agents in the home folder, and its node and npm with the app", () => {
    const packaged = agentPaths({
      home: '/Users/me',
      packaged: true,
      resourcesPath: '/Applications/Hoot.app/Contents/Resources',
      appPath: '/Applications/Hoot.app/Contents/Resources/app.asar',
      executable: '/Applications/Hoot.app/Contents/MacOS/Hoot',
    })
    expect(packaged).toEqual({
      directory: '/Users/me/.hoot/agents',
      binDirectory: '/Users/me/.hoot/agents/bin',
      nodeDirectory: '/Applications/Hoot.app/Contents/Resources/node',
      npmCli: '/Applications/Hoot.app/Contents/Resources/npm/bin/npm-cli.js',
      executable: '/Applications/Hoot.app/Contents/MacOS/Hoot',
    })
    const repository = agentPaths({
      home: '/Users/me',
      packaged: false,
      resourcesPath: '/elsewhere',
      appPath: '/code/hoot',
      executable: '/code/hoot/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    })
    expect(repository.nodeDirectory).toBe('/code/hoot/resources/node')
    expect(repository.npmCli).toBe('/code/hoot/node_modules/npm/bin/npm-cli.js')
    expect(repository.directory).toBe('/Users/me/.hoot/agents')
  })

  it("puts Hoot's node, then its folder of agents' commands, last on PATH", () => {
    const paths = agentPaths({
      home: '/Users/me',
      packaged: true,
      resourcesPath: '/R',
      appPath: '/R/app.asar',
      executable: '/M/Hoot',
    })
    expect(lastOnSessionPath(paths)).toEqual(['/R/node', '/Users/me/.hoot/agents/bin'])
    expect(withHootNode({ PATH: '/usr/bin', HOME: '/Users/me' }, paths)).toEqual({
      PATH: '/usr/bin:/R/node:/Users/me/.hoot/agents/bin',
      HOME: '/Users/me',
      HOOT_NODE: '/M/Hoot',
    })
  })
})

describe('paths as they are on disk and as Hoot shows them', () => {
  it('follows symbolic links, also of the part of a path that exists', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-canonical-')))
    try {
      fs.mkdirSync(path.join(root, 'real'))
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'))
      expect(await canonicalPath(path.join(root, 'link'))).toBe(path.join(root, 'real'))
      expect(await canonicalPath(path.join(root, 'link', 'not', 'yet'))).toBe(
        path.join(root, 'real', 'not', 'yet'),
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes the home folder as ~, however the path writes it', () => {
    expect(homeDisplayPath('/Users/me/.hoot/agents/bin/codex', '/Users/me', '/Users/me')).toBe(
      '~/.hoot/agents/bin/codex',
    )
    expect(homeDisplayPath('/private/var/home/x', '/var/home', '/private/var/home')).toBe('~/x')
    expect(homeDisplayPath('/opt/homebrew/bin/claude', '/Users/me', '/Users/me')).toBe(
      '/opt/homebrew/bin/claude',
    )
  })

  it('tells a path below a folder', () => {
    expect(isInside('/a/b/c', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(false)
    expect(isInside('/a/bc', '/a/b')).toBe(false)
  })
})

describe("Hoot's node", () => {
  const node = path.join(import.meta.dirname, '../../../resources/node/node')
  const run = promisify(execFile)

  it("runs Hoot's executable, which the environment names, as Node.js, with the arguments given", async () => {
    // Stands in for Hoot's executable: says what it was run with.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-node-'))
    try {
      const hoot = path.join(directory, 'Hoot')
      fs.writeFileSync(
        hoot,
        '#!/bin/sh\nprintf "ELECTRON_RUN_AS_NODE=%s\\n" "$ELECTRON_RUN_AS_NODE"\nfor a in "$@"; do printf "[%s]\\n" "$a"; done\n',
        { mode: 0o755 },
      )
      const { stdout } = await run(node, ['-e', 'a "b"  c'], {
        env: { PATH: '/usr/bin:/bin', HOOT_NODE: hoot },
      })
      expect(stdout).toBe('ELECTRON_RUN_AS_NODE=1\n[-e]\n[a "b"  c]\n')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('gives the version of the Node.js it runs as', async () => {
    const { stdout } = await run(node, ['-v'], {
      env: { PATH: '/usr/bin:/bin', HOOT_NODE: process.execPath },
    })
    expect(stdout.trim()).toBe(process.version)
  })

  it('says that it works only where Hoot runs it, elsewhere', async () => {
    await expect(run(node, ['-v'], { env: { PATH: '/usr/bin:/bin' } })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('this node works only where Hoot runs it'),
    })
  })
})
