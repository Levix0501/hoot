import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Issue, IssuePriority, IssueStatus } from '../shared/issues'
import { leaveSocket, startTestHoot, type TestHoot } from '../main/hoot-cli/test-support'
import { hookEventOf, runHoot } from './program'

let hoot: TestHoot

beforeEach(async () => {
  hoot = await startTestHoot()
})

afterEach(async () => {
  await hoot.stop()
})

/** Runs hoot as it runs in a session of the test Hoot, by default one of gamma. */
async function run(
  args: string[],
  options: { session?: string; stdin?: Uint8Array | string; env?: Record<string, string> } = {},
) {
  let stdout = ''
  let stderr = ''
  const code = await runHoot(args, {
    env: {
      HOOT_SOCKET: hoot.socket,
      HOOT_SESSION_ID: options.session ?? 'gamma-session',
      ...options.env,
    },
    write: (text) => (stdout += text),
    writeError: (text) => (stderr += text),
    readStdin: async () => Buffer.from(options.stdin ?? ''),
    readFile: (file) => fs.promises.readFile(file),
  })
  return { code, stdout, stderr }
}

/** Creates an issue in gamma as the new issue dialog does, at a time of its own. */
function addIssue(
  title: string,
  status: IssueStatus = 'backlog',
  priority: IssuePriority = 0,
  description = '',
): Issue {
  hoot.setClock(
    Date.UTC(2026, 9, 12, 6, 3) + hoot.issues.listInProject(hoot.gamma.id).length * 60_000,
  )
  return hoot.issues.create({ projectId: hoot.gamma.id, title, description, status, priority })!
}

/** A moment in local time, to the minute, as Sweden writes it: "2026-10-12 14:03". */
const localMinute = (time: number) =>
  new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(time)

const STEPS = '  Steps: open "Settings".\n\nThen click `Save`.'

/** The identifiers that start the lines `hoot issue list` prints. */
const identifiers = (stdout: string) =>
  stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ')[0])

/** The issues of gamma, as saved. */
const saved = () => hoot.issues.listInProject(hoot.gamma.id)

describe('hoot issue view', () => {
  beforeEach(() => {
    addIssue('Alpha', 'todo', 2, STEPS)
    const beta = addIssue('Beta')
    hoot.setClock(Date.UTC(2026, 9, 13, 1, 2, 3, 456))
    hoot.issues.update(beta.id, { status: 'done' })
  })

  it('shows an issue by its identifier or its number: identifier and title, then its properties, then its description', async () => {
    const byIdentifier = await run(['issue', 'view', 'ISS-1'])
    const byNumber = await run(['issue', 'view', '1'])
    expect(byIdentifier).toEqual(byNumber)
    expect(byIdentifier.code).toBe(0)
    expect(byIdentifier.stderr).toBe('')
    const created = hoot.issues.get(1)!.createdAt
    expect(byIdentifier.stdout).toBe(
      `ISS-1 Alpha\nTodo · High · Created ${localMinute(created)}\n\n${STEPS}\n`,
    )
  })

  it('ends with the second line when there is no description', async () => {
    const { code, stdout } = await run(['issue', 'view', '2'])
    expect(code).toBe(0)
    const lines = stdout.split('\n')
    expect(lines[0]).toBe('ISS-2 Beta')
    expect(lines[1]).toContain('Done')
    expect(lines[1]).toContain('No priority')
    expect(lines.slice(2)).toEqual([''])
  })

  it('prints the issue as a JSON object with --json', async () => {
    const alpha = hoot.issues.get(1)!
    const { code, stdout } = await run(['issue', 'view', 'ISS-1', '--json'])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toStrictEqual({
      identifier: 'ISS-1',
      number: 1,
      title: 'Alpha',
      description: STEPS,
      status: 'todo',
      priority: 'high',
      createdAt: new Date(alpha.createdAt).toISOString(),
      completedAt: null,
      parent: null,
      subIssues: [],
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      blockedBy: [],
      blocking: [],
      labels: [],
    })
    expect(JSON.parse(stdout).createdAt).toBe('2026-10-12T06:03:00.000Z')
    const beta = JSON.parse((await run(['issue', 'view', '2', '--json'])).stdout)
    expect(beta).toMatchObject({
      status: 'done',
      priority: 'none',
      description: '',
      completedAt: '2026-10-13T01:02:03.456Z',
    })
  })

  it('says that the project has no such issue, for an issue of another project or of none, or a number no issue has', async () => {
    const other = hoot.issues.create({
      projectId: hoot.hotel.id,
      title: 'Hotel issue',
      description: '',
      status: 'todo',
      priority: 0,
    })!
    const loose = hoot.issues.create({
      projectId: null,
      title: 'Loose issue',
      description: '',
      status: 'todo',
      priority: 0,
    })!
    for (const reference of [`ISS-${other.id}`, `${loose.id}`, '99', 'ISS-99', '0']) {
      const { code, stdout, stderr } = await run(['issue', 'view', reference])
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toMatch(
        /^error: There is no issue ISS-\d+ in this session's project, gamma\.\n$/,
      )
    }
    expect((await run(['issue', 'view', `${other.id}`])).stderr).toContain(`ISS-${other.id} `)
    expect((await run(['issue', 'view', '99'])).stderr).toContain('ISS-99')
    expect((await run(['issue', 'view', '123456789012345678901234567890'])).code).toBe(1)
  })

  it('refuses what is neither an identifier nor a number', async () => {
    for (const reference of ['abc', 'ISS-', '1.5', 'ISS-1-2', 'ISS 1', 'iss-1', 'GAM-1', '']) {
      const { code, stdout, stderr } = await run(['issue', 'view', reference])
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('is neither an issue')
    }
  })

  it("reads the issues of the session's own project", async () => {
    hoot.issues.create({
      projectId: hoot.hotel.id,
      title: 'Hotel issue',
      description: '',
      status: 'todo',
      priority: 0,
    })
    expect((await run(['issue', 'view', 'ISS-3'], { session: 'hotel-session' })).stdout).toMatch(
      /^ISS-3 Hotel issue\n/,
    )
    expect((await run(['issue', 'view', '3'], { session: 'hotel-session' })).stdout).toMatch(
      /^ISS-3 Hotel issue\n/,
    )
    expect((await run(['issue', 'view', '1'], { session: 'hotel-session' })).code).toBe(1)
    expect((await run(['issue', 'view', '1'])).stdout).toMatch(/^ISS-1 Alpha\n/)
    // An issue that moves to another project is read in that project's sessions.
    hoot.issues.update(1, { projectId: hoot.hotel.id })
    expect((await run(['issue', 'view', 'ISS-1'], { session: 'hotel-session' })).stdout).toMatch(
      /^ISS-1 Alpha\n/,
    )
    expect((await run(['issue', 'view', 'ISS-1'])).code).toBe(1)
  })
})

describe('hoot issue list', () => {
  beforeEach(() => {
    addIssue('One', 'todo', 2)
    addIssue('Two', 'done')
    addIssue('Three', 'in_progress', 1)
    addIssue('Four', 'backlog', 0)
    addIssue('Five', 'canceled')
    addIssue('Six', 'todo', 0)
    hoot.issues.create({
      projectId: hoot.hotel.id,
      title: 'Hotel issue',
      description: '',
      status: 'todo',
      priority: 0,
    })
    hoot.issues.create({
      projectId: null,
      title: 'Loose issue',
      description: '',
      status: 'todo',
      priority: 0,
    })
  })

  it('lists the issues neither done nor canceled, in the order of the Issues page, one line each', async () => {
    const { code, stdout, stderr } = await run(['issue', 'list'])
    expect(code).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toBe(
      [
        'ISS-3  In Progress  Urgent       Three',
        'ISS-1  Todo         High         One',
        'ISS-6  Todo         No priority  Six',
        'ISS-4  Backlog      No priority  Four',
        '',
      ].join('\n'),
    )
  })

  it('lists every issue with --all', async () => {
    const { code, stdout } = await run(['issue', 'list', '--all'])
    expect(code).toBe(0)
    expect(identifiers(stdout)).toEqual(['ISS-3', 'ISS-1', 'ISS-6', 'ISS-4', 'ISS-2', 'ISS-5'])
  })

  it('lists the issues of the statuses given, done or not, whatever --all says', async () => {
    expect(identifiers((await run(['issue', 'list', '--status', 'done'])).stdout)).toEqual([
      'ISS-2',
    ])
    expect(
      identifiers(
        (await run(['issue', 'list', '--status', 'done', '--status', 'canceled'])).stdout,
      ),
    ).toEqual(['ISS-2', 'ISS-5'])
    expect(identifiers((await run(['issue', 'list', '--status', 'todo', '--all'])).stdout)).toEqual(
      ['ISS-1', 'ISS-6'],
    )
  })

  it('prints a JSON array of the issues with --json', async () => {
    const all = JSON.parse((await run(['issue', 'list', '--json'])).stdout) as unknown[]
    expect(all.map((issue) => (issue as { identifier: string }).identifier)).toEqual([
      'ISS-3',
      'ISS-1',
      'ISS-6',
      'ISS-4',
    ])
    expect(all.map((issue) => (issue as { number: number }).number)).toEqual([3, 1, 6, 4])
    for (const issue of all) {
      expect(Object.keys(issue as object)).toEqual([
        'identifier',
        'number',
        'title',
        'description',
        'status',
        'priority',
        'createdAt',
        'completedAt',
        'parent',
        'subIssues',
        'subIssuesSummary',
        'blockedBy',
        'blocking',
        'labels',
      ])
    }
    const started = JSON.parse(
      (await run(['issue', 'list', '--status', 'in-progress', '--json'])).stdout,
    )
    expect(started).toEqual([
      expect.objectContaining({ identifier: 'ISS-3', status: 'in-progress' }),
    ])
  })

  it('prints an empty array when no issue is listed', async () => {
    const { code, stdout } = await run(['issue', 'list', '--status', 'done', '--json'], {
      session: 'hotel-session',
    })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual([])
    expect(await run(['issue', 'list', '--status', 'done'], { session: 'hotel-session' })).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    })
  })

  it("lists only the session's project's issues", async () => {
    const gamma = (await run(['issue', 'list', '--all'])).stdout
    expect(gamma).not.toContain('Hotel issue')
    expect(gamma).not.toContain('Loose issue')
    expect((await run(['issue', 'list'], { session: 'hotel-session' })).stdout).toBe(
      'ISS-7  Todo  No priority  Hotel issue\n',
    )
  })

  it('refuses a status name that is not one', async () => {
    const { code, stdout, stderr } = await run(['issue', 'list', '--status', 'started'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain("argument 'started' is invalid")
    expect(stderr).toContain('backlog, todo, in-progress, done, canceled')
  })
})

