import { referenceLoginEnv } from './support/login-env'
import { ancestors, commandLine, openFiles, parentPid } from './support/processes'
import { expect, test } from './support/test'

const isPtyNativeModule = (file: string) => /node-pty\/.*\/pty\.node$/.test(file)

test('a Shell session is an interactive login shell in the project root, run by the pty host', async ({
  app,
  world,
}) => {
  const { G } = world.repos
  await app.addProject(G)
  await expect(app.projectItems()).toHaveCount(1)
  await app.startSession(G, 'shell')
  await expect(app.session()).toHaveAttribute('data-status', 'running')

  // The terminal is an xterm.js terminal inside the Hoot window.
  await expect(app.page.locator('[data-testid="terminal"] .xterm .xterm-screen')).toBeVisible()
  await app.waitForPrompt()

  await app.run('pwd')
  expect(await app.outputOf('pwd')).toEqual([G])

  const modes = '[[ -o interactive ]] && echo interactive-shell; [[ -o login ]] && echo login-shell'
  await app.run(modes)
  expect(await app.outputOf(modes)).toEqual(['interactive-shell', 'login-shell'])

  await app.run('echo "PATH=$PATH"')
  expect(await app.outputOf('echo "PATH=$PATH"')).toEqual([`PATH=${referenceLoginEnv(world).PATH}`])

  const shellPid = await app.shellPid()
  const ptyHostPid = await app.ptyHostPid()
  expect(ptyHostPid).toBeDefined()
  expect(await ancestors(shellPid)).toContain(ptyHostPid)
  expect(await parentPid(ptyHostPid!)).toBe(app.mainPid)
  expect(await commandLine(ptyHostPid!)).toContain('--type=utility')

  // node-pty's native module is loaded by the pty host and nowhere else.
  expect(openFiles(ptyHostPid!).some(isPtyNativeModule)).toBe(true)
  const processes = await app.appProcesses()
  expect(processes.some((entry) => entry.type === 'Browser')).toBe(true)
  expect(processes.some((entry) => entry.type === 'Tab')).toBe(true)
  for (const entry of processes) {
    if (entry.pid === ptyHostPid) continue
    expect(openFiles(entry.pid).filter(isPtyNativeModule), `${entry.type} ${entry.pid}`).toEqual([])
  }
  await app.expectEnglishUi()
})
