import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import { SESSION_HEADER, type HootIssue } from '../../shared/hoot-cli'
import type { Issue } from '../../shared/issues'
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

/** An issue as the server answers with it: without a parent or sub-issues, unless given. */
function answered(saved: Issue, relations: Partial<Pick<HootIssue, 'parent' | 'subIssues'>> = {}) {
  return { ...saved, parent: null, subIssues: [], ...relations }
}

/** An issue as the server answers with it as another's parent or sub-issue. */
function related(saved: Issue, project: string | null) {
  const { id, title, status, projectId } = saved
  return { id, title, status, projectId, project }
}

/** The project of a session, as the server answers with it. */
const gamma = () => ({ id: hoot.gamma.id, name: 'gamma' })
const hotel = () => ({ id: hoot.hotel.id, name: 'hotel' })

describe('HootServer', () => {
  it("answers with the session's project and its issues", async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const other = hoot.issues.create({ projectId: hoot.hotel.id, ...issue, title: 'Other' })!
    const loose = hoot.issues.create({ projectId: null, ...issue, title: 'Loose' })!
    expect(await request('GET', '/issues')).toEqual({
      status: 200,
      answer: { ok: true, project: gamma(), issues: [answered(alpha)] },
    })
    expect(await request('GET', '/issues/1')).toEqual({
      status: 200,
      answer: { ok: true, project: gamma(), issue: answered(alpha) },
    })
    // Not the issues of another project or of none, nor numbers no issue has.
    for (const number of [other.id, loose.id, 99]) {
      expect((await request('GET', `/issues/${number}`)).answer).toEqual({
        ok: true,
        project: gamma(),
        issue: null,
      })
    }
    expect((await request('GET', `/issues/${'9'.repeat(40)}`)).answer.issue).toBeNull()
    expect((await request('GET', '/issues/1', { session: 'hotel-session' })).answer).toEqual({
      ok: true,
      project: hotel(),
      issue: null,
    })
    expect(
      (await request('GET', `/issues/${other.id}`, { session: 'hotel-session' })).answer,
    ).toEqual({ ok: true, project: hotel(), issue: answered(other) })
  })

  it('creates an issue in the project, and reports it once it is saved', async () => {
    const { status, answer } = await request('POST', '/issues', {
      body: JSON.stringify({ ...issue, title: ' Gamma ', status: 'done', priority: 3 }),
    })
    expect(status).toBe(201)
    const saved = hoot.issues.getInProject(hoot.gamma.id, 1)
    expect(saved).toMatchObject({ title: 'Gamma', status: 'done', priority: 3 })
    expect(answer).toEqual({ ok: true, project: gamma(), issue: answered(saved!) })
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

  it("reports a step of the workflow of the session's issue, and answers with what comes next", async () => {
    const started = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    hoot.startIssueSession('issue-session', started.id)
    const { status, answer } = await request('POST', '/steps/report', {
      session: 'issue-session',
      body: JSON.stringify({ outcome: 'no-split', summary: 'Fits.' }),
    })
    expect(status).toBe(200)
    expect(answer).toEqual({
      ok: true,
      project: gamma(),
      report: {
        issue: 'ISS-1',
        step: 'Scope',
        outcome: 'No split',
        next: BUILT_IN_WORKFLOW.steps[1],
      },
    })
    expect(
      await request('POST', '/steps/report', {
        session: 'issue-session',
        body: JSON.stringify({ outcome: 'done', summary: 'x' }),
      }),
    ).toEqual({
      status: 409,
      answer: {
        ok: false,
        message: 'done is not an outcome of Design.\nOutcomes: implement, split',
      },
    })
    expect(
      (
        await request('POST', '/steps/report', {
          body: JSON.stringify({ outcome: 'no-split', summary: 'x' }),
        })
      ).answer,
    ).toEqual({ ok: false, message: 'this session was not started from an issue.' })
  })

  it('reports nothing from a request it cannot take', async () => {
    const started = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    hoot.startIssueSession('issue-session', started.id)
    const before = hoot.workflows.records(started.id)
    for (const body of [
      'not JSON',
      JSON.stringify({ outcome: 'no-split' }),
      JSON.stringify({ outcome: 'no-split', summary: ' \n ' }),
      JSON.stringify({ outcome: 'no-split', summary: 'x'.repeat(1_000_001) }),
      JSON.stringify({ outcome: 'no-split', summary: 'x', extra: true }),
    ]) {
      const { status, answer } = await request('POST', '/steps/report', {
        session: 'issue-session',
        body,
      })
      expect(status).toBe(400)
      expect(answer.ok).toBe(false)
    }
    expect(hoot.workflows.records(started.id)).toEqual(before)
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

  it('answers with the parents and sub-issues of issues, of any project shown, in order', async () => {
    const parent = hoot.issues.create({ projectId: null, ...issue, title: 'Parent' })!
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const sub = hoot.issues.create({
      projectId: hoot.hotel.id,
      ...issue,
      title: 'Sub',
      status: 'done',
    })!
    const own = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Own' })!
    hoot.issues.setParents([
      { issueId: alpha.id, parentId: parent.id },
      { issueId: sub.id, parentId: alpha.id },
      { issueId: own.id, parentId: alpha.id },
    ])
    const expected = answered(alpha, {
      parent: related(parent, null),
      subIssues: [related(sub, 'hotel'), related(own, 'gamma')],
    })
    expect((await request('GET', `/issues/${alpha.id}`)).answer.issue).toEqual(expected)
    expect((await request('GET', '/issues')).answer.issues).toEqual([
      expected,
      answered(own, { parent: related(alpha, 'gamma') }),
    ])
    // Not those of a project removed from the list.
    hoot.projects.remove(hoot.hotel.root)
    expect((await request('GET', `/issues/${alpha.id}`)).answer.issue).toEqual({
      ...expected,
      subIssues: [related(own, 'gamma')],
    })
  })

  it('changes nothing for a change it cannot take, and says why', async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const refused: Array<[string, string, number, string]> = [
      [`/issues/${alpha.id}`, 'not JSON', 400, 'The request is not JSON.'],
      [`/issues/${alpha.id}`, JSON.stringify({ parent: 1 }), 400, 'Invalid change.'],
      [`/issues/${alpha.id}`, JSON.stringify({ parent: 'ISS-1' }), 400, 'Invalid change.'],
      [`/issues/${alpha.id}`, JSON.stringify({ extra: true }), 400, 'Invalid change.'],
      [`/issues/${alpha.id}`, JSON.stringify({}), 400, 'Nothing to change.'],
      [
        `/issues/${alpha.id}`,
        JSON.stringify({ parent: '1', removeParent: true }),
        400,
        'An issue cannot both get a parent and lose its parent.',
      ],
      [
        `/issues/${'9'.repeat(40)}`,
        JSON.stringify({ removeParent: true }),
        404,
        `There is no issue ISS-${'9'.repeat(40)} in this session's project, gamma.`,
      ],
    ]
    for (const [url, body, status, message] of refused) {
      expect(await request('PATCH', url, { body })).toEqual({
        status,
        answer: { ok: false, message },
      })
    }
    expect(
      await request('POST', '/issues', { body: JSON.stringify({ ...issue, parent: 'one' }) }),
    ).toEqual({ status: 400, answer: { ok: false, message: 'Invalid issue.' } })
    expect(hoot.issues.subIssues()).toEqual({ version: 0, links: [] })
    expect(hoot.issues.list()).toEqual([alpha])
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
      listProjects: () => hoot.projects.list(),
      issues: hoot.issues,
      issueCreated: () => {},
      reportStep: () => ({ ok: false, message: 'none' }),
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
      listProjects: () => [],
      issues: hoot.issues,
      issueCreated: () => {},
      reportStep: () => ({ ok: false, message: 'none' }),
    })
    await server.stop()
    const started = server.start()
    const stopped = server.stop()
    await started
    await stopped
    expect(fs.existsSync(socket)).toBe(false)
  })
})