describe('hoot issue create', () => {
  it('creates an issue as the new issue dialog does, and prints its identifier', async () => {
    addIssue('Existing')
    const now = Date.UTC(2026, 9, 14, 9, 30)
    hoot.setClock(now)
    const { code, stdout, stderr } = await run(['issue', 'create', '--title', '  Gamma  '])
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: 'ISS-2\n', stderr: '' })
    const created = saved().at(-1)!
    expect(created).toEqual({
      id: 2,
      projectId: hoot.gamma.id,
      title: 'Gamma',
      description: '',
      status: 'backlog',
      priority: 0,
      createdAt: now,
      completedAt: null,
    })
    // As the window would be told of it.
    expect(hoot.created).toEqual([created])
  })

  it('saves the title on one line, as the title field of the new issue dialog takes it', async () => {
    const { code, stdout } = await run(['issue', 'create', '--title', ' Fix\r\nthe\nlogin\rbug\n'])
    expect({ code, stdout }).toEqual({ code: 0, stdout: 'ISS-1\n' })
    expect(saved().map((issue) => issue.title)).toEqual(['Fix the login bug'])
    expect(hoot.created.map((issue) => issue.title)).toEqual(['Fix the login bug'])
    // So that each issue stays on a line of its own.
    expect((await run(['issue', 'list'])).stdout).toBe(
      'ISS-1  Backlog  No priority  Fix the login bug\n',
    )
    expect((await run(['issue', 'view', '1'])).stdout.split('\n')[0]).toBe(
      'ISS-1 Fix the login bug',
    )
    const json = JSON.parse(
      (await run(['issue', 'create', '--title', 'Two\nlines', '--json'])).stdout,
    ) as { title: string }
    expect(json.title).toBe('Two lines')
  })

  it('takes the next number of all the issues, which is never given again', async () => {
    const doomed = addIssue('Doomed')
    hoot.issues.delete(doomed.id)
    hoot.issues.create({
      projectId: hoot.hotel.id,
      title: 'Hotel issue',
      description: '',
      status: 'todo',
      priority: 0,
    })
    expect((await run(['issue', 'create', '--title', 'After'])).stdout).toBe('ISS-3\n')
  })

  it('takes the description, status and priority given', async () => {
    const delta = await run(
      [
        'issue',
        'create',
        '--title',
        'Delta',
        '--description-file',
        '-',
        '--status',
        'in-progress',
        '--priority',
        'urgent',
      ],
      { stdin: STEPS },
    )
    expect(delta.code).toBe(0)
    expect(saved().at(-1)).toMatchObject({
      title: 'Delta',
      description: STEPS,
      status: 'in_progress',
      priority: 1,
    })
    await run(['issue', 'create', '--title', 'Epsilon', '--description', 'One line'])
    expect(saved().at(-1)).toMatchObject({ title: 'Epsilon', description: 'One line' })
    const file = path.join(hoot.directory, 'zeta.md')
    // Kept as it is, byte order mark and line endings included.
    const text = '\uFEFF# Zeta\r\n\n- one\n- two  \n\n中文 ✓\n'
    fs.writeFileSync(file, text)
    await run(['issue', 'create', '--title', 'Zeta', '--description-file', file])
    expect(saved().at(-1)).toMatchObject({ title: 'Zeta', description: text })
  })

  it('records when an issue created done or canceled was completed, and prints it as JSON with --json', async () => {
    const now = Date.UTC(2026, 9, 14, 9, 30, 1, 2)
    hoot.setClock(now)
    const { code, stdout } = await run([
      'issue',
      'create',
      '--title',
      'Eta',
      '--status',
      'done',
      '--json',
    ])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toStrictEqual({
      identifier: 'ISS-1',
      number: 1,
      title: 'Eta',
      description: '',
      status: 'done',
      priority: 'none',
      createdAt: '2026-10-14T09:30:01.002Z',
      completedAt: '2026-10-14T09:30:01.002Z',
      parent: null,
      subIssues: [],
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      blockedBy: [],
      blocking: [],
      labels: [],
    })
    expect(saved().at(-1)).toMatchObject({ status: 'done', createdAt: now, completedAt: now })
    await run(['issue', 'create', '--title', 'Theta', '--status', 'canceled'])
    expect(saved().at(-1)).toMatchObject({ status: 'canceled', completedAt: now })
  })

  it('creates titles and descriptions as long as Hoot saves', async () => {
    const title = 'T'.repeat(10_000)
    const description = 'D'.repeat(1_000_000)
    const { code } = await run(['issue', 'create', '--title', title, '--description', description])
    expect(code).toBe(0)
    expect(saved().at(-1)).toMatchObject({ title, description })
  })

  it('refuses what Hoot would not save, and creates nothing then', async () => {
    const file = path.join(hoot.directory, 'binary')
    fs.writeFileSync(file, Buffer.from([0x66, 0xff, 0xfe, 0x00]))
    const refused: Array<[string[], string]> = [
      [['issue', 'create'], "required option '--title <title>' not specified"],
      [['issue', 'create', '--title', '   '], 'The title is empty'],
      [['issue', 'create', '--title', 'T'.repeat(10_001)], 'The title is 10,001 characters long'],
      [
        ['issue', 'create', '--title', 'T', '--description', 'D'.repeat(1_000_001)],
        'The description is 1,000,001 characters long',
      ],
      [['issue', 'create', '--title', 'T', '--status', 'started'], "argument 'started' is invalid"],
      [['issue', 'create', '--title', 'T', '--priority', 'p1'], "argument 'p1' is invalid"],
      [
        ['issue', 'create', '--title', 'T', '--description', 'a', '--description-file', file],
        'cannot be used with',
      ],
      [
        [
          'issue',
          'create',
          '--title',
          'T',
          '--description-file',
          path.join(hoot.directory, 'gone'),
        ],
        'Could not read the description from',
      ],
      [['issue', 'create', '--title', 'T', '--description-file', file], 'is not UTF-8 text'],
    ]
    for (const [args, message] of refused) {
      const { code, stdout, stderr } = await run(args)
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain(message)
    }
    expect(saved()).toEqual([])
    expect(hoot.created).toEqual([])
  })

  it("creates the issue in the session's own project", async () => {
    const { stdout } = await run(['issue', 'create', '--title', 'Third'], {
      session: 'hotel-session',
    })
    expect(stdout).toBe('ISS-1\n')
    expect(hoot.issues.listInProject(hoot.hotel.id).map((issue) => issue.title)).toEqual(['Third'])
    expect(saved()).toEqual([])
  })
})

/** Creates an issue in hotel, or in no project for `null`. */
function addElsewhere(
  projectId: number | null,
  title: string,
  status: IssueStatus = 'todo',
): Issue {
  return hoot.issues.create({ projectId, title, description: '', status, priority: 0 })!
}

/** Makes issues sub-issues of a parent, in this order. */
function attach(parent: Issue, ...children: Issue[]): void {
  hoot.issues.setParents(children.map((child) => ({ issueId: child.id, parentId: parent.id })))
}

/** The sub-issues of an issue, by title, in order; and the parent of each issue, by title. */
function subIssueTitles(parent: Issue): string[] {
  return hoot.issues
    .subIssues()
    .links.filter((link) => link.parentId === parent.id)
    .map((link) => hoot.issues.get(link.issueId)?.title ?? `#${link.issueId}`)
}

/** Every [sub-issue, parent] pair, in order. */
const pairs = () => hoot.issues.subIssues().links.map((link) => [link.issueId, link.parentId])

/** A chain of issues L0 to L8, each a sub-issue of the one before, so that L8 is at level 8. */
function chain(): Issue[] {
  const issues = Array.from({ length: 9 }, (_, index) => addIssue(`L${index}`, 'todo'))
  for (let index = 1; index < issues.length; index++) attach(issues[index - 1]!, issues[index]!)
  return issues
}

