import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_HEADER } from '../../shared/hoot-cli'
import { HootServer } from './hoot-server'
import { leaveSocket, startTestHoot, type TestHoot } from './test-support'

let hoot: TestHoot

beforeEach(async () => {
  hoot = await startTestHoot()
})

afterEach(async () => {
  await hoot.stop()
})

/** Sends a request to the test Hoot, and returns its status and JSON answer. */
function request(
  method: string,
  url: string,
  options: { session?: string | null; body?: string } = {},
): Promise<{ status: number; answer: Record<string, unknown> }> {
  const session = options.session === undefined ? 'gamma-session' : options.session
  return new Promise((resolve, reject) => {
    const sent = http.request(
      {
        socketPath: hoot.socket,
        method,
        path: url,
        agent: false,
        headers: session === null ? {} : { [SESSION_HEADER]: session },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            answer: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          }),
        )
      },
    )
    sent.on('error', reject)
    sent.end(options.body)
  })
}

const issue = { title: 'New', description: '', status: 'backlog', priority: 0 } as const

describe('HootServer', () => {
  it("answers with the session's project and its issues", async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const other = hoot.issues.create({ projectId: hoot.hotel.id, ...issue, title: 'Other' })!
    const loose = hoot.issues.create({ projectId: null, ...issue, title: 'Loose' })!
    expect(await request('GET', '/issues')).toEqual({
      status: 200,
      answer: { ok: true, project: { name: 'gamma' }, issues: [alpha] },
    })
    expect(await request('GET', '/issues/1')).toEqual({
      status: 200,
      answer: { ok: true, project: { name: 'gamma' }, issue: alpha },
    })
    // Not the issues of another project or of none, nor numbers no issue has.
    for (const number of [other.id, loose.id, 99]) {
      expect((await request('GET', `/issues/${number}`)).answer).toEqual({
        ok: true,
        project: { name: 'gamma' },
        issue: null,
      })
    }
    expect((await request('GET', `/issues/${'9'.repeat(40)}`)).answer.issue).toBeNull()
    expect((await request('GET', '/issues/1', { session: 'hotel-session' })).answer).toEqual({
      ok: true,
      project: { name: 'hotel' },
      issue: null,
    })
    expect(
      (await request('GET', `/issues/${other.id}`, { session: 'hotel-session' })).answer,
    ).toEqual({ ok: true, project: { name: 'hotel' }, issue: other })
  })

  it('creates an issue in the project, and reports it once it is saved', async () => {
    const { status, answer } = await request('POST', '/issues', {
      body: JSON.stringify({ ...issue, title: ' Gamma ', status: 'done', priority: 3 }),
    })
    expect(status).toBe(201)
    const saved = hoot.issues.getInProject(hoot.gamma.id, 1)
    expect(saved).toMatchObject({ title: 'Gamma', status: 'done', priority: 3 })
    expect(answer).toEqual({ ok: true, project: { name: 'gamma' }, issue: saved })
    expect(hoot.created).toEqual([saved])
  })

  it('saves the title on one line, as the new issue dialog does', async () => {
    const { status, answer } = await request('POST', '/issues', {
      body: JSON.stringify({ ...issue, title: 'Fix\r\nthe\nlogin\rbug' }),
    })
    expect(status).toBe(201)
    expect(answer).toMatchObject({ ok: true, issue: { title: 'Fix the login bug' } })
    expect(hoot.issues.getInProject(hoot.gamma.id, 1)?.title).toBe('Fix the login bug')
  })

  it('creates nothing from a request it cannot take, and says why', async () => {
    const refused: Array<[string, Record<string, unknown>, number, string]> = [
      ['not JSON', {}, 400, 'The request is not JSON.'],
      [JSON.stringify({ ...issue, status: 'started' }), {}, 400, 'Invalid issue.'],
      [JSON.stringify({ ...issue, priority: 5 }), {}, 400, 'Invalid issue.'],
      [JSON.stringify({ ...issue, title: 'T'.repeat(10_001) }), {}, 400, 'Invalid issue.'],
      [JSON.stringify({ ...issue, projectId: hoot.hotel.id }), {}, 400, 'Invalid issue.'],
      [JSON.stringify({ ...issue, title: ' \t ' }), {}, 400, 'An issue needs a title.'],
    ]
    for (const [body, , status, message] of refused) {
      expect(await request('POST', '/issues', { body })).toEqual({
        status,
        answer: { ok: false, message },
      })
    }
    expect(hoot.issues.list()).toEqual([])
    expect(hoot.created).toEqual([])
  })

  it('answers only for a session it knows, and only what it knows', async () => {
    expect(await request('GET', '/issues', { session: null })).toEqual({
      status: 400,
      answer: { ok: false, message: 'The request does not say which session it comes from.' },
    })
    expect(await request('GET', '/issues', { session: 'closed' })).toEqual({
      status: 404,
      answer: { ok: false, message: 'No such session.' },
    })
    for (const [method, url] of [
      ['GET', '/'],
      ['DELETE', '/issues/1'],
      ['GET', '/issues/abc'],
      ['PUT', '/issues'],
    ]) {
      expect(await request(method!, url!)).toEqual({
        status: 404,
        answer: { ok: false, message: 'Hoot does not know this request.' },
      })
    }
  })

  it('listens on a socket only the user can connect to, and removes it when it stops', async () => {
    expect(fs.statSync(hoot.socket).mode & 0o777).toBe(0o600)
    expect(fs.statSync(hoot.socket).isSocket()).toBe(true)
    await hoot.server.stop()
    expect(fs.existsSync(hoot.socket)).toBe(false)
  })

  it('takes the place of a socket left by a Hoot that stopped without quitting', async () => {
    const socket = path.join(hoot.directory, 'left.sock')
    await leaveSocket(socket)
    expect(fs.statSync(socket).isSocket()).toBe(true)
    const server = new HootServer({
      address: socket,
      sessionProject: () => ({ ok: true, project: hoot.gamma }),
      issues: hoot.issues,
      issueCreated: () => {},
    })
    await server.start()
    const answer = await new Promise<string>((resolve, reject) => {
      http
        .get({ socketPath: socket, path: '/issues', headers: { [SESSION_HEADER]: 'any' } }, (r) => {
          let text = ''
          r.on('data', (chunk) => (text += chunk))
          r.on('end', () => resolve(text))
        })
        .on('error', reject)
    })
    expect(JSON.parse(answer)).toMatchObject({ ok: true, project: { name: 'gamma' } })
    await server.stop()
  })

  it('stops also when it is asked to before it listens', async () => {
    const socket = path.join(hoot.directory, 'early.sock')
    const server = new HootServer({
      address: socket,
      sessionProject: () => ({ ok: false, message: 'none' }),
      issues: hoot.issues,
      issueCreated: () => {},
    })
    await server.stop()
    const started = server.start()
    const stopped = server.stop()
    await started
    await stopped
    expect(fs.existsSync(socket)).toBe(false)
  })
})
