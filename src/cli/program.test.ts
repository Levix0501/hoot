import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Issue, IssuePriority, IssueStatus } from '../shared/issues'
import { leaveSocket, startTestHoot, type TestHoot } from '../main/hoot-cli/test-support'
import { runHoot } from './program'

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
    ]) {
      expect(help).toContain(text)
    }
  })

  it('shows the help of a command', async () => {
    const { code, stdout } = await run(['issue', 'create', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage: hoot issue create [options]')
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

  it('says that Hoot is not running when nothing listens on the socket it left', async () => {
    await hoot.server.stop()
    await leaveSocket(hoot.socket)
    expect(fs.statSync(hoot.socket).isSocket()).toBe(true)
    const { code, stderr } = await run(['issue', 'list'])
    expect(code).toBe(1)
    expect(stderr).toBe(
      'error: Hoot is not running: the Hoot that started this session has quit.\n',
    )
  })

  it('says that a sandbox may have blocked the connection when the system refuses it', async () => {
    // As a sandbox does; here the socket's permissions refuse it.
    fs.chmodSync(hoot.socket, 0o000)
    const { code, stderr } = await run(['issue', 'list'])
    fs.chmodSync(hoot.socket, 0o600)
    expect(code).toBe(1)
    expect(stderr).toContain('which a sandbox may have blocked')
    expect(stderr).toContain('Run hoot outside the sandbox.')
  })

  it('passes on why Hoot could not do it', async () => {
    const { code, stderr } = await run(['issue', 'list'], { session: 'closed-session' })
    expect(code).toBe(1)
    expect(stderr).toBe('error: No such session.\n')
  })
})
