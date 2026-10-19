import { execFile } from 'node:child_process'
import path from 'node:path'
import type { Env } from '../env/env'

/** Environment for running git: no repository overrides and untranslated messages. */
export function gitEnvironment(env: Env): Env {
  const result: Env = {}
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('GIT_')) result[name] = value
  }
  result.LC_ALL = 'C'
  result.GIT_TERMINAL_PROMPT = '0'
  result.GIT_OPTIONAL_LOCKS = '0'
  return result
}

export interface GitResult {
  /** The exit code; -1 when git could not be run or was stopped. */
  code: number
  stdout: string
  stderr: string
}

export interface RunGitOptions {
  /** Milliseconds before git is stopped; 0 for no limit. 30 seconds by default. */
  timeout?: number
  /** Largest output kept, in bytes. 16 MiB by default. */
  maxBuffer?: number
}

/** Runs git and reports how it ended, never throwing. */
export function runGit(
  git: string,
  args: readonly string[],
  env: Env,
  options: RunGitOptions = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      git,
      args,
      {
        env,
        encoding: 'utf8',
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          const reason = error.killed ? `git was stopped (${error.signal ?? 'timeout'}).` : ''
          resolve({ code: -1, stdout, stderr: [stderr, reason || error.message].join('\n').trim() })
          return
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr })
      },
    )
  })
}

/** What git says went wrong, or a fallback that names the exit code. */
export function gitErrorMessage(result: GitResult): string {
  return result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.code}.`
}

/** A worktree as `git worktree list --porcelain -z` describes it. */
export interface WorktreeEntry {
  path: string
  bare: boolean
  /** The commit checked out, or `null` for a bare repository or an unborn branch. */
  head: string | null
  /** The full name of the branch checked out, such as `refs/heads/main`; `null` when detached. */
  branch: string | null
  detached: boolean
  locked: boolean
  /** The reason given when the worktree was locked, if any. */
  lockReason: string | null
  prunable: boolean
}

/**
 * Parses `git worktree list --porcelain -z`. The main worktree comes first.
 * Git writes the paths with `/` also on Windows; there they are given with
 * `\`, as Node.js writes paths, so that they compare equal to Hoot's own.
 */
export function parseWorktreeList(
  output: string,
  platform: NodeJS.Platform = process.platform,
): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null
  for (const field of output.split('\0')) {
    if (field === '') {
      current = null
      continue
    }
    if (field.startsWith('worktree ')) {
      const written = field.slice('worktree '.length)
      current = {
        path: platform === 'win32' ? path.win32.normalize(written) : written,
        bare: false,
        head: null,
        branch: null,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
      }
      entries.push(current)
      continue
    }
    if (!current) continue
    const [label, ...rest] = field.split(' ')
    const value = rest.join(' ')
    switch (label) {
      case 'bare':
        current.bare = true
        break
      case 'HEAD':
        current.head = value
        break
      case 'branch':
        current.branch = value
        break
      case 'detached':
        current.detached = true
        break
      case 'locked':
        current.locked = true
        current.lockReason = value === '' ? null : value
        break
      case 'prunable':
        current.prunable = true
        break
    }
  }
  return entries
}

/** The name of a branch without `refs/heads/`. */
export function shortBranchName(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}
