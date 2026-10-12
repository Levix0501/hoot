import fs from 'node:fs'
import path from 'node:path'
import {
  changeDatabase,
  databaseContents,
  databaseFile,
  readDatabase,
  storedIssues,
  storedProjects,
  userVersionOf,
  versionOneDatabase,
} from './support/database'
import {
  clickProjectRow,
  createIssue,
  expectList,
  issuePage,
  issueRow,
  listedGroups,
  openIssue,
  setShownIssueStatus,
} from './support/issues'
import { isAlive } from './support/processes'
import { expect, test, type Launch } from './support/test'

test.describe('where issues are kept', () => {
  test('the projects and issues are in data/hoot.db of the user data directory, and stay across restarts', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const file = databaseFile(world.userData)
    expect(fs.existsSync(path.dirname(file))).toBe(false)

    let app = await launch()
    // 1: the database is there before any project is added.
    await expect(app.page.getByTestId('no-projects')).toBeVisible()
    expect(fs.statSync(file).isFile()).toBe(true)
    expect(fs.readFileSync(file).subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0')
    expect(userVersionOf(file)).toBeGreaterThanOrEqual(1)

    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    await createIssue(app, G, 'First', { description: 'Body one' })
    await createIssue(app, G, 'Second')
    await createIssue(app, G, 'Third', { status: 'todo', priority: 2 })
    await openIssue(app, G, 'Second')
    await setShownIssueStatus(app, 'done')
    await createIssue(app, H, 'Other')
    await app.quit()
    await app.waitForExit()
    const before = {
      projects: storedProjects(world.userData),
      issues: storedIssues(world.userData),
    }

    // 2: everything is back after starting again.
    app = await launch()
    expect(await app.projectRoots()).toEqual([G, H])
    await clickProjectRow(app, G)
    await expectList(app, G, 'all')
    expect(await listedGroups(app)).toEqual([
      { status: 'todo', count: 1, titles: ['Third'] },
      { status: 'backlog', count: 1, titles: ['First'] },
      { status: 'done', count: 1, titles: ['Second'] },
    ])
    await openIssue(app, G, 'Second')
    await expect(issuePage(app).getByTestId('issue-status')).toHaveAttribute('data-status', 'done')
    await openIssue(app, G, 'First')
    await expect(issuePage(app).getByTestId('issue-description')).toHaveText('Body one')
    await clickProjectRow(app, H)
    await expectList(app, H, 'all')
    expect(await listedGroups(app)).toEqual([{ status: 'backlog', count: 1, titles: ['Other'] }])
    await app.expectEnglishUi()
    await app.quit()
    await app.waitForExit()
    const after = { projects: storedProjects(world.userData), issues: storedIssues(world.userData) }

    // 3: both observations hold the roots and the titles, with the same times.
    for (const observed of [before, after]) {
      expect(observed.projects.map((project) => project.root)).toEqual([G, H])
      expect(observed.issues.map(({ title, number }) => [title, number])).toEqual([
        ['First', 1],
        ['Second', 2],
        ['Third', 3],
        ['Other', 1],
      ])
    }
    const times = (observed: typeof before) =>
      observed.issues.map(({ created_at, completed_at }) => [created_at, completed_at])
    expect(times(after)).toEqual(times(before))
    expect(before.issues.find((issue) => issue.title === 'Second')?.completed_at).toEqual(
      expect.any(Number),
    )

    // 4: another user data directory has a database of its own.
    const other = path.join(world.root, 'other-user-data')
    app = await launch({ userData: other })
    await expect(app.page.getByTestId('no-projects')).toBeVisible()
    await expect(app.projectItems()).toHaveCount(0)
    expect(fs.existsSync(databaseFile(other))).toBe(true)
  })

  test('a database of the first version is brought up to date: open issues are to do, closed ones done, numbered in the order they were created', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    versionOneDatabase(
      world.userData,
      [G, H],
      [
        { root: G, title: 'Open one', description: 'a' },
        { root: H, title: 'Elsewhere' },
        { root: G, title: 'Closed one', closed: true },
        { root: G, title: 'Open two' },
      ],
    )
    const before = storedIssuesOfVersionOne(world.userData)
    const app = await launch()
    await expect(app.projectItems()).toHaveCount(2)
    expect(userVersionOf(databaseFile(world.userData))).toBe(2)
    await clickProjectRow(app, G)
    expect(await listedGroups(app)).toEqual([
      { status: 'todo', count: 2, titles: ['Open two', 'Open one'] },
      { status: 'done', count: 1, titles: ['Closed one'] },
    ])
    for (const [title, identifier] of [
      ['Open one', 'G-1'],
      ['Closed one', 'G-2'],
      ['Open two', 'G-3'],
    ]) {
      await expect(issueRow(app, title).getByTestId('issue-row-identifier')).toHaveText(identifier)
    }
    expect(storedIssues(world.userData)).toEqual(
      before.map((issue) => ({
        id: issue.id,
        project_id: issue.project_id,
        number: { 'Open one': 1, Elsewhere: 1, 'Closed one': 2, 'Open two': 3 }[issue.title],
        title: issue.title,
        description: issue.description,
        status: issue.state === 'open' ? 'todo' : 'done',
        priority: 0,
        created_at: issue.created_at,
        completed_at: issue.closed_at,
      })),
    )
    // The next issue gets the next number.
    await createIssue(app, G, 'New')
    await expect(issueRow(app, 'New').getByTestId('issue-row-identifier')).toHaveText('G-4')
  })

  test('projects.json is neither read nor changed', async ({ launch, world }) => {
    const { G, H } = world.repos
    const json = path.join(world.userData, 'projects.json')
    const content = JSON.stringify({ projects: [{ root: G }] })
    fs.writeFileSync(json, content)
    const before = fs.readFileSync(json)

    const app = await launch()
    await expect(app.page.getByTestId('no-projects')).toBeVisible()
    await expect(app.projectItems()).toHaveCount(0)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([H])
    await app.quit()
    await app.waitForExit()
    expect(fs.readFileSync(json).equals(before)).toBe(true)
  })
})