describe('hoot issue create --parent', () => {
  it("creates the issue as the parent's last sub-issue, with the parent's priority unless one is given", async () => {
    const p = addIssue('P', 'todo', 2)
    const first = await run(['issue', 'create', '--title', 'S1', '--parent', 'ISS-1'])
    expect(first).toEqual({ code: 0, stdout: 'ISS-2\n', stderr: '' })
    expect(hoot.issues.get(2)).toMatchObject({
      title: 'S1',
      priority: 2,
      projectId: hoot.gamma.id,
      status: 'backlog',
    })
    const second = await run([
      'issue',
      'create',
      '--title',
      'S2',
      '--parent',
      '1',
      '--priority',
      'low',
    ])
    expect(second.code).toBe(0)
    expect(hoot.issues.get(3)).toMatchObject({ title: 'S2', priority: 4 })
    // Given explicitly, even the default is taken.
    await run(['issue', 'create', '--title', 'S3', '--parent', '1', '--priority', 'none'])
    expect(hoot.issues.get(4)?.priority).toBe(0)
    expect(subIssueTitles(p)).toEqual(['S1', 'S2', 'S3'])
    // As the window would be told of it: the issue itself.
    expect(hoot.created.map((issue) => issue.title)).toEqual(['S1', 'S2', 'S3'])
    expect(hoot.created[0]).toEqual(hoot.issues.get(2))
  })

  it('prints the new issue with its parent as JSON', async () => {
    addIssue('P', 'todo', 2)
    const { code, stdout } = await run([
      'issue',
      'create',
      '--title',
      'S3',
      '--parent',
      'ISS-1',
      '--json',
    ])
    expect(code).toBe(0)
    const json = JSON.parse(stdout)
    expect(json).toMatchObject({ identifier: 'ISS-2', title: 'S3', priority: 'high' })
    expect(json.parent).toStrictEqual({
      identifier: 'ISS-1',
      number: 1,
      title: 'P',
      status: 'todo',
      project: 'gamma',
    })
    expect(json.subIssues).toStrictEqual([])
    expect(json.subIssuesSummary).toStrictEqual({ total: 0, completed: 0, percentCompleted: 0 })
  })

  it('refuses a parent not of the project, not an issue, or that cannot have another sub-issue, creating nothing', async () => {
    addIssue('P', 'todo')
    const other = addElsewhere(hoot.hotel.id, 'Hx')
    const loose = addElsewhere(null, 'Nx')
    const levels = chain()
    const full = addIssue('M', 'todo')
    for (let index = 0; index < 100; index++) attach(full, addIssue(`M${index}`))
    const before = { issues: hoot.issues.list(), links: hoot.issues.subIssues() }
    const refused: Array<[string, string]> = [
      [`ISS-${other.id}`, `There is no issue ISS-${other.id} in this session's project, gamma.`],
      [`ISS-${loose.id}`, `There is no issue ISS-${loose.id} in this session's project, gamma.`],
      ['999', "There is no issue ISS-999 in this session's project, gamma."],
      [
        'foo',
        `"foo" is neither an issue's identifier, such as ISS-12, nor its number, such as 12.`,
      ],
      [`ISS-${levels[8]!.id}`, 'the deepest an issue can be'],
      [`ISS-${full.id}`, `ISS-${full.id} has 100 sub-issues, the most an issue can have.`],
    ]
    for (const [parent, message] of refused) {
      const { code, stdout, stderr } = await run([
        'issue',
        'create',
        '--title',
        'T',
        '--parent',
        parent,
      ])
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toMatch(/^error: /)
      expect(stderr).toContain(message)
    }
    expect({ issues: hoot.issues.list(), links: hoot.issues.subIssues() }).toEqual(before)
    expect(hoot.created).toEqual([])
  })
})

describe('hoot issue edit', () => {
  let p: Issue, q: Issue, a: Issue, b: Issue, w: Issue, hx: Issue

  beforeEach(() => {
    ;[p, q, a, b, w] = ['P', 'Q', 'A', 'B', 'W'].map((title) => addIssue(title, 'todo')) as [
      Issue,
      Issue,
      Issue,
      Issue,
      Issue,
    ]
    hx = addElsewhere(hoot.hotel.id, 'Hx')
    attach(q, a)
  })

  it('adds sub-issues in the order given, taking them from their parents', async () => {
    expect(await run(['issue', 'edit', 'ISS-1', '--add-sub-issue', 'ISS-4,ISS-3'])).toEqual({
      code: 0,
      stdout: 'ISS-1\n',
      stderr: '',
    })
    expect(subIssueTitles(p)).toEqual(['B', 'A'])
    expect(subIssueTitles(q)).toEqual([])
  })

  it('sets, changes and removes the parent, and removes sub-issues', async () => {
    await run(['issue', 'edit', 'ISS-1', '--add-sub-issue', '4, 3'])
    expect((await run(['issue', 'edit', 'ISS-5', '--parent', 'ISS-1'])).code).toBe(0)
    expect(subIssueTitles(p)).toEqual(['B', 'A', 'W'])
    expect((await run(['issue', 'edit', '5', '--parent', '2'])).code).toBe(0)
    expect(subIssueTitles(p)).toEqual(['B', 'A'])
    expect(subIssueTitles(q)).toEqual(['W'])
    expect((await run(['issue', 'edit', 'ISS-5', '--remove-parent'])).code).toBe(0)
    expect(subIssueTitles(q)).toEqual([])
    expect((await run(['issue', 'edit', 'ISS-1', '--remove-sub-issue', 'ISS-4'])).code).toBe(0)
    expect(subIssueTitles(p)).toEqual(['A'])
    expect(pairs()).toEqual([[a.id, p.id]])
  })

  it('makes all the changes together', async () => {
    attach(p, b)
    const { code } = await run([
      'issue',
      'edit',
      'ISS-1',
      '--parent',
      'ISS-5',
      '--remove-sub-issue',
      'ISS-4',
      '--add-sub-issue',
      'ISS-3',
    ])
    expect(code).toBe(0)
    expect(pairs()).toEqual([
      [p.id, w.id],
      [a.id, p.id],
    ])
  })

  it('refuses what it cannot do, changing nothing', async () => {
    await run(['issue', 'edit', 'ISS-1', '--add-sub-issue', 'ISS-4,ISS-3'])
    const before = pairs()
    const refused: Array<[string[], string]> = [
      [['ISS-1'], 'Nothing to change'],
      [['ISS-1', '--parent', 'ISS-3'], 'ISS-1 cannot be a sub-issue of ISS-3, which is below it.'],
      [
        ['ISS-3', '--add-sub-issue', 'ISS-1'],
        'ISS-1 cannot be a sub-issue of ISS-3, which is below it.',
      ],
      [['ISS-1', '--add-sub-issue', 'ISS-1'], 'ISS-1 cannot be a sub-issue of itself.'],
      [['ISS-1', '--parent', 'ISS-1'], 'ISS-1 cannot be a sub-issue of itself.'],
      [['ISS-5', '--remove-parent', '--add-sub-issue', 'ISS-2'], 'ISS-5 has no parent issue.'],
      [['ISS-2', '--remove-parent'], 'ISS-2 has no parent issue.'],
      [['ISS-1', '--remove-sub-issue', 'ISS-5'], 'ISS-5 is not a sub-issue of ISS-1.'],
      [['ISS-5', '--parent', 'ISS-1', '--remove-parent'], 'cannot be used with'],
      [
        ['ISS-1', '--add-sub-issue', `ISS-5,ISS-${hx.id}`],
        `There is no issue ISS-${hx.id} in this session's project, gamma.`,
      ],
      [
        [`ISS-${hx.id}`, '--parent', 'ISS-1'],
        `There is no issue ISS-${hx.id} in this session's project, gamma.`,
      ],
      [['foo', '--parent', 'ISS-1'], `"foo" is neither an issue's identifier`],
      [['ISS-1', '--add-sub-issue', 'ISS-5,'], `"" is neither an issue's identifier`],
      [['ISS-1', '--add-sub-issue', 'ISS-5', '--remove-sub-issue', 'ISS-5'], 'is not a sub-issue'],
      [
        ['ISS-1', '--add-sub-issue', 'ISS-3', '--remove-sub-issue', 'ISS-3'],
        'cannot both become and stop being a sub-issue of ISS-1',
      ],
    ]
    for (const [args, message] of refused) {
      const { code, stdout, stderr } = await run(['issue', 'edit', ...args])
      expect({ args, code }).toEqual({ args, code: 1 })
      expect(stdout).toBe('')
      expect(stderr).toMatch(/^error: /)
      expect(stderr).toContain(message)
    }
    expect(pairs()).toEqual(before)
  })

  it('refuses an issue below itself or below level 8, and more than 100 sub-issues', async () => {
    const levels = chain()
    const [l0, , , l3] = levels
    const before = pairs()
    for (const args of [
      [`ISS-${l0!.id}`, '--parent', `ISS-${l3!.id}`],
      [`ISS-${l3!.id}`, '--add-sub-issue', `ISS-${l0!.id}`],
    ]) {
      const { code, stderr } = await run(['issue', 'edit', ...args])
      expect(code).toBe(1)
      expect(stderr).toMatch(/^error: /)
    }
    // P, with a sub-issue, under L7 would put that sub-issue at level 9.
    attach(p, b)
    expect(
      (await run(['issue', 'edit', `ISS-${p.id}`, '--parent', `ISS-${levels[7]!.id}`])).stderr,
    ).toContain(`ISS-${b.id} would then be 9 levels below a top-level issue`)
    expect(pairs()).toEqual([...before, [b.id, p.id]])
    const s = addIssue('S', 'todo')
    for (let index = 0; index < 99; index++) attach(s, addIssue(`S${index}`))
    // The hundredth is of hotel, removed from the list: it counts all the same.
    const hidden = addElsewhere(hoot.hotel.id, 'S100')
    attach(s, hidden)
    // K's sub-issue is of hotel too: K under L7 would put it at level 9.
    const k = addIssue('K', 'todo')
    const k1 = addElsewhere(hoot.hotel.id, 'K1')
    attach(k, k1)
    hoot.projects.remove(hoot.hotel.root)
    const deep = await run(['issue', 'edit', `ISS-${k.id}`, '--parent', `ISS-${levels[7]!.id}`])
    expect(deep.code).toBe(1)
    expect(deep.stderr).toContain('an issue below it would then be 9 levels below')
    expect(deep.stderr).not.toContain(`ISS-${k1.id}`)
    const t = addIssue('T', 'todo')
    const refused = await run(['issue', 'edit', `ISS-${s.id}`, '--add-sub-issue', `ISS-${t.id}`])
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain(`ISS-${s.id} would have 101 sub-issues`)
  })
})

