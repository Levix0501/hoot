import type { SavedSessionInfo } from './chats'
import type { CodingToolId } from './tools'

/**
 * A worktree of a project: a linked worktree of the project's repository (its
 * outer member, whose directory is the worktree's root), together with the
 * linked worktrees of the project's inner repositories at the same relative
 * paths inside it (its inner members).
 */
export interface WorktreeInfo {
  /** The root directory, as Git records it. */
  path: string
  /** The branch the outer member has checked out, or `null` on a detached HEAD. */
  branch: string | null
  /** The branch, or on a detached HEAD the abbreviated commit. */
  displayName: string
  /**
   * The name the New Worktree dialog gave the worktree, which its row shows
   * instead of the branch; `null` for a worktree Hoot did not make that way.
   */
  name: string | null
  /**
   * When the worktree was created, in milliseconds since the Unix epoch: when
   * Hoot made it for a named worktree, otherwise its folder's creation time.
   * `0` when it cannot be told, as for a folder that is gone.
   */
  createdAt: number
  /** The root directory no longer exists. */
  missing: boolean
  /** The outer member is locked with `git worktree lock`. */
  locked: boolean
  /** The reason Git recorded for the lock, if any. */
  lockReason: string | null
  /** The relative paths of the inner members, sorted. */
  innerMembers: string[]
}

