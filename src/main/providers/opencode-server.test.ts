import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeNodeCommand } from '../tools/test-support'
import { OpenCodeServers } from './opencode-server'

let root: string
let configFile: string
let stateFile: string
let command: string
/** What each start of the stand-in OpenCode was given, a line of JSON each. */
let starts: string
let servers: OpenCodeServers | null
/** Processes a test started itself, which it ends. */
let others: ChildProcess[]

/**
 * A stand-in for `opencode serve`: a server on a port the system picks that
 * asks for its password as OpenCode's does, which says where it listens, as
 * OpenCode does, and notes what it was started with. With `FAIL_START`, it
 * ends before it listens.
 */
const SERVE = `const fs = require('node:fs')
const http = require('node:http')
fs.appendFileSync(process.env.STARTS, JSON.stringify({
  args: process.argv.slice(2),
  config: process.env.OPENCODE_CONFIG,
  password: process.env.OPENCODE_SERVER_PASSWORD,
  pid: process.pid,
}) + '\\n')
if (process.env.FAIL_START) {
  console.error('Error: the port is taken')
  process.exit(1)
}
const expected = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64')
const server = http.createServer((request, response) => {
  response.statusCode = request.headers.authorization === expected ? 200 : 401
  response.end('{}')
})
server.listen(0, '127.0.0.1', () => {
  console.log('server listening on http://127.0.0.1:' + server.address().port)
})
`

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-opencode-server-'))
  configFile = path.join(root, 'hoot', 'opencode', 'opencode.json')
  stateFile = path.join(root, 'hoot', 'opencode-servers.json')
  starts = path.join(root, 'starts.jsonl')
  command = await writeNodeCommand(path.join(root, 'bin', 'opencode'), SERVE)
  servers = null
  others = []
})

afterEach(async () => {
  await servers?.stopAll()
  for (const child of others) child.kill('SIGKILL')
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function make(config: () => unknown = () => ({ providers: {} })): OpenCodeServers {
  servers = new OpenCodeServers({
    configFile,
    config,
    stateFile,
    cwd: root,
  })
  return servers
}

/** What the stand-in was started with, each start. */
function started(): Array<{ args: string[]; config: string; password: string; pid: number }> {
  if (!fs.existsSync(starts)) return []
  return fs
    .readFileSync(starts, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ReturnType<typeof started>[number])
}

/** Whether a process runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(condition()).toBe(true)
}

const env = () => ({ ...process.env, STARTS: starts }) as Record<string, string>

describe('OpenCodeServers', () => {
  it("starts one server for an OpenCode, on the computer's own address, with Hoot's configuration and a password of its own", async () => {
    const config = { providers: { 'hoot-p1': { name: 'Kimi' } } }
    const opencode = make(() => config)
    const server = await opencode.ensure(command, env())
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.password.length).toBeGreaterThanOrEqual(32)
    expect(await opencode.ensure(command, env())).toEqual(server)
    const [start, ...more] = started()
    expect(more).toEqual([])
    expect(start!.args.slice(-5)).toEqual(['serve', '--port', '0', '--hostname', '127.0.0.1'])
    expect(start!.config).toBe(configFile)
    expect(start!.password).toBe(server.password)
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8'))).toEqual(config)
    expect(fs.statSync(configFile).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600)
    // It asks for its password.
    expect((await fetch(server.url)).status).toBe(401)
    // It is noted for the next Hoot.
    await until(() => fs.existsSync(stateFile))
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toEqual([{ ...server, pid: start!.pid }])
  })

  it('writes the configuration again as it changes, while a server runs', async () => {
    let config: unknown = { providers: {} }
    const opencode = make(() => config)
    config = { providers: { 'hoot-p1': {} } }
    await opencode.configChanged()
    expect(fs.existsSync(configFile)).toBe(false)
    await opencode.ensure(command, env())
    config = { providers: { 'hoot-p2': {} } }
    await opencode.configChanged()
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8'))).toEqual(config)
  })

  it('starts a server again for the next session after it ended', async () => {
    const opencode = make()
    const first = await opencode.ensure(command, env())
    process.kill(started()[0]!.pid)
    await until(() => !alive(started()[0]!.pid))
    let next = await opencode.ensure(command, env())
    // The one that ended may not be forgotten at once.
    for (let tries = 0; next.url === first.url && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      next = await opencode.ensure(command, env())
    }
    expect(next.url).not.toBe(first.url)
    expect(started()).toHaveLength(2)
  })

  it('says why a server did not start, and tries again for the next session', async () => {
    const opencode = make()
    await expect(opencode.ensure(command, { ...env(), FAIL_START: '1' })).rejects.toThrow(
      'Error: the port is taken',
    )
    await expect(opencode.ensure(command, env())).resolves.toMatchObject({
      url: expect.stringMatching(/^http:/) as unknown,
    })
  })

  it('stops its servers as Hoot quits, and removes the configuration, which holds keys', async () => {
    const opencode = make()
    await opencode.ensure(command, env())
    const { pid } = started()[0]!
    await until(() => fs.existsSync(stateFile))
    await opencode.stopAll()
    expect(alive(pid)).toBe(false)
    expect(fs.existsSync(configFile)).toBe(false)
    expect(fs.existsSync(stateFile)).toBe(false)
  })

  it('stops the servers a Hoot that did not quit left running, and no other program', async () => {
    // A server of an earlier Hoot's, left running.
    const earlier = make()
    const left = await earlier.ensure(command, env())
    const { pid } = started()[0]!
    await until(() => fs.existsSync(stateFile))
    servers = null
    // A program that answers anyone, under a pid and address noted with it.
    const stranger = spawn(
      process.execPath,
      [
        '-e',
        `require('node:http').createServer((q, r) => r.end()).listen(0, '127.0.0.1', function () { console.log(this.address().port) })`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    others.push(stranger)
    const port = await new Promise<string>((resolve) =>
      stranger.stdout!.once('data', (chunk: Buffer) => resolve(chunk.toString().trim())),
    )
    const noted = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as unknown[]
    fs.writeFileSync(
      stateFile,
      JSON.stringify([
        ...noted,
        { url: `http://127.0.0.1:${port}`, password: left.password, pid: stranger.pid },
        { url: 'http://127.0.0.1:1', password: 'x', pid: stranger.pid },
        'not a server',
      ]),
    )
    const next = make()
    await next.stopLeftOver()
    await until(() => !alive(pid))
    expect(alive(stranger.pid!)).toBe(true)
    expect(fs.existsSync(stateFile)).toBe(false)
    expect(fs.existsSync(configFile)).toBe(false)
  })
})