describe('hoot issue view with sub-issues', () => {
  let p: Issue, q: Issue, z: Issue, c: Issue[]

  beforeEach(() => {
    q = addElsewhere(null, 'Q', 'todo')
    p = addIssue('P', 'todo', 0, 'About P')
    attach(q, p)
    c = [
      addIssue('C1', 'done'),
      addElsewhere(hoot.hotel.id, 'C2', 'in_progress'),
      addIssue('C3', 'canceled'),
      addElsewhere(null, 'C4', 'backlog'),
    ]
    attach(p, ...c)
    z = addIssue('Z', 'todo')
  })

  it("names the parent and lists the sub-issues, with the projects other than the session's", async () => {
    const { code, stdout } = await run(['issue', 'view', `ISS-${p.id}`])
    expect(code).toBe(0)
    const created = localMinute(p.createdAt)
    expect(stdout).toBe(
      [
        `ISS-${p.id} P`,
        `Todo · No priority · Created ${created}`,
        `Sub-issue of ISS-${q.id} Q (Todo · No project)`,
        '',
        'About P',
        '',
        'Sub-issues · 1/3 (33%)',
        `Done         ISS-${c[0]!.id}  C1`,
        `In Progress  ISS-${c[1]!.id}  C2 (hotel)`,
        `Canceled     ISS-${c[2]!.id}  C3`,
        `Backlog      ISS-${c[3]!.id}  C4 (No project)`,
        '',
      ].join('\n'),
    )
    hoot.issues.update(c[1]!.id, { status: 'done' })
    expect((await run(['issue', 'view', `ISS-${p.id}`])).stdout).toContain(
      'Sub-issues · 2/3 (66%)\n',
    )
  })

  it('prints the parent, the sub-issues and their progress as JSON, in view and list alike', async () => {
    const json = JSON.parse((await run(['issue', 'view', `ISS-${p.id}`, '--json'])).stdout)
    expect(json.parent).toStrictEqual({
      identifier: `ISS-${q.id}`,
      number: q.id,
      title: 'Q',
      status: 'todo',
      project: null,
    })
    expect(json.subIssues.map((issue: { project: string | null }) => issue.project)).toEqual([
      'gamma',
      'hotel',
      'gamma',
      null,
    ])
    expect(json.subIssues.map((issue: { status: string }) => issue.status)).toEqual([
      'done',
      'in-progress',
      'canceled',
      'backlog',
    ])
    expect(json.subIssuesSummary).toStrictEqual({ total: 3, completed: 1, percentCompleted: 33 })
    const listed = JSON.parse((await run(['issue', 'list', '--all', '--json'])).stdout)
    expect(listed.find((issue: { number: number }) => issue.number === p.id)).toStrictEqual(json)
    expect(listed.find((issue: { number: number }) => issue.number === z.id)).toMatchObject({
      parent: null,
      subIssues: [],
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      blockedBy: [],
      blocking: [],
    })
  })

  it('prints an issue without a parent or sub-issues as before', async () => {
    expect((await run(['issue', 'view', `ISS-${z.id}`])).stdout).toBe(
      `ISS-${z.id} Z\nTodo · No priority · Created ${localMinute(z.createdAt)}\n`,
    )
    expect((await run(['issue', 'list'])).stdout).toBe(
      `ISS-${z.id}  Todo  No priority  Z\nISS-${p.id}  Todo  No priority  P\n`,
    )
  })

  it('leaves out the issues of a project removed from the list', async () => {
    const r = addIssue('R', 'todo')
    const hq = addElsewhere(hoot.hotel.id, 'HQ')
    attach(hq, r)
    hoot.projects.remove(hoot.hotel.root)
    const json = JSON.parse((await run(['issue', 'view', `ISS-${p.id}`, '--json'])).stdout)
    expect(json.subIssues.map((issue: { title: string }) => issue.title)).toEqual([
      'C1',
      'C3',
      'C4',
    ])
    expect(json.subIssuesSummary).toStrictEqual({ total: 2, completed: 1, percentCompleted: 50 })
    expect(
      JSON.parse((await run(['issue', 'view', `ISS-${r.id}`, '--json'])).stdout).parent,
    ).toBeNull()
    expect((await run(['issue', 'view', `ISS-${p.id}`])).stdout).not.toContain('C2')
    expect((await run(['issue', 'view', `ISS-${r.id}`])).stdout).not.toContain('Sub-issue of')
    // Nor can it remove a parent it does not show.
    expect((await run(['issue', 'edit', `ISS-${r.id}`, '--remove-parent'])).stderr).toContain(
      `ISS-${r.id} has no parent issue.`,
    )
    hoot.projects.add(hoot.hotel.root)
    expect(
      JSON.parse((await run(['issue', 'view', `ISS-${r.id}`, '--json'])).stdout).parent,
    ).toMatchObject({
      identifier: `ISS-${hq.id}`,
      project: 'hotel',
    })
  })
})

/** An issue's identifier, such as "ISS-12". */
const id = (issue: Issue) => `ISS-${issue.id}`

/** An issue object's summary, as the objects of its relations have it, for an issue of gamma. */
const summaryOf = ({ identifier, number, title, status }: Record<string, unknown>) => ({
  identifier,
  number,
  title,
  status,
  project: 'gamma',
})

/** The dependencies, as [issue, blocked by] pairs of titles, in the order they were made. */
function dependencyTitles(): Array<[string, string]> {
  const title = (issueId: number) => hoot.issues.get(issueId)?.title ?? `#${issueId}`
  return hoot.issues
    .dependencies()
    .links.map((link) => [title(link.issueId), title(link.blockedById)] as [string, string])
}

/** Makes an issue blocked by others. */
function block(issue: Issue, ...blockers: Issue[]): void {
  hoot.issues.changeRelations({
    addDependencies: blockers.map((blocker) => ({ issueId: issue.id, blockedById: blocker.id })),
  })
}

/** Expects hoot to refuse, saying so on standard error, and to change no issue, parent or dependency. */
async function expectRefused(args: string[], message: string, stdin?: string) {
  const before = {
    issues: hoot.issues.list(),
    links: hoot.issues.subIssues().links,
    dependencies: hoot.issues.dependencies().links,
  }
  const { code, stdout, stderr } = await run(args, { stdin })
  expect({ args, code }).toEqual({ args, code: 1 })
  expect(stdout).toBe('')
  expect(stderr).toMatch(/^error: /)
  expect(stderr).toContain(message)
  expect({
    issues: hoot.issues.list(),
    links: hoot.issues.subIssues().links,
    dependencies: hoot.issues.dependencies().links,
  }).toEqual(before)
  return stderr
}

describe('the rules of dependencies in hoot', () => {
  let p: Issue, p1: Issue, p2: Issue, q1: Issue, x: Issue, y: Issue, z: Issue, y1: Issue, w: Issue

  beforeEach(() => {
    ;[p, p1, p2, q1, x, y, z, y1, w] = ['P', 'P1', 'P2', 'Q1', 'X', 'Y', 'Z', 'Y1', 'W'].map(
      (title) => addIssue(title, 'todo'),
    ) as [Issue, Issue, Issue, Issue, Issue, Issue, Issue, Issue, Issue]
    attach(p, p1, p2)
    attach(p1, q1)
    attach(y, y1)
    block(x, y)
    block(y, z)
  })

  it('refuses an issue that would wait for itself', async () => {
    for (const [args, message] of [
      [
        ['edit', id(z), '--add-blocked-by', id(x)],
        `${id(z)} cannot be blocked by ${id(x)}, which waits for it already: ${id(x)} is ` +
          `blocked by ${id(y)}, which is blocked by ${id(z)}.`,
      ],
      [['edit', id(x), '--add-blocking', id(y)], `${id(y)} cannot be blocked by ${id(x)}`],
      [['edit', id(x), '--add-blocked-by', id(x)], `${id(x)} cannot be blocked by itself.`],
      [['create', '--title', 'N', '--blocked-by', id(w), '--blocking', id(w)], 'waits for it'],
    ] as const) {
      await expectRefused(['issue', ...args], message)
    }
    expect(hoot.created).toEqual([])
  })

  it('lets an issue be blocked by an issue above or below it, and block one, both ways', async () => {
    for (const args of [
      ['edit', id(p), '--add-blocked-by', id(p1)],
      ['edit', id(q1), '--add-blocked-by', id(p)],
      ['edit', id(y1), '--add-blocked-by', id(x)],
      ['edit', id(p1), '--add-blocking', id(p2)],
    ]) {
      expect((await run(['issue', ...args])).code).toBe(0)
    }
    expect(dependencyTitles()).toEqual([
      ['X', 'Y'],
      ['Y', 'Z'],
      ['P', 'P1'],
      ['Q1', 'P'],
      ['Y1', 'X'],
      ['P2', 'P1'],
    ])
    // Its sub-issue waits for P already, through Q1 and P1.
    await expectRefused(
      ['issue', 'edit', id(p1), '--add-blocked-by', id(q1)],
      `${id(p1)} cannot be blocked by ${id(q1)}, which waits for it already`,
    )
    const created = await run([
      'issue',
      'create',
      '--title',
      'N',
      '--parent',
      id(p),
      '--blocked-by',
      id(p),
    ])
    expect(created.code).toBe(0)
  })

  it('changes parents whatever the dependencies, which count for nothing in them', async () => {
    expect((await run(['issue', 'edit', id(x), '--parent', id(y)])).code).toBe(0)
    expect((await run(['issue', 'edit', id(z), '--add-sub-issue', id(y)])).code).toBe(0)
    expect(subIssueTitles(y)).toEqual(['Y1', 'X'])
    expect(subIssueTitles(z)).toEqual(['Y'])
  })

  it('makes a dependency within the rules', async () => {
    expect(await run(['issue', 'edit', `ISS-${x.id}`, '--add-blocked-by', `ISS-${w.id}`])).toEqual({
      code: 0,
      stdout: `ISS-${x.id}\n`,
      stderr: '',
    })
    expect(dependencyTitles()).toEqual([
      ['X', 'Y'],
      ['Y', 'Z'],
      ['X', 'W'],
    ])
  })

  it('refuses a dependency through an issue of a project removed from the list, without naming it', async () => {
    const a = addIssue('A', 'todo')
    const b = addElsewhere(hoot.hotel.id, 'B')
    const e = addIssue('E', 'todo')
    block(a, b)
    block(b, e)
    hoot.projects.remove(hoot.hotel.root)
    const stderr = await expectRefused(
      ['issue', 'edit', `ISS-${e.id}`, '--add-blocked-by', `ISS-${a.id}`],
      'an issue Hoot does not show',
    )
    expect(stderr).not.toContain(`ISS-${b.id}`)
  })
})

