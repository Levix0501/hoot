import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Environment variables a macOS app gets from the graphical login session. */
const SESSION_VARIABLES = ['USER', 'LOGNAME', 'TMPDIR', '__CF_USER_TEXT_ENCODING', 'SSH_AUTH_SOCK']

export interface Repositories {
  /** A non-bare repository with a commit, a `sub` directory and a linked worktree `W`. */
  G: string
  Gsub: string
  W: string
  /** Another non-bare repository. */
  H: string
  /** A directory outside any repository. */
  N: string
  /** A bare repository with a linked worktree `BW`. */
  B: string
  BW: string
}

/** Repositories whose Git directory is not the `.git` directory of their working directory. */
export interface OtherLayouts {
  /** A non-bare repository that checks out a submodule at `P/mod`. */
  P: string
  /** The submodule's checkout `P/mod`, with a subdirectory `M/sub`. */
  M: string
  Msub: string
  /** The working directory of a repository created with `git init --separate-git-dir`. */
  S: string
  /** That repository's Git directory, outside S. */
  SGitDir: string
  /** A linked worktree of that repository, outside S. */
  SW: string
}

/**
 * An isolated user environment for one test: a home directory with zsh
 * startup files, directories for substitute tool commands, Git repositories,
 * and the environment Hoot is launched with.
 */
export interface World {
  root: string
  home: string
  userData: string
  /** Added to PATH by `.zprofile` (login startup file). */
  loginBin: string
  /** Added to PATH by `.zshrc` only (interactive startup file). */
  interactiveBin: string
  /** Added to PATH by `.zprofile`, initially empty. */
  laterBin: string
  /** Where substitute commands write what they received. */
  records: string
  repos: Repositories
  /** The environment Hoot is launched with, standing in for the GUI session environment. */
  env: Record<string, string>
  prompt: string
  dispose(): void
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'hoot e2e',
      GIT_AUTHOR_EMAIL: 'e2e@example.com',
      GIT_COMMITTER_NAME: 'hoot e2e',
      GIT_COMMITTER_EMAIL: 'e2e@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  })
}

function createRepositories(root: string): Repositories {
  const reposDir = path.join(root, 'repos')
  const G = path.join(reposDir, 'G')
  const Gsub = path.join(G, 'sub')
  const W = path.join(reposDir, 'W')
  const H = path.join(reposDir, 'H')
  const N = path.join(reposDir, 'N')
  const B = path.join(reposDir, 'B.git')
  const BW = path.join(reposDir, 'BW')
  const seed = path.join(reposDir, 'seed')

  fs.mkdirSync(Gsub, { recursive: true })
  git(G, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(G, 'README.md'), '# G\n')
  fs.writeFileSync(path.join(Gsub, 'file.txt'), 'sub\n')
  git(G, 'add', '.')
  git(G, 'commit', '-q', '-m', 'initial')
  git(G, 'worktree', 'add', '-q', '-b', 'feature', W)

  fs.mkdirSync(H, { recursive: true })
  git(H, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(H, 'README.md'), '# H\n')
  git(H, 'add', '.')
  git(H, 'commit', '-q', '-m', 'initial')

  fs.mkdirSync(N, { recursive: true })
  fs.writeFileSync(path.join(N, 'notes.txt'), 'not a repository\n')

  fs.mkdirSync(seed, { recursive: true })
  git(seed, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(seed, 'README.md'), '# seed\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-q', '-m', 'initial')
  git(reposDir, 'clone', '-q', '--bare', seed, B)
  git(B, 'worktree', 'add', '-q', BW, 'main')

  return { G, Gsub, W, H, N, B, BW }
}

/** Creates a repository with a submodule and one with a separate Git directory in the world. */
export function createOtherLayouts(world: World): OtherLayouts {
  const reposDir = path.join(world.root, 'layouts')
  const source = path.join(reposDir, 'module-source')
  const P = path.join(reposDir, 'P')
  const M = path.join(P, 'mod')
  const S = path.join(reposDir, 'S')
  const SGitDir = path.join(reposDir, 'S-git')
  const SW = path.join(reposDir, 'SW')

  fs.mkdirSync(path.join(source, 'sub'), { recursive: true })
  git(source, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(source, 'sub', 'file.txt'), 'module\n')
  git(source, 'add', '.')
  git(source, 'commit', '-q', '-m', 'initial')

  fs.mkdirSync(P, { recursive: true })
  git(P, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(P, 'README.md'), '# P\n')
  git(P, 'add', '.')
  git(P, 'commit', '-q', '-m', 'initial')
  git(P, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'mod')
  git(P, 'commit', '-q', '-m', 'add submodule')

  git(reposDir, 'init', '-q', '-b', 'main', `--separate-git-dir=${SGitDir}`, S)
  fs.writeFileSync(path.join(S, 'README.md'), '# S\n')
  git(S, 'add', '.')
  git(S, 'commit', '-q', '-m', 'initial')
  git(S, 'worktree', 'add', '-q', '-b', 'feature', SW)

  return { P, M, Msub: path.join(M, 'sub'), S, SGitDir, SW }
}

export function createWorld(): World {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-e2e-')))
  const home = path.join(root, 'home')
  const userData = path.join(root, 'user-data')
  const loginBin = path.join(root, 'bin', 'login')
  const interactiveBin = path.join(root, 'bin', 'interactive')
  const laterBin = path.join(root, 'bin', 'later')
  const records = path.join(root, 'records')
  for (const directory of [home, userData, loginBin, interactiveBin, laterBin, records]) {
    fs.mkdirSync(directory, { recursive: true })
  }

  const prompt = 'e2e$ '
  fs.writeFileSync(path.join(home, '.zshenv'), '')
  fs.writeFileSync(
    path.join(home, '.zprofile'),
    `export PATH="${loginBin}:${laterBin}:$PATH"\nexport HOOT_E2E_LOGIN_FILE=loaded\n`,
  )
  fs.writeFileSync(
    path.join(home, '.zshrc'),
    [
      `export PATH="${interactiveBin}:$PATH"`,
      'export HOOT_E2E_RC_FILE=loaded',
      `PS1='${prompt}'`,
      'unsetopt PROMPT_SP',
      '',
    ].join('\n'),
  )

  const env: Record<string, string> = {
    HOME: home,
    SHELL: '/bin/zsh',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  }
  for (const name of SESSION_VARIABLES) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }

  return {
    root,
    home,
    userData,
    loginBin,
    interactiveBin,
    laterBin,
    records,
    repos: createRepositories(root),
    env,
    prompt,
    dispose() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}
