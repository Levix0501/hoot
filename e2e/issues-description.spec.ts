import { storedIssues } from './support/database'
import { clickProjectRow, issuePage, openIssue, shownIssueId, expectShown } from './support/issues'
import { expect, test } from './support/test'

const DESCRIPTION = [
  '# Heading',
  '',
  '- bullet',
  '',
  '1. first',
  '',
  '```',
  'let x = 1',
  '```',
  '',
  '- [ ] todo',
  '- [x] done',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '<b>bold</b> <img src="x" onerror="alert(1)">',
  '',
  '[web](https://example.com/path) [mail](mailto:someone@example.com) [rel](docs/readme.md)',
].join('\n')

/** In the main process: the addresses Hoot asked macOS to open. */
type Opened = { openedExternally?: string[] }

test.describe('an issue’s description', () => {
  test('is rendered as GitHub Flavored Markdown, without its HTML; only its web links open, in the browser', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    let app = await launch({
      projects: [G],
      issues: [{ root: G, title: 'Markdown', description: DESCRIPTION }],
    })
    const dialogs: string[] = []
    app.page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })
    // The default browser itself is not opened in the tests: Hoot asks macOS to open the address.
    await app.electronApp.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as Opened).openedExternally = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    const id = await openIssue(app, G, 'Markdown')
    const description = issuePage(app).getByTestId('issue-description')

    // 1: headings, lists, code, task lists and tables, laid out as such.
    await expect(description.locator('h1')).toHaveText('Heading')
    await expect(description.locator('ul > li', { hasText: 'bullet' })).toHaveCount(1)
    await expect(description.locator('ol > li')).toHaveText(['first'])
    await expect(description.locator('pre > code')).toHaveText(/^let x = 1\s*$/)
    await expect(description.locator('table thead th')).toHaveText(['a', 'b'])
    await expect(description.locator('table tbody td')).toHaveText(['1', '2'])
    const shownText = await issuePage(app).innerText()
    for (const syntax of ['# Heading', '- [ ]', '- [x]', '| a | b |', '```']) {
      expect(shownText).not.toContain(syntax)
    }
    // Laid out by @tailwindcss/typography.
    await expect(description).toHaveClass(/\bprose\b/)
    expect(
      await description
        .locator('h1')
        .evaluate((heading) => Number.parseFloat(getComputedStyle(heading).fontSize)),
    ).toBeGreaterThan(
      await description.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    )

    // 2: the task list's boxes show what is done, and do not change when clicked.
    const boxes = description.locator('input[type="checkbox"]')
    await expect(boxes).toHaveCount(2)
    const checked = async () => [await boxes.nth(0).isChecked(), await boxes.nth(1).isChecked()]
    expect(await checked()).toEqual([false, true])
    for (const index of [0, 1]) {
      const box = (await boxes.nth(index).boundingBox())!
      await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await app.page.waitForTimeout(200)
      expect(await checked()).toEqual([false, true])
    }

    // 3: its HTML is not HTML: no elements, and no script ran.
    await expect(description.locator('b')).toHaveCount(0)
    await expect(description.locator('img')).toHaveCount(0)
    await expect(description).toContainText('<b>bold</b>')

    // 4: only the web link opens, in the default browser; the window stays as it is.
    const opened = () =>
      app.electronApp.evaluate(() => (globalThis as Opened).openedExternally ?? [])
    await description.getByRole('link', { name: 'web' }).click()
    await expect.poll(opened).toEqual(['https://example.com/path'])
    for (const name of ['mail', 'rel']) {
      await description.getByRole('link', { name }).click()
    }
    // Also with the middle button and with ⌘, which would open a new window.
    await description.getByRole('link', { name: 'rel' }).click({ button: 'middle' })
    await description.getByRole('link', { name: 'mail' }).click({ modifiers: ['Meta'] })
    await app.page.waitForTimeout(500)
    expect(await opened()).toEqual(['https://example.com/path'])
    await expectShown(app, `issue:${id}`)
    expect(
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1)
    expect(dialogs).toEqual([])
    await app.expectEnglishUi()

    // When macOS cannot open the address, Hoot says so in its log and goes on.
    const output: string[] = []
    app.mainProcess.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
    await app.electronApp.evaluate(({ shell }) => {
      shell.openExternal = async () => {
        throw new Error('no browser')
      }
    })
    await description.getByRole('link', { name: 'web' }).click()
    await expect
      .poll(() => output.join(''))
      .toContain('Could not open https://example.com/path: Error: no browser')
    await expectShown(app, `issue:${id}`)

    // 6: the description's field in the edit state is plain text, with no preview.
    await issuePage(app).getByTestId('issue-edit').click()
    const field = issuePage(app).getByTestId('issue-description-input')
    expect(await field.evaluate((element) => element.tagName)).toBe('TEXTAREA')
    await expect(field).toHaveValue(DESCRIPTION)
    await field.fill('# Heading')
    await expect(field).toHaveValue('# Heading')
    await expect(app.page.getByRole('heading', { name: 'Heading', exact: true })).toHaveCount(0)
    await expect(app.mainArea().getByRole('heading')).toHaveCount(0)
    await expect(app.page.getByRole('tab')).toHaveCount(0)
    await expect(app.page.getByRole('button', { name: /preview|write/i })).toHaveCount(0)
    await issuePage(app).getByTestId('issue-cancel-edit').click()

    // And on the new issue page.
    await clickProjectRow(app, G)
    await app.page.getByTestId('new-issue-button').click()
    const draft = app.page.getByTestId('new-issue-description')
    expect(await draft.evaluate((element) => element.tagName)).toBe('TEXTAREA')
    await draft.fill('# Heading')
    await expect(draft).toHaveValue('# Heading')
    await expect(app.page.getByRole('heading', { name: 'Heading', exact: true })).toHaveCount(0)
    // The page's own heading is the only one.
    await expect(app.mainArea().getByRole('heading')).toHaveText(['New Issue'])
    await expect(app.page.getByRole('button', { name: /preview|write/i })).toHaveCount(0)
    expect(dialogs).toEqual([])

    // 2: the description is as it was, also after starting again.
    await app.quit()
    await app.waitForExit()
    expect(storedIssues(world.userData).find((issue) => issue.id === id)?.description).toBe(
      DESCRIPTION,
    )
    app = await launch()
    await openIssue(app, G, 'Markdown')
    expect(await shownIssueId(app)).toBe(id)
    await issuePage(app).getByTestId('issue-edit').click()
    await expect(issuePage(app).getByTestId('issue-description-input')).toHaveValue(DESCRIPTION)
  })
})