describe('the limits of dependencies in hoot', () => {
  it('refuses more than 50 issues blocking an issue, or 50 blocked by one', async () => {
    const m = addIssue('M', 'todo')
    const n = addIssue('N', 'todo')
    const f = addIssue('F', 'todo')
    const e = addIssue('E', 'todo')
    const blockers = Array.from({ length: 50 }, (_, index) => addIssue(`M${index + 1}`))
    const created = await run([
      'issue',
      'edit',
      `ISS-${m.id}`,
      '--add-blocked-by',
      blockers.map((issue) => `ISS-${issue.id}`).join(','),
    ])
    expect(created.code).toBe(0)
    for (let index = 1; index <= 50; index++) {
      const { code } = await run([
        'issue',
        'create',
        '--title',
        `N${index}`,
        '--blocked-by',
        `ISS-${n.id}`,
      ])
      expect(code).toBe(0)
    }
    await expectRefused(
      ['issue', 'edit', `ISS-${m.id}`, '--add-blocked-by', `ISS-${f.id}`],
      `ISS-${m.id} would be blocked by 51 issues, and an issue can be blocked by at most 50.`,
    )
    await expectRefused(
      ['issue', 'edit', `ISS-${n.id}`, '--add-blocking', `ISS-${f.id}`],
      `ISS-${n.id} would block 51 issues, and an issue can block at most 50.`,
    )
    await expectRefused(
      ['issue', 'create', '--title', 'G1', '--blocked-by', `ISS-${n.id}`],
      `ISS-${n.id} would block 51 issues`,
    )
    await expectRefused(
      ['issue', 'create-batch', `ISS-${e.id}`, '--file', '-'],
      `ISS-${n.id} would block 51 issues`,
      JSON.stringify([{ title: 'S1', blockedBy: [`ISS-${n.id}`] }]),
    )
  })
})

describe('hoot issue create with dependencies', () => {
  let p: Issue, b1: Issue, b2: Issue, k: Issue, hx: Issue, q: Issue

  beforeEach(() => {
    p = addIssue('P', 'todo', 2)
    ;[b1, b2, k] = ['B1', 'B2', 'K'].map((title) => addIssue(title, 'todo')) as [
      Issue,
      Issue,
      Issue,
    ]
    hx = addElsewhere(hoot.hotel.id, 'Hx')
    q = addIssue('Q', 'todo')
    attach(p, q)
  })

  it('creates an issue blocked by issues and blocking others', async () => {
    const { code, stdout } = await run([
      'issue',
      'create',
      '--title',
      'N1',
      '--blocked-by',
      `ISS-${b1.id},ISS-${b2.id}`,
      '--blocking',
      `ISS-${k.id}`,
    ])
    expect(code).toBe(0)
    const n1 = saved().at(-1)!
    expect(stdout).toBe(`ISS-${n1.id}\n`)
    expect(dependencyTitles()).toEqual([
      ['N1', 'B1'],
      ['N1', 'B2'],
      ['K', 'N1'],
    ])
  })

  it('prints the issues it is blocked by and blocks as JSON, with a parent too', async () => {
    const { code, stdout } = await run([
      'issue',
      'create',
      '--title',
      'N2',
      '--parent',
      `ISS-${p.id}`,
      '--blocked-by',
      `${q.id}`,
      '--json',
    ])
    expect(code).toBe(0)
    const json = JSON.parse(stdout)
    expect(json.blockedBy).toStrictEqual([
      { identifier: `ISS-${q.id}`, number: q.id, title: 'Q', status: 'todo', project: 'gamma' },
    ])
    expect(json.blocking).toStrictEqual([])
    expect(json.parent).toMatchObject({ identifier: `ISS-${p.id}` })
    expect(json.priority).toBe('high')
  })

  it('refuses an issue not of the project, what is not an issue, and what breaks the rules, creating nothing', async () => {
    for (const [options, message] of [
      [
        ['--blocked-by', `ISS-${hx.id}`],
        `There is no issue ISS-${hx.id} in this session's project`,
      ],
      [['--blocked-by', 'foo'], `"foo" is neither an issue's identifier`],
      [['--blocked-by', `ISS-${k.id}`, '--blocking', `ISS-${k.id}`], 'waits for it already'],
    ] as const) {
      await expectRefused(['issue', 'create', '--title', 'N3', ...options], message)
    }
    expect(hoot.created).toEqual([])
  })
})

describe('hoot issue edit with dependencies', () => {
  let a: Issue, b: Issue, c: Issue, d: Issue, hx: Issue

  beforeEach(() => {
    ;[a, b, c, d] = ['A', 'B', 'C', 'D'].map((title) => addIssue(title, 'todo')) as [
      Issue,
      Issue,
      Issue,
      Issue,
    ]
    hx = addElsewhere(hoot.hotel.id, 'Hx')
  })

  it('makes and removes dependencies both ways, together with the parent', async () => {
    expect(
      await run([
        'issue',
        'edit',
        id(a),
        '--add-blocked-by',
        `${id(b)},${id(c)}`,
        '--add-blocking',
        id(d),
      ]),
    ).toEqual({ code: 0, stdout: `${id(a)}\n`, stderr: '' })
    expect(dependencyTitles()).toEqual([
      ['A', 'B'],
      ['A', 'C'],
      ['D', 'A'],
    ])
    expect(
      (
        await run([
          'issue',
          'edit',
          id(a),
          '--remove-blocked-by',
          id(b),
          '--remove-blocking',
          id(d),
        ])
      ).code,
    ).toBe(0)
    expect(dependencyTitles()).toEqual([['A', 'C']])
    expect(
      (await run(['issue', 'edit', id(d), '--parent', id(b), '--add-blocked-by', id(c)])).code,
    ).toBe(0)
    expect(subIssueTitles(b)).toEqual(['D'])
    expect(dependencyTitles()).toEqual([
      ['A', 'C'],
      ['D', 'C'],
    ])
  })

  it('refuses what it cannot do, changing nothing', async () => {
    block(a, c)
    for (const [args, message] of [
      [[id(a), '--add-blocked-by', id(c)], `${id(a)} is blocked by ${id(c)} already.`],
      [[id(a), '--remove-blocked-by', id(b)], `${id(a)} is not blocked by ${id(b)}.`],
      [[id(a), '--remove-blocking', id(d)], `${id(d)} is not blocked by ${id(a)}.`],
      [
        [id(a), '--add-blocked-by', id(b), '--remove-blocked-by', id(b)],
        `${id(a)} cannot both become blocked by ${id(b)} and stop being blocked by it.`,
      ],
      [
        [id(a), '--add-blocking', id(b), '--remove-blocking', id(b)],
        `${id(b)} cannot both become blocked by ${id(a)} and stop being blocked by it.`,
      ],
      [
        [id(a), '--add-blocked-by', `${id(b)},${id(hx)}`],
        `There is no issue ${id(hx)} in this session's project, gamma.`,
      ],
      [[id(a), '--add-blocking', id(c)], 'waits for it already'],
      [[id(a)], 'Nothing to change'],
    ] as const) {
      await expectRefused(['issue', 'edit', ...args], message)
    }
    expect(dependencyTitles()).toEqual([['A', 'C']])
  })
})

describe('hoot issue view with dependencies', () => {
  let x: Issue, b1: Issue, b2: Issue, b3: Issue, k1: Issue, z: Issue

  beforeEach(() => {
    x = addIssue('X', 'todo')
    b1 = addIssue('B1', 'done')
    b2 = addElsewhere(hoot.hotel.id, 'B2', 'in_progress')
    b3 = addElsewhere(null, 'B3', 'todo')
    k1 = addIssue('K1', 'backlog')
    z = addIssue('Z', 'todo')
    block(x, b1, b2, b3)
    block(k1, x)
  })

  it("lists the issues it is blocked by and those it blocks, with the projects other than the session's", async () => {
    const { code, stdout } = await run(['issue', 'view', `ISS-${x.id}`])
    expect(code).toBe(0)
    expect(stdout).toBe(
      [
        `ISS-${x.id} X`,
        `Todo · No priority · Created ${localMinute(x.createdAt)}`,
        '',
        'Blocked by',
        `Done         ISS-${b1.id}  B1`,
        `In Progress  ISS-${b2.id}  B2 (hotel)`,
        `Todo         ISS-${b3.id}  B3 (No project)`,
        '',
        'Blocking',
        `Backlog  ISS-${k1.id}  K1`,
        '',
      ].join('\n'),
    )
  })

  it('prints them as JSON, in view and list alike', async () => {
    const json = JSON.parse((await run(['issue', 'view', `ISS-${x.id}`, '--json'])).stdout)
    expect(json.blockedBy).toStrictEqual([
      { identifier: `ISS-${b1.id}`, number: b1.id, title: 'B1', status: 'done', project: 'gamma' },
      {
        identifier: `ISS-${b2.id}`,
        number: b2.id,
        title: 'B2',
        status: 'in-progress',
        project: 'hotel',
      },
      { identifier: `ISS-${b3.id}`, number: b3.id, title: 'B3', status: 'todo', project: null },
    ])
    expect(json.blocking).toStrictEqual([
      {
        identifier: `ISS-${k1.id}`,
        number: k1.id,
        title: 'K1',
        status: 'backlog',
        project: 'gamma',
      },
    ])
    const listed = JSON.parse((await run(['issue', 'list', '--all', '--json'])).stdout)
    expect(listed.find((issue: { number: number }) => issue.number === x.id)).toStrictEqual(json)
    expect(listed.find((issue: { number: number }) => issue.number === z.id)).toMatchObject({
      blockedBy: [],
      blocking: [],
    })
    expect((await run(['issue', 'view', `ISS-${z.id}`])).stdout).toBe(
      `ISS-${z.id} Z\nTodo · No priority · Created ${localMinute(z.createdAt)}\n`,
    )
  })

  it('leaves out the issues of a project removed from the list', async () => {
    hoot.projects.remove(hoot.hotel.root)
    const json = JSON.parse((await run(['issue', 'view', `ISS-${x.id}`, '--json'])).stdout)
    expect(json.blockedBy.map((issue: { title: string }) => issue.title)).toEqual(['B1', 'B3'])
    expect((await run(['issue', 'view', `ISS-${x.id}`])).stdout).not.toContain(`ISS-${b2.id}`)
  })
})

