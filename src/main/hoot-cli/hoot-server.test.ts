import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

/** An issue as the server answers with it: without a parent, sub-issues or dependencies, unless given. */
function answered(
  saved: Issue,
  relations: Partial<Pick<HootIssue, 'parent' | 'subIssues' | 'blockedBy' | 'blocking'>> = {},
) {
  return {
    ...saved,
    parent: null,
    subIssues: [],
    blockedBy: [],
    blocking: [],
    labels: [],
    ...relations,
  }
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

  it('creates, changes and deletes labels, and gives and takes them off issues, by name', async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const created = await request('POST', '/labels', {
      body: JSON.stringify({ name: 'bug', color: 'EB5757', description: 'Broken' }),
    })
    expect(created).toEqual({
      status: 201,
      answer: {
        ok: true,
        project: gamma(),
        label: { name: 'bug', color: 'eb5757', description: 'Broken', group: null },
      },
    })
    expect(
      (
        await request('PATCH', `/issues/${alpha.id}`, {
          body: JSON.stringify({ addLabels: ['BUG', 'Design'] }),
        })
      ).answer.issue,
    ).toMatchObject({
      labels: [
        { name: 'bug', group: null },
        { name: 'Design', group: 'Spec-driven' },
      ],
    })
    expect(
      await request('PATCH', `/labels/${encodeURIComponent('bug')}`, {
        body: JSON.stringify({ name: 'flaw' }),
      }),
    ).toMatchObject({ status: 200, answer: { label: { name: 'flaw' } } })
    expect(await request('DELETE', '/labels/flaw')).toEqual({
      status: 200,
      answer: { ok: true, project: gamma() },
    })
    expect(hoot.labels.labelsOf(alpha.id).map((label) => label.name)).toEqual(['Design'])
    for (const [method, url, body, status, message] of [
      ['DELETE', '/labels/Scope', undefined, 409, 'belongs to the workflow Spec-driven'],
      ['DELETE', '/labels/nope', undefined, 404, 'There is no label named "nope".'],
      ['PATCH', '/labels/Scope', JSON.stringify({}), 400, 'Nothing to change.'],
      ['POST', '/labels', JSON.stringify({ name: 'scope' }), 409, 'There is a label named'],
      ['POST', '/labels', JSON.stringify({ name: 'z', color: 'red' }), 409, 'is not a color'],
      [
        'PATCH',
        `/issues/${alpha.id}`,
        JSON.stringify({ addLabels: ['nope'] }),
        404,
        'There is no label named "nope".',
      ],
    ] as const) {
      const answer = await request(method, url, body === undefined ? {} : { body })
      expect(answer.status).toBe(status)
      expect(answer.answer.message).toContain(message)
    }
  })

  it('starts a session for an issue of the project, unless it cannot be started now', async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const beta = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Beta' })!
    expect(
      await request('POST', '/sessions', {
        body: JSON.stringify({ issue: String(alpha.id), prompt: 'Hello' }),
      }),
    ).toEqual({
      status: 201,
      answer: { ok: true, project: gamma(), worktreePath: `/worktrees/gamma/iss-${alpha.id}` },
    })
    expect(hoot.startedSessions).toEqual([{ issueId: alpha.id, prompt: 'Hello' }])
    hoot.issues.changeRelations({ addDependencies: [{ issueId: beta.id, blockedById: alpha.id }] })
    const refused = await request('POST', '/sessions', {
      body: JSON.stringify({ issue: String(beta.id) }),
    })
    expect(refused.status).toBe(409)
    expect(refused.answer.message).toBe(
      `Work on ISS-${beta.id} cannot be started now:\n` +
        `- It waits on ISS-${alpha.id}, which is neither done nor canceled.`,
    )
    for (const body of ['not JSON', JSON.stringify({ issue: 'ISS-1' }), JSON.stringify({})]) {
      expect((await request('POST', '/sessions', { body })).status).toBe(400)
    }
    expect(hoot.startedSessions).toHaveLength(1)
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

  it('answers with the issues an issue is blocked by and those it blocks, of any project shown, in order', async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const loose = hoot.issues.create({ projectId: null, ...issue, title: 'Loose' })!
    const other = hoot.issues.create({ projectId: hoot.hotel.id, ...issue, title: 'Other' })!
    const own = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Own' })!
    hoot.issues.changeRelations({
      addDependencies: [
        { issueId: alpha.id, blockedById: other.id },
        { issueId: alpha.id, blockedById: loose.id },
        { issueId: own.id, blockedById: alpha.id },
      ],
    })
    const expected = answered(alpha, {
      blockedBy: [related(other, 'hotel'), related(loose, null)],
      blocking: [related(own, 'gamma')],
    })
    expect((await request('GET', `/issues/${alpha.id}`)).answer.issue).toEqual(expected)
    expect((await request('GET', '/issues')).answer.issues).toEqual([
      expected,
      answered(own, { blockedBy: [related(alpha, 'gamma')] }),
    ])
    // Not those of a project removed from the list.
    hoot.projects.remove(hoot.hotel.root)
    expect((await request('GET', `/issues/${alpha.id}`)).answer.issue).toEqual({
      ...expected,
      blockedBy: [related(loose, null)],
    })
  })

  it('creates an issue with dependencies, and sub-issues of an issue all at once', async () => {
    const alpha = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Alpha' })!
    const beta = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Beta' })!
    const charlie = hoot.issues.create({ projectId: hoot.gamma.id, ...issue, title: 'Charlie' })!
    const created = await request('POST', '/issues', {
      body: JSON.stringify({
        ...issue,
        title: 'New',
        blockedBy: [String(alpha.id)],
        blocking: [String(beta.id)],
      }),
    })
    expect(created.status).toBe(201)
    const id = (created.answer.issue as HootIssue).id
    expect(hoot.issues.dependencies().links).toEqual([
      { issueId: id, blockedById: alpha.id },
      { issueId: beta.id, blockedById: id },
    ])
    const split = await request('POST', `/issues/${alpha.id}/sub-issues`, {
      body: JSON.stringify({
        issues: [
          { ...issue, title: 'S1', blockedBy: [], blocking: [], labels: [] },
          {
            ...issue,
            title: 'S2',
            blockedBy: [{ item: 1 }, { issue: String(charlie.id) }],
            blocking: [{ issue: String(alpha.id) }],
            labels: ['Implement'],
          },
        ],
      }),
    })
    expect(split.status).toBe(201)
    const [s1, s2] = split.answer.issues as HootIssue[]
    expect(s2!.blockedBy.map((entry) => entry.id)).toEqual([s1!.id, charlie.id])
    expect(s2!.blocking.map((entry) => entry.id)).toEqual([alpha.id])
    expect(s2!.labels.map((label) => label.name)).toEqual(['Implement'])
    expect(hoot.issues.subIssues().links).toEqual([
      { issueId: s1!.id, parentId: alpha.id },
      { issueId: s2!.id, parentId: alpha.id },
    ])
    expect(hoot.created.map((entry) => entry.title)).toEqual(['New', 'S1', 'S2'])
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
    expect(
      await request('POST', '/issues', { body: JSON.stringify({ ...issue, blockedBy: [1] }) }),
    ).toEqual({ status: 400, answer: { ok: false, message: 'Invalid issue.' } })
    expect(
      await request('POST', '/issues', {
        body: JSON.stringify({
          ...issue,
          blockedBy: [String(alpha.id)],
          blocking: [String(alpha.id)],
        }),
      }),
    ).toEqual({
      status: 409,
      answer: {
        ok: false,
        message:
          `The new issue cannot be blocked by ISS-${alpha.id}, which waits for it already: ` +
          `ISS-${alpha.id} is blocked by the new issue.`,
      },
    })
    for (const [body, status, message] of [
      [{ issues: [{ ...issue }] }, 400, 'Invalid issues.'],
      [
        { issues: [{ ...issue, blockedBy: [{ item: 2 }], blocking: [], labels: [] }] },
        400,
        'Item 1 names item 2, and there is only 1 item.',
      ],
      [
        { issues: [{ ...issue, blockedBy: [{ item: 1 }], blocking: [], labels: [] }] },
        409,
        'Item 1 cannot be blocked by itself.',
      ],
      [
        { issues: [{ ...issue, title: ' ', blockedBy: [], blocking: [], labels: [] }] },
        400,
        'Item 1 has an empty title: an issue needs one.',
      ],
      [
        { issues: [{ ...issue, blockedBy: [], blocking: [], labels: ['nope'] }] },
        404,
        'There is no label named "nope". Run "hoot label list" for the labels there are.',
      ],
    ] as const) {
      expect(
        await request('POST', `/issues/${alpha.id}/sub-issues`, { body: JSON.stringify(body) }),
      ).toEqual({ status, answer: { ok: false, message } })
    }
    expect(hoot.issues.subIssues()).toEqual({ version: 0, links: [] })
    expect(hoot.issues.dependencies()).toEqual({ version: 0, links: [] })
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
      labels: hoot.labels,
      together: (body) => body(),
      issueCreated: () => {},
      startBlockers: () => [],
      startSession: async () => ({ ok: false, message: 'none' }),
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
      labels: hoot.labels,
      together: (body) => body(),
      issueCreated: () => {},
      startBlockers: () => [],
      startSession: async () => ({ ok: false, message: 'none' }),
    })
    await server.stop()
    const started = server.start()
    const stopped = server.stop()
    await started
    await stopped
    expect(fs.existsSync(socket)).toBe(false)
  })
})