/** The issues of a database whose tables are at their first version, as it keeps them. */
function storedIssuesOfVersionOne(userData: string) {
  return readDatabase(databaseFile(userData), (db) =>
    db
      .prepare(
        'SELECT id, project_id, title, description, state, created_at, closed_at FROM issues',
      )
      .all()
      .map(
        (row) =>
          ({ ...row }) as {
            id: number
            project_id: number
            title: string
            description: string
            state: string
            created_at: number
            closed_at: number | null
          },
      ),
  )
}

/** Prepares a database the way the scenario says, by running Hoot once. */
async function databaseWithAnIssue(launch: Launch, root: string): Promise<void> {
  const app = await launch()
  await app.addProject(root)
  await expect(app.projectItems()).toHaveCount(1)
  await createIssue(app, root, 'Kept', { description: 'Its description' })
  await app.quit()
  await app.waitForExit()
}

test.describe('when the database cannot be opened', () => {
  /** Checks what the window shows, then Show in Finder and Quit. */
  async function expectDatabaseError(launch: Launch, file: string, message: RegExp): Promise<void> {
    const app = await launch({ startsWith: 'database-error' })
    const page = app.page
    // 1: no sidebar, projects, sessions or Issues pages; why, the error and where.
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)
    for (const testId of [
      'project-list',
      'no-projects',
      'session',
      'no-session',
      'issue-list-page',
      'new-issue-dialog',
      'issue-page',
    ]) {
      await expect(page.getByTestId(testId)).toHaveCount(0)
    }
    const error = page.getByTestId('database-error')
    await expect(error).toContainText('cannot open its database')
    await expect(page.getByTestId('database-error-message')).toHaveText(message)
    await expect(page.getByTestId('database-error-path')).toHaveText(file)
    await expect(page.getByRole('button', { name: 'Show in Finder' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Quit' })).toBeVisible()
    await app.expectEnglishUi()

    // 2: Finder itself is not opened in the tests: Hoot asks macOS to show the file in it.
    await app.electronApp.evaluate(({ shell }) => {
      const shown: string[] = []
      ;(globalThis as { shownInFinder?: string[] }).shownInFinder = shown
      shell.showItemInFolder = (item: string) => {
        shown.push(item)
      }
    })
    await page.getByRole('button', { name: 'Show in Finder' }).click()
    await expect
      .poll(() =>
        app.electronApp.evaluate(
          () => (globalThis as { shownInFinder?: string[] }).shownInFinder ?? [],
        ),
      )
      .toEqual([expect.stringMatching(/\/data(\/hoot\.db)?$/)])
    const shown = await app.electronApp.evaluate(
      () => (globalThis as { shownInFinder?: string[] }).shownInFinder![0]!,
    )
    expect([file, path.dirname(file)]).toContain(shown)

    // 3: Quit ends every process of Hoot.
    const pids = [app.mainPid, ...(await app.appProcesses()).map((entry) => entry.pid)]
    await page.getByRole('button', { name: 'Quit' }).click()
    await app.waitForExit()
    for (const pid of pids) {
      await expect.poll(() => isAlive(pid), { message: `pid ${pid}` }).toBe(false)
    }
  }

  test('a file that is not a database is left byte for byte as it was', async ({
    launch,
    world,
  }) => {
    const file = databaseFile(world.userData)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const content = Buffer.from('not a database'.repeat(300).slice(0, 4096))
    fs.writeFileSync(file, content)
    await expectDatabaseError(launch, file, /not a database/)
    expect(fs.readFileSync(file).equals(content)).toBe(true)
  })

  test('a database of a newer version is left as it was', async ({ launch, world }) => {
    const file = databaseFile(world.userData)
    await databaseWithAnIssue(launch, world.repos.G)
    changeDatabase(file, `PRAGMA user_version = ${userVersionOf(file) + 1}`)
    const before = databaseContents(file)
    await expectDatabaseError(launch, file, /newer version of Hoot/)
    expect(databaseContents(file)).toEqual(before)
  })

  test('a database in a folder Hoot may not open is left byte for byte as it was', async ({
    launch,
    world,
  }) => {
    const file = databaseFile(world.userData)
    await databaseWithAnIssue(launch, world.repos.G)
    const content = fs.readFileSync(file)
    fs.chmodSync(path.dirname(file), 0o000)
    try {
      await expectDatabaseError(launch, file, /unable to open database file/)
    } finally {
      fs.chmodSync(path.dirname(file), 0o755)
    }
    expect(fs.readFileSync(file).equals(content)).toBe(true)
  })

  test('a database the first migration fails on is left as it was', async ({ launch, world }) => {
    const file = databaseFile(world.userData)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // A table with the name of one the first migration makes, but other columns.
    changeDatabase(file, "CREATE TABLE issues (note TEXT); INSERT INTO issues VALUES ('mine')")
    const before = databaseContents(file)
    expect(before.userVersion).toBe(0)
    await expectDatabaseError(launch, file, /already exists/)
    expect(databaseContents(file)).toEqual(before)
  })
})