describe('hoot issue create-batch', () => {
  let p: Issue, e: Issue, hx: Issue, c0: Issue
  let file: string
  const plan = () => [
    { title: 'S1' },
    { title: 'S2', description: 'Two', status: 'todo', priority: 'low', blockedBy: [1] },
    { title: 'S3', blockedBy: [1, 2, `ISS-${e.id}`] },
  ]

  beforeEach(() => {
    p = addIssue('P', 'todo', 2)
    e = addIssue('E', 'todo')
    hx = addElsewhere(hoot.hotel.id, 'Hx')
    c0 = addIssue('C0', 'todo')
    attach(p, c0)
    file = path.join(hoot.directory, 'plan.json')
    fs.writeFileSync(file, JSON.stringify(plan(), null, 2))
  })

  it('creates the issues as the last sub-issues, in order, with their dependencies, and prints their identifiers', async () => {
    const { code, stdout, stderr } = await run([
      'issue',
      'create-batch',
      `ISS-${p.id}`,
      '--file',
      file,
    ])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    const [s1, s2, s3] = saved().slice(-3)
    expect(stdout).toBe(`ISS-${s1!.id}\nISS-${s2!.id}\nISS-${s3!.id}\n`)
    expect(subIssueTitles(p)).toEqual(['C0', 'S1', 'S2', 'S3'])
    expect(s1).toMatchObject({ status: 'backlog', priority: 2, description: '' })
    expect(s2).toMatchObject({ status: 'todo', priority: 4, description: 'Two' })
    expect(s3).toMatchObject({ status: 'backlog', priority: 2 })
    expect(dependencyTitles()).toEqual([
      ['S2', 'S1'],
      ['S3', 'S1'],
      ['S3', 'S2'],
      ['S3', 'E'],
    ])
    expect(hoot.created.map((issue) => issue.title)).toEqual(['S1', 'S2', 'S3'])
  })

  it('reads standard input with -, and prints the new issues as JSON with --json', async () => {
    const { code, stdout } = await run(
      ['issue', 'create-batch', `${p.id}`, '--file', '-', '--json'],
      {
        stdin: `﻿${JSON.stringify(plan())}`,
      },
    )
    expect(code).toBe(0)
    const json = JSON.parse(stdout)
    expect(json.map((issue: { title: string }) => issue.title)).toEqual(['S1', 'S2', 'S3'])
    expect(json[1].blockedBy).toStrictEqual([summaryOf(json[0])])
    expect(json[2].blockedBy).toStrictEqual([
      summaryOf(json[0]),
      summaryOf(json[1]),
      { identifier: `ISS-${e.id}`, number: e.id, title: 'E', status: 'todo', project: 'gamma' },
    ])
    expect(json[0].parent).toMatchObject({ identifier: `ISS-${p.id}` })
  })

  it('refuses what is wrong with the issue or the file, or would break a rule, creating none', async () => {
    const withItem = (index: number, changes: Record<string, unknown>) =>
      plan().map((item, at) => (at === index ? { ...item, ...changes } : item))
    const cases: Array<[unknown, string]> = [
      [withItem(2, { blockedBy: [3] }), 'Item 3 cannot be blocked by itself.'],
      [
        withItem(1, { blockedBy: [1] }).map((item, at) =>
          at === 0 ? { ...item, blockedBy: [2] } : item,
        ),
        'Item 1 cannot be blocked by item 2, which waits for it already',
      ],
      [withItem(2, { blockedBy: [4] }), 'which is neither the place of an item, from 1 to 3'],
      [
        withItem(2, { blockedBy: [`ISS-${hx.id}`] }),
        `There is no issue ISS-${hx.id} in this session's project, gamma.`,
      ],
      [withItem(2, { labels: ['nope'] }), 'There is no label named "nope".'],
      [withItem(2, { labels: 'x' }), 'The "labels" of item 3 in '],
      [withItem(2, { labels: [3] }), 'The "labels" of item 3 in '],
      [plan().map((item, at) => (at === 0 ? {} : item)), 'Item 1 in '],
      [withItem(1, { status: 'doing' }), 'The status of item 2 in '],
      [withItem(1, { status: null }), 'The status of item 2 in '],
      [withItem(1, { blockedBy: null }), 'The "blockedBy" of item 2 in '],
      [withItem(0, { blocking: null }), 'The "blocking" of item 1 in '],
      [withItem(2, { title: '' }), 'The title of item 3 is empty'],
      [withItem(0, { priority: 'p1' }), 'The priority of item 1 in '],
      [withItem(0, { blocked_by: [] }), 'has the field "blocked_by"'],
      [{ title: 'Not an array' }, 'are not a JSON array'],
    ]
    for (const [content, message] of cases) {
      fs.writeFileSync(file, JSON.stringify(content))
      await expectRefused(['issue', 'create-batch', `ISS-${p.id}`, '--file', file], message)
    }
    fs.writeFileSync(file, 'not JSON')
    await expectRefused(['issue', 'create-batch', `ISS-${p.id}`, '--file', file], 'are not JSON')
    fs.writeFileSync(file, JSON.stringify(plan()))
    await expectRefused(
      ['issue', 'create-batch', `ISS-${hx.id}`, '--file', file],
      `There is no issue ISS-${hx.id} in this session's project, gamma.`,
    )
    await expectRefused(
      ['issue', 'create-batch', `ISS-${p.id}`, '--file', path.join(hoot.directory, 'missing.json')],
      'Could not read the issues from',
    )
    await expectRefused(['issue', 'create-batch', `ISS-${p.id}`], "required option '--file <file>'")
    expect(hoot.created).toEqual([])
  })

  it('refuses more sub-issues than the parent can have', async () => {
    for (let index = 0; index < 98; index++) attach(p, addIssue(`C${index + 1}`))
    await expectRefused(
      ['issue', 'create-batch', `ISS-${p.id}`, '--file', file],
      `ISS-${p.id} has 99 sub-issues, and 3 more would make 102: an issue can have at most 100.`,
    )
    expect(subIssueTitles(p)).toHaveLength(99)
  })
})

describe('hoot issue create-batch with labels and its parent blocked', () => {
  it('creates sub-issues to do with their labels, blocking the parent and each other, as a split is written back', async () => {
    hoot.labels.createLabel({ name: 'x', color: 'ff8800' })
    const p = addIssue('P', 'in_progress')
    const file = path.join(hoot.directory, 'f.json')
    fs.writeFileSync(
      file,
      JSON.stringify([
        { title: 'S1', labels: ['ready to design'], status: 'todo', blocking: [id(p)] },
        {
          title: 'S2',
          labels: ['Ready to Design', 'x'],
          status: 'todo',
          blockedBy: [1],
          blocking: [id(p)],
        },
      ]),
    )
    const { code, stdout, stderr } = await run(['issue', 'create-batch', id(p), '--file', file])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    const [s1, s2] = saved().slice(-2) as [Issue, Issue]
    expect(stdout).toBe(`${id(s1)}\n${id(s2)}\n`)
    expect(subIssueTitles(p)).toEqual(['S1', 'S2'])
    expect([s1.status, s2.status]).toEqual(['todo', 'todo'])
    const written = (issue: Issue) =>
      hoot.labels
        .labelsOf(issue.id)
        .map((label) => (label.group ? `${label.group} › ${label.name}` : label.name))
    expect(written(s1)).toEqual(['Spec-driven › ready to design'])
    expect(written(s2)).toEqual(['Spec-driven › ready to design', 'x'])
    expect(dependencyTitles()).toEqual([
      ['P', 'S1'],
      ['S2', 'S1'],
      ['P', 'S2'],
    ])
    // Their activity says the agent gave them the labels.
    expect(
      hoot.labels
        .eventsOfShown()
        .filter((event) => event.issueId === s2.id)
        .map((event) => [event.kind, event.label, event.actor]),
    ).toEqual([
      ['added', 'Spec-driven › ready to design', 'agent'],
      ['added', 'x', 'agent'],
    ])
  })

  it('creates no issue when a label is not one, and has no command split any more', async () => {
    const p = addIssue('P', 'todo')
    const file = path.join(hoot.directory, 'f.json')
    fs.writeFileSync(file, JSON.stringify([{ title: 'S1' }, { title: 'S2', labels: ['nope'] }]))
    await expectRefused(['issue', 'create-batch', id(p), '--file', file], 'no label named "nope"')
    const split = await run(['issue', 'split', id(p), '--file', file])
    expect(split.code).toBe(1)
    expect(split.stdout).toBe('')
    expect(saved().map((issue) => issue.title)).toEqual(['P'])
  })
})

/** How an issue's labels are written, in the order Hoot lists them. */
const labelsOf = (issue: Issue) =>
  hoot.labels
    .labelsOf(issue.id)
    .map((label) => (label.group === null ? label.name : `${label.group} › ${label.name}`))