/** The order of worktrees in the sidebar: newest first, by creation time. */
export function compareWorktrees(a: WorktreeInfo, b: WorktreeInfo): number {
  return b.createdAt - a.createdAt || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

/** An inner repository as the new worktree dialog offers it. */
export interface NestedRepositoryOption {
  /** Its path relative to the project root. */
  relativePath: string
  /** Its local branches. */
  branches: string[]
  /** The branch checked out in its working directory, or `null` when detached. */
  current: string | null
  /** A repository without any commit is listed but cannot be included. */
  hasCommits: boolean
}

/**
 * The base branch an inner repository starts from until one is picked for it
 * by hand: its branch named like the project's base branch, otherwise the
 * branch checked out in it, otherwise none.
 */
export function defaultNestedBase(
  repository: Pick<NestedRepositoryOption, 'branches' | 'current'>,
  projectBase: string | null,
): string | null {
  if (projectBase !== null && repository.branches.includes(projectBase)) return projectBase
  return repository.current
}

/**
 * Whether a path is a directory or inside it, its folders separated by `/`
 * or, as on Windows, by `\`.
 */
export function isWithin(file: string, directory: string): boolean {
  if (file === directory) return true
  const below = /[\\/]$/.test(directory) ? [directory] : [`${directory}/`, `${directory}\\`]
  return below.some((start) => file.startsWith(start))
}

/** What the new worktree dialog of a project offers. */
export interface NewWorktreeOptions {
  /** The project repository's local branches. */
  branches: string[]
  /** The branch checked out in the main worktree, or `null` when detached. */
  current: string | null
  nested: NestedRepositoryOption[]
}

/** What the new worktree dialog offers, or why the project cannot have a new worktree. */
export type NewWorktreeOptionsResult =
  | { ok: true; options: NewWorktreeOptions }
  | { ok: false; message: string }

export interface CreateWorktreeRequest {
  projectRoot: string
  /** The name typed for the worktree; blank, or only spaces, for a random one. */
  name: string
  /** The agent to open a saved session with in the new worktree. */
  toolId: CodingToolId
  /** The local branch of the project repository to start from. */
  base: string
  /** The inner repositories to include, each with the local branch to start from. */
  nested: Array<{ relativePath: string; base: string }>
}

/** What creating the members of a worktree in their repositories came to. */
export type CreateWorktreeMembersResult =
  | {
      ok: true
      path: string
      /** Set when Git reported a problem (such as a failing hook) for a member it created. */
      warning: string | null
    }
  | {
      ok: false
      /**
       * `branch-exists`: a repository already has the branch, and nothing was
       * created. `failed`: Git could not create a member, and what was created
       * was undone.
       */
      reason: 'invalid' | 'branch-exists' | 'failed'
      message: string
    }

/** What the New Worktree dialog's create came to: the worktree, its branch and name, and its session. */
export type CreateWorktreeResult =
  | {
      ok: true
      path: string
      /** The branch of the new worktree. */
      branch: string
      /** The name of the new worktree: the one typed, or the random one when it was blank. */
      name: string
      /** The saved session opened in the new worktree. */
      session: SavedSessionInfo
      /** Set when Git reported a problem (such as a failing hook) for a member it created. */
      warning: string | null
    }
  | {
      ok: false
      /**
       * `branch-exists`: a repository already has the branch, and nothing was
       * created. `failed`: Git could not create a member, and what was created
       * was undone.
       */
      reason: 'invalid' | 'branch-exists' | 'failed'
      message: string
    }

/**
 * What creating a worktree for an issue came to: the worktree, on the branch
 * named after the issue, or why there is none.
 */
export type CreateIssueWorktreeResult =
  | {
      ok: true
      path: string
      branch: string
      /** Set when Git reported a problem (such as a failing hook) for a member it created. */
      warning: string | null
    }
  | {
      ok: false
      /**
       * `no-base`: the base branch of the project, or of an inner repository,
       * cannot be told, and nothing was created. `failed`: Git could not
       * create a member, and what was created was undone; the message has
       * Git's output. `invalid`: the request cannot be carried out, such as
       * for an issue that is no longer in the project.
       */
      reason: 'no-base' | 'failed' | 'invalid'
      message: string
    }

/** What a repository of a worktree would lose. */
export interface RepositoryChanges {
  /** The project name for the outer member, otherwise the path relative to the root. */
  repository: string
  /** The first few changed files. */
  files: string[]
  /** How many files changed. */
  total: number
  /** It is on a detached HEAD whose commit is in no branch. */
  detachedCommits: boolean
}

/**
 * The branch a member of a worktree has checked out, and whether it is merged
 * into the branch checked out in the project folder in the member's repository.
 */
export interface WorktreeBranch {
  /** The project name for the outer member, otherwise the path relative to the root. */
  repository: string
  /** The branch the member has checked out, or `null` when detached. */
  branch: string | null
  /**
   * The branch checked out in the repository's working directory in the
   * project folder, or `null` when its HEAD is on no branch.
   */
  current: string | null
  /** The member's branch points to `current`, or to a commit in its history. */
  merged: boolean
}

/** What deleting a worktree would delete, and what would be lost with it. */
export interface WorktreeInspection {
  root: string
  /** The directories of the inner members whose folders exist, which deleting deletes. */
  innerMembers: string[]
  /** The branch of the outer member, which is kept, or `null` when detached. */
  branch: string | null
  /** The branches of the outer member and of every inner member, in that order. */
  branches: WorktreeBranch[]
  /** The repositories that have uncommitted changes or detached commits. */
  changes: RepositoryChanges[]
  /** Repositories inside the root that are not part of the worktree, relative to the root. */
  foreignRepositories: string[]
}

export function inspectionIsClean(inspection: WorktreeInspection): boolean {
  return inspection.changes.length === 0 && inspection.foreignRepositories.length === 0
}

export type InspectWorktreeResult =
  | { ok: true; inspection: WorktreeInspection }
  | { ok: false; message: string }

export type DeleteWorktreeResult =
  | {
      ok: true
      /** Set when a merged branch that was to be deleted with the worktree could not be. */
      warning?: string
    }
  | {
      ok: false
      /** `changed`: changes appeared since the check; `inspection` says which. */
      reason: 'locked' | 'missing' | 'not-found' | 'changed' | 'failed'
      message: string
      inspection?: WorktreeInspection
    }

export type RemoveWorktreeResult = { ok: true } | { ok: false; message: string }

/**
 * What choosing an agent in a worktree's Merge menu came to: the saved
 * session in the project's own folder that merges the worktree, or why none
 * was made. `nothing-to-merge`: the worktree's branch is merged already in
 * every repository of it; `blocked`: something else stops the merge, which
 * the message says.
 */
export type StartMergeResult =
  | { ok: true; session: SavedSessionInfo }
  | { ok: false; reason: 'blocked' | 'nothing-to-merge'; message: string }
