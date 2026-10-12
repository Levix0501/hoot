import type { AppDriver } from './support/app'
import { storedIssues } from './support/database'
import { expectSaved, expectShown, issuePage, openIssue } from './support/issues'
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

/** The description of an issue as the database has it. */
function savedDescription(app: AppDriver, id: number): string | undefined {
  return storedIssues(app.userData).find((issue) => issue.id === id)?.description
}

test.describe('an issue’s description', () => {
  test('shows its Markdown laid out, runs none of its HTML, and opens only its web links, in the browser', async ({
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
    await expect(description.locator('table th')).toHaveText(['a', 'b'])
    await expect(description.locator('table td')).toHaveText(['1', '2'])
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

    // 2: HTML for formatting formats; HTML for anything else makes nothing, and no script runs.
    await expect(description.locator('strong')).toHaveText('bold')
    await expect(description.locator('img')).toHaveCount(0)

    // 3: showing it, and going in and out of it, changes nothing.
    await description.locator('h1').click()
    await description.blur()
    await app.page.waitForTimeout(500)
    expect(savedDescription(app, id)).toBe(DESCRIPTION)

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
    expect(savedDescription(app, id)).toBe(DESCRIPTION)

    // 5: a task list's box is ticked where it shows, which is saved.
    const boxes = description.locator('input[type="checkbox"]')
    await expect(boxes).toHaveCount(2)
    const checked = async () => [await boxes.nth(0).isChecked(), await boxes.nth(1).isChecked()]
    expect(await checked()).toEqual([false, true])
    await boxes.nth(0).click()
    expect(await checked()).toEqual([true, true])
    await expect.poll(() => savedDescription(app, id)).toContain('- [x] todo')
    expect(dialogs).toEqual([])

    // 6: as saved, also after starting again.
    const saved = savedDescription(app, id)
    await app.quit()
    await app.waitForExit()
    app = await launch()
    await openIssue(app, G, 'Markdown')
    await expect(
      issuePage(app).getByTestId('issue-description').locator('input[type="checkbox"]').first(),
    ).toBeChecked()
    expect(savedDescription(app, id)).toBe(saved)
  })

  test('is formatted as it is typed, and saved as Markdown', async ({ launch, world }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G], issues: [{ root: G, title: 'Plan' }] })
    const id = await openIssue(app, G, 'Plan')
    const description = issuePage(app).getByTestId('issue-description')
    await expect(description.locator('p').first()).toHaveAttribute(
      'data-placeholder',
      'Add description…',
    )

    await description.click()
    await app.page.keyboard.type('# Steps')
    await app.page.keyboard.press('Enter')
    await app.page.keyboard.type('- one')
    await app.page.keyboard.press('Enter')
    await app.page.keyboard.type('two')
    await app.page.keyboard.press('Enter')
    await app.page.keyboard.press('Enter')
    await app.page.keyboard.type('Done with ')
    await expect(description.locator('h1')).toHaveText('Steps')
    await expect(description.locator('ul > li')).toHaveText(['one', 'two'])

    // ⌘B makes text bold here, and leaves the sidebar as it is.
    await app.page.keyboard.press('Meta+b')
    await app.page.keyboard.type('bold')
    await expect(description.locator('strong')).toHaveText('bold')
    await app.expectSidebar('expanded')

    await description.blur()
    await expectSaved(app, id, { description: '# Steps\n\n- one\n- two\n\nDone with **bold**' })
  })
})