describe('hoot issue create, edit, list and view with labels', () => {
  beforeEach(() => {
    hoot.labels.createLabel({ name: 'x', color: 'ff8800', description: 'Ex' })
    hoot.labels.createLabel({ name: 'y', color: '00ff00' })
  })

  it('creates an issue with the labels given, repeated or separated by commas, and none when one is not a label', async () => {
    expect(await run(['issue', 'create', '--title', 'P', '--label', 'x,Y'])).toMatchObject({
      code: 0,
    })
    const p = saved().at(-1)!
    expect(labelsOf(p)).toEqual(['x', 'y'])
    await expectRefused(
      ['issue', 'create', '--title', 'Q', '--label', 'x', '--label', 'nope'],
      'There is no label named "nope".',
    )
    expect(saved().map((issue) => issue.title)).toEqual(['P'])
    await expectRefused(
      ['issue', 'create', '--title', 'Q', '--label', 'x,'],
      'A label name is empty.',
    )
  })

  it('gives and takes off labels, a label of a group replacing the other, as the edit did before', async () => {
    await run(['issue', 'create', '--title', 'P', '--label', 'x,y'])
    const p = saved().at(-1)!
    expect(
      await run(['issue', 'edit', id(p), '--remove-label', 'y', '--add-label', 'ready to design']),
    ).toEqual({
      code: 0,
      stdout: `${id(p)}\n`,
      stderr: '',
    })
    expect(labelsOf(p)).toEqual(['Spec-driven › ready to design', 'x'])
    expect((await run(['issue', 'edit', id(p), '--add-label', 'triaging'])).code).toBe(0)
    expect(labelsOf(p)).toEqual(['Spec-driven › triaging', 'x'])
    await expectRefused(['issue', 'edit', id(p), '--add-label', 'nope'], 'no label named "nope"')
    await expectRefused(
      ['issue', 'edit', id(p), '--add-label', 'x', '--remove-label', 'x'],
      'x cannot both be given to',
    )
    expect(labelsOf(p)).toEqual(['Spec-driven › triaging', 'x'])
    // Together with the parent and dependencies, all or nothing.
    const q = addIssue('Q', 'todo')
    await expectRefused(
      ['issue', 'edit', id(p), '--add-blocked-by', id(p), '--add-label', 'y'],
      'cannot be blocked by itself',
    )
    expect(labelsOf(p)).toEqual(['Spec-driven › triaging', 'x'])
    expect((await run(['issue', 'edit', id(p), '--parent', id(q), '--add-label', 'y'])).code).toBe(
      0,
    )
    expect(subIssueTitles(q)).toEqual(['P'])
    expect(labelsOf(p)).toEqual(['Spec-driven › triaging', 'x', 'y'])
    // The activity names the agent, the label taken off by the one of its group included.
    expect(
      hoot.labels
        .eventsOfShown()
        .filter((event) => event.issueId === p.id)
        .map((event) => [event.kind, event.label, event.actor]),
    ).toEqual([
      ['added', 'x', 'agent'],
      ['added', 'y', 'agent'],
      ['removed', 'y', 'agent'],
      ['added', 'Spec-driven › ready to design', 'agent'],
      ['removed', 'Spec-driven › ready to design', 'agent'],
      ['added', 'Spec-driven › triaging', 'agent'],
      ['added', 'y', 'agent'],
    ])
  })

  it('lists the issues with every label given, and refuses a name that is no label', async () => {
    await run(['issue', 'create', '--title', 'P', '--label', 'x', '--label', 'triaging'])
    await run(['issue', 'create', '--title', 'R', '--label', 'x'])
    await run(['issue', 'create', '--title', 'S'])
    const titles = async (...args: string[]) =>
      (
        JSON.parse((await run(['issue', 'list', ...args, '--json'])).stdout) as Array<{
          title: string
        }>
      ).map((issue) => issue.title)
    expect((await titles('--label', 'x')).toSorted()).toEqual(['P', 'R'])
    expect(await titles('--label', 'x', '--label', 'TRIAGING')).toEqual(['P'])
    expect(await titles('--label', 'x,y')).toEqual([])
    await expectRefused(['issue', 'list', '--label', 'nope'], 'no label named "nope"')
  })

  it('writes the labels in view and list, and gives them as label objects with --json', async () => {
    await run(['issue', 'create', '--title', 'P', '--label', 'x,triaging'])
    const p = saved().at(-1)!
    const view = (await run(['issue', 'view', id(p)])).stdout
    expect(view.split('\n')[2]).toBe('Labels: Spec-driven › triaging, x')
    expect((await run(['issue', 'list'])).stdout).toContain('P  [Spec-driven › triaging, x]\n')
    const json = JSON.parse((await run(['issue', 'view', id(p), '--json'])).stdout)
    expect(json.labels).toStrictEqual([
      {
        name: 'triaging',
        color: '4ea7fc',
        description: 'Judging whether the issue is one piece of work or several',
        group: 'Spec-driven',
      },
      { name: 'x', color: 'ff8800', description: 'Ex', group: null },
    ])
    const plain = addIssue('Plain')
    expect(JSON.parse((await run(['issue', 'view', id(plain), '--json'])).stdout).labels).toEqual(
      [],
    )
  })
})

describe('hoot label', () => {
  it('creates, lists, changes and deletes labels', async () => {
    expect(
      await run(['label', 'create', 'area', '--color', 'ff8800', '--description', 'Area of code']),
    ).toEqual({ code: 0, stdout: '', stderr: '' })
    const listed = (await run(['label', 'list'])).stdout
    expect(listed).toMatch(/^area +No group +ff8800 +Area of code$/m)
    for (const name of ['triaging', 'ready to design', 'designing', 'waiting on sub-issues']) {
      expect(listed).toMatch(new RegExp(`^${name} +Spec-driven +[0-9a-f]{6} `, 'm'))
    }
    const json = JSON.parse((await run(['label', 'list', '--json'])).stdout)
    expect(json).toContainEqual({
      name: 'area',
      color: 'ff8800',
      description: 'Area of code',
      group: null,
    })
    await expectRefused(['label', 'create', 'Area'], 'There is a label named "area" already')
    await expectRefused(['label', 'create', 'z', '--color', 'red'], '"red" is not a color')
    expect((await run(['label', 'create', 'z'])).code).toBe(0)
    expect(hoot.labels.findByName('z')).toMatchObject({ description: '', group: null })
    expect(hoot.labels.findByName('z')!.color).toMatch(/^[0-9a-f]{6}$/)
    expect((await run(['label', 'edit', 'AREA', '--name', 'zone', '--color', '00FF00'])).code).toBe(
      0,
    )
    expect(hoot.labels.findByName('zone')).toMatchObject({ color: '00ff00' })
    await expectRefused(['label', 'edit', 'nope', '--name', 'n'], 'There is no label named "nope".')
    await expectRefused(['label', 'edit', 'zone'], 'Nothing to change')
  })

  it("refuses to change or delete the labels of the workflow's group, or take a name of theirs", async () => {
    for (const args of [
      ['label', 'edit', 'triaging', '--name', 'Begin'],
      ['label', 'edit', 'ready to design', '--color', '112233'],
      ['label', 'edit', 'waiting on sub-issues', '--description', 'x'],
      ['label', 'delete', 'ready to design', '--yes'],
    ]) {
      await expectRefused(args, 'belongs to the workflow Spec-driven')
    }
    await expectRefused(
      ['label', 'create', 'Triaging'],
      'There is a label named "Spec-driven › triaging"',
    )
    expect(hoot.labels.findByName('triaging')).toMatchObject({
      name: 'triaging',
      group: 'Spec-driven',
    })
  })

  it('deletes a label only with --yes, taking it off every issue', async () => {
    hoot.labels.createLabel({ name: 'tmp' })
    await run(['issue', 'create', '--title', 'B', '--label', 'tmp'])
    const b = saved().at(-1)!
    await expectRefused(['label', 'delete', 'tmp'], 'give --yes to delete it')
    expect(labelsOf(b)).toEqual(['tmp'])
    expect(await run(['label', 'delete', 'tmp', '--yes'])).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    })
    expect(labelsOf(b)).toEqual([])
    expect(hoot.labels.findByName('tmp')).toBeUndefined()
  })
})

describe('hoot session start', () => {
  it('asks Hoot for a session for an issue of the project, and prints the worktree it runs in', async () => {
    const a = addIssue('A')
    expect(await run(['session', 'start', id(a)])).toEqual({
      code: 0,
      stdout: `/worktrees/gamma/iss-${a.id}\n`,
      stderr: '',
    })
    expect(hoot.startedSessions).toEqual([{ issueId: a.id, prompt: null }])
    expect(labelsOf(a)).toEqual(['Spec-driven › triaging'])
  })

  it('starts an issue ready for a step at that step, giving it the label of the step', async () => {
    const a = addIssue('A')
    hoot.labels.changeIssueLabels(
      a.id,
      { add: [hoot.labels.findByName('ready to design')!.id] },
      'user',
    )
    expect((await run(['session', 'start', id(a)])).code).toBe(0)
    expect(labelsOf(a)).toEqual(['Spec-driven › designing'])
  })

  it('gives the session the first message of a file', async () => {
    const a = addIssue('A')
    const file = path.join(hoot.directory, 'p.txt')
    fs.writeFileSync(file, 'Do this first.\n')
    expect((await run(['session', 'start', `${a.id}`, '--prompt-file', file])).code).toBe(0)
    expect(hoot.startedSessions).toEqual([{ issueId: a.id, prompt: 'Do this first.\n' }])
    await expectRefused(
      ['session', 'start', id(a), '--prompt-file', path.join(hoot.directory, 'missing.txt')],
      'Could not read the first message from',
    )
    expect(hoot.startedSessions).toHaveLength(1)
  })

  it('refuses an issue that cannot be started now, saying every reason, and starts nothing', async () => {
    const a = addIssue('A')
    const b = addIssue('B', 'todo')
    block(a, b)
    await expectRefused(
      ['session', 'start', id(a)],
      `Work on ${id(a)} cannot be started now:\n- It waits on ${id(b)}, which is neither done nor canceled.`,
    )
    hoot.issues.update(b.id, { status: 'done' })
    const d = addIssue('D')
    hoot.labels.changeIssueLabels(
      d.id,
      { add: [hoot.labels.findByName('waiting on sub-issues')!.id] },
      'user',
    )
    await expectRefused(
      ['session', 'start', id(d)],
      'Its workflow is finished: it has the label "waiting on sub-issues".',
    )
    hoot.setTools({ detecting: true, tools: [], error: null })
    await expectRefused(
      ['session', 'start', id(a)],
      'still checking whether Claude Code is installed',
    )
    const none = addElsewhere(null, 'C')
    await expectRefused(
      ['session', 'start', id(none)],
      `There is no issue ${id(none)} in this session's project, gamma.`,
    )
    expect(hoot.startedSessions).toEqual([])
  })

  it('says why the session did not start', async () => {
    const a = addIssue('A')
    hoot.setStartSession(async () => ({ ok: false, message: 'Claude Code exited.' }))
    const stderr = await expectRefused(['session', 'start', id(a)], 'Claude Code exited.')
    expect(stderr).toBe('error: Claude Code exited.\n')
  })
})

/** The input Claude Code gives a hook on standard input, for an event. */
const hookInput = (event: string) =>
  JSON.stringify({
    session_id: 'b2b7c1f0-0000-4000-8000-000000000000',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/work/gamma',
    hook_event_name: event,
  })

describe('hoot hook', () => {
  it("reports to Hoot each event Hoot takes, from the hook's input, and prints nothing", async () => {
    for (const event of ['PermissionRequest', 'Elicitation', 'Stop', 'StopFailure']) {
      expect(await run(['hook'], { stdin: hookInput(event) })).toEqual({
        code: 0,
        stdout: '',
        stderr: '',
      })
    }
    expect(await run(['hook'], { session: 'hotel-session', stdin: hookInput('Stop') })).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    })
    expect(hoot.hookEvents).toEqual([
      { sessionId: 'gamma-session', event: 'PermissionRequest' },
      { sessionId: 'gamma-session', event: 'Elicitation' },
      { sessionId: 'gamma-session', event: 'Stop' },
      { sessionId: 'gamma-session', event: 'StopFailure' },
      { sessionId: 'hotel-session', event: 'Stop' },
    ])
  })

  it('reports nothing for any other input, and still succeeds without a word', async () => {
    for (const stdin of [hookInput('Notification'), '', 'not JSON', '[]', 'null', '{}']) {
      expect(await run(['hook'], { stdin })).toEqual({ code: 0, stdout: '', stderr: '' })
    }
    expect(hoot.hookEvents).toEqual([])
    expect(hookEventOf(Buffer.from(hookInput('StopFailure')))).toBe('StopFailure')
    expect(hookEventOf(Buffer.from(JSON.stringify({ hook_event_name: 7 })))).toBeNull()
  })

  it('succeeds without a word when it cannot report, so that Claude Code goes on as it would', async () => {
    expect(await run(['hook'], { session: 'closed-session', stdin: hookInput('Stop') })).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    })
    let output = ''
    const code = await runHoot(['hook'], {
      env: {},
      write: (text) => (output += text),
      writeError: (text) => (output += text),
      readStdin: async () => Buffer.from(hookInput('Stop')),
      readFile: async () => new Uint8Array(),
    })
    expect({ code, output }).toEqual({ code: 0, output: '' })
    await hoot.server.stop()
    expect(await run(['hook'], { stdin: hookInput('Stop') })).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
    })
    expect(hoot.hookEvents).toEqual([])
  })

  it('is left out of the help', async () => {
    const { stdout } = await run(['--help'])
    expect(stdout).not.toMatch(/\bhook\b/)
  })
})

describe('hoot --help and hoot issue --help', () => {
  it('together name the commands, their arguments and options, the names of statuses and priorities, and the defaults', async () => {
    const top = await run(['--help'])
    const issue = await run(['issue', '--help'])
    expect(top.code).toBe(0)
    expect(issue.code).toBe(0)
    // As one line: the help wraps to the width of the terminal.
    const help = `${top.stdout}${issue.stdout}`.replace(/\s+/g, ' ')
    for (const text of [
      'view',
      'list',
      'create',
      '<issue>',
      'ISS-12',
      '--all',
      '--status <name>',
      '--title <title>',
      '--description <text>',
      '--description-file <file>',
      '--priority <name>',
      '--json',
      '"backlog", "todo", "in-progress", "done", "canceled"',
      '"none", "urgent", "high", "medium", "low"',
      'default: "backlog"',
      'default: "none"',
      'edit',
      '--parent <issue>',
      '--remove-parent',
      '--add-sub-issue <issues>',
      '--remove-sub-issue <issues>',
      'create-batch',
      '--file <file>',
      '--label <names>',
      '--add-label <names>',
      '--remove-label <names>',
      '--blocked-by <issues>',
      '--blocking <issues>',
      '--add-blocked-by <issues>',
      '--remove-blocked-by <issues>',
      '--add-blocking <issues>',
      '--remove-blocking <issues>',
    ]) {
      expect(help).toContain(text)
    }
    // The create command's --parent, and the edit command's options, each in its own usage.
    expect(help).toMatch(/Usage: hoot issue create .*--parent <issue>.*Usage: hoot issue edit/)
    expect(help).toMatch(
      /Usage: hoot issue edit .*--parent <issue>.*--remove-parent.*--add-sub-issue <issues>.*--remove-sub-issue <issues>/,
    )
    expect(help).toMatch(
      /Usage: hoot issue create .*--blocked-by <issues>.*--blocking <issues>.*Usage: hoot issue edit/,
    )
    expect(help).toMatch(
      /Usage: hoot issue edit .*--add-blocked-by <issues>.*--remove-blocked-by <issues>.*--add-blocking <issues>.*--remove-blocking <issues>/,
    )
    expect(help).toMatch(
      /Usage: hoot issue create-batch \[options\] <issue>.*--file <file>.*--json/,
    )
    expect(`${top.stdout}${issue.stdout}`).not.toMatch(/step/i)
  })

  it('shows the help of a command', async () => {
    const { code, stdout } = await run(['issue', 'create', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage: hoot issue create [options]')
  })

  it('names the label and session commands, and no step command', async () => {
    const top = await run(['--help'])
    const label = await run(['label', '--help'])
    const session = await run(['session', '--help'])
    expect(label.code).toBe(0)
    expect(session.code).toBe(0)
    const all = `${top.stdout}${label.stdout}${session.stdout}`
    const help = all.replace(/\s+/g, ' ')
    for (const text of [
      'hoot label --help',
      'hoot session --help',
      'Usage: hoot label list [options]',
      'Usage: hoot label create [options] <name>',
      'Usage: hoot label edit [options] <name>',
      'Usage: hoot label delete [options] <name>',
      '--color <color>',
      '--description <text>',
      '--yes',
      'Usage: hoot session start [options] <issue>',
      '--prompt-file <file>',
    ]) {
      expect(help).toContain(text)
    }
    expect(all).not.toMatch(/step|workflow/i)
    const step = await run(['step', 'report', 'done', '--summary', 'x'])
    expect(step.code).toBe(1)
  })
})

describe('what hoot cannot do', () => {
  it('refuses commands and options it does not know', async () => {
    for (const args of [
      ['issue', 'frobnicate'],
      ['issue', 'list', '--bogus'],
      ['frobnicate'],
      ['issue', 'list', 'extra'],
      ['issue', 'view'],
    ]) {
      const { code, stdout, stderr } = await run(args)
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toMatch(/^error: /)
    }
  })

  it('says that it works only in the sessions Hoot starts', async () => {
    let stderr = ''
    const code = await runHoot(['issue', 'list'], {
      env: {},
      write: () => {},
      writeError: (text) => (stderr += text),
      readStdin: async () => new Uint8Array(),
      readFile: async () => new Uint8Array(),
    })
    expect(code).toBe(1)
    expect(stderr).toContain('works only in the sessions that Hoot starts')
  })

  it('says that Hoot is not running once it has quit', async () => {
    await hoot.server.stop()
    expect(fs.existsSync(hoot.socket)).toBe(false)
    const { code, stderr } = await run(['issue', 'list'])
    expect(code).toBe(1)
    expect(stderr).toBe(
      'error: Hoot is not running: the Hoot that started this session has quit.\n',
    )
  })

  // Nothing is left on Windows: a named pipe goes with the process that listened on it.
  it.skipIf(process.platform === 'win32')(
    'says that Hoot is not running when nothing listens on the socket it left',
    async () => {
      await hoot.server.stop()
      await leaveSocket(hoot.socket)
      expect(fs.statSync(hoot.socket).isSocket()).toBe(true)
      const { code, stderr } = await run(['issue', 'list'])
      expect(code).toBe(1)
      expect(stderr).toBe(
        'error: Hoot is not running: the Hoot that started this session has quit.\n',
      )
    },
  )

  // The named pipe that Hoot listens on on Windows has no permissions to take away.
  it.skipIf(process.platform === 'win32')(
    'says that a sandbox may have blocked the connection when the system refuses it',
    async () => {
      // As a sandbox does; here the socket's permissions refuse it.
      fs.chmodSync(hoot.socket, 0o000)
      const { code, stderr } = await run(['issue', 'list'])
      fs.chmodSync(hoot.socket, 0o600)
      expect(code).toBe(1)
      expect(stderr).toContain('which a sandbox may have blocked')
      expect(stderr).toContain('Run hoot outside the sandbox.')
    },
  )

  it('passes on why Hoot could not do it', async () => {
    const { code, stderr } = await run(['issue', 'list'], { session: 'closed-session' })
    expect(code).toBe(1)
    expect(stderr).toBe('error: No such session.\n')
  })
})
