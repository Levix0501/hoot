import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { issueBranchAttempt, issueBranchName } from '../../shared/issue-worktrees'
import type { Issue } from '../../shared/issues'
import {
  randomWorktreeName,
  worktreeBranchAttempt,
  worktreeBranchName,
} from '../../shared/worktree-names'
import {
  compareWorktrees,
  defaultNestedBase,
  inspectionIsClean,
  isWithin,
  type BranchToDelete,
  type CreateIssueWorktreeResult,
  type CreateWorktreeMembersResult,
  type CreateWorktreeRequest,
  type DeleteWorktreeResult,
  type InspectWorktreeResult,
  type NewWorktreeOptionsResult,
  type RemoveWorktreeResult,
  type WorktreeBranch,
  type WorktreeInfo,
  type WorktreeInspection,
} from '../../shared/worktrees'
import {
  gitErrorMessage,
  parseWorktreeList,
  runGit,
  shortBranchName,
  type GitResult,
  type WorktreeEntry,
} from '../git/git'
import { deleteContents } from './delete-contents'
import {
  changesBeforeMerge,
  InspectionError,
  inspectMembers,
  nestedBelow,
  type MemberToCheck,
} from './inspection'
import type { WorktreeLayout } from './layout'
import {
  checkedOutBranch,
  describeMergeFindings,
  hasUnfinishedMerge,
  isMergedInto,
  noFindings,
  nothingToMerge,
  type MergePlan,
} from './merge'
import {
  findInnerRepositories,
  forgetLinkedWorktree,
  git,
  hasBranch,
  locateRepository,
  readBranches,
  submodulesAt,
  type GitContext,
  type InnerRepository,
} from './repositories'
import type { WorktreeStore } from './worktree-store'

/** Creating or removing a worktree runs hooks and touches many files: no short limit. */
const WORKTREE_COMMAND_TIMEOUT = 10 * 60_000

/** How many names an issue's branch is tried with before Hoot gives up: its name, then `-2` on. */
const ISSUE_BRANCH_ATTEMPTS = 1_000

/** What the start button says to do instead when it cannot tell a base branch. */
const PICK_BASE_IN_DIALOG =
  "Open the New Worktree dialog with the project's + button instead, and pick the base branches under Advanced."

/** How many branch names a new worktree is tried with before Hoot gives up: its name, then `-2` on. */
const WORKTREE_BRANCH_ATTEMPTS = 1_000

/** What creating a worktree with a name came to, before a session is opened in it. */
export type CreateNamedWorktreeResult =
  | {
      ok: true
      path: string
      branch: string
      name: string
      /** Set when Git reported a problem (such as a failing hook) for a member it created. */
      warning: string | null
    }
  | { ok: false; reason: 'invalid' | 'failed'; message: string }

/** What a worktree Hoot created to start with, before it is given a name. */
interface WorktreeCreation {
  projectRoot: string
  /** The branch to create, which no repository taking part has. */
  branch: string
  base: string
  nested: Array<{ relativePath: string; base: string }>
}

/**
 * What else Hoot keeps of the worktrees, besides their records: what tells
 * which of the worktrees that are gone are cleaned up, and when.
 */
export interface WorktreeKeeping {
  /** The roots of a project's worktrees that saved sessions belong to. */
  savedSessionPaths(projectRoot: string): string[]
  /** The roots of the worktrees collapsed in the sidebar, of every project. */
  collapsedPaths(): string[]
  /**
   * Whether a session of a project's worktree is open: starting, running, or
   * ended while its tab stays.
   */
  hasOpenSessions(projectRoot: string, worktreePath: string): boolean
}

export interface WorktreeServiceOptions {
  layout: WorktreeLayout
  /** The names and creation times of the worktrees Hoot made with the dialog. */
  records: WorktreeStore
  /** How to run git, resolved for each operation. */
  gitContext(): Promise<GitContext>
  /** The time to record, in milliseconds since the Unix epoch. */
  now?: () => number
  /** Without it, nothing but the records is known of the worktrees, and no session is open. */
  keeping?: WorktreeKeeping
  /**
   * Deletes what is in a folder but its `.git` file, as `deleteContents`
   * does, which runs in the main process when this is not given.
   */
  deleteContents?: (folder: string) => Promise<string | null>
}

interface ProjectState {
  root: string
  name: string
  /** The inner repositories found by the last search, once there was one. */
  inner: InnerRepository[] | null
  discovering: Promise<void> | null
  /** The worktrees as they were last read. */
  worktrees: WorktreeInfo[]
  /** Whether `changed` has reported them, as it does once they are first read. */
  reported: boolean
  refreshing: Promise<void> | null
  refreshAgain: boolean
  /** Settles once the worktrees have been read for the first time. */
  ready: Promise<void>
  removed: boolean
  /**
   * The roots of the worktrees that were gone when they were last read, but
   * stay until their open sessions close.
   */
  held: Set<string>
  /** The roots of the worktrees Hoot is deleting or removing, which are not cleaned up meanwhile. */
  busy: Set<string>
}

/** The project's worktrees as Git lists them, and where they are. */
interface ProjectEntries {
  entries: WorktreeEntry[]
  /**
   * The real paths, as far as they exist, of the project folder and of every
   * other folder that belongs to the project.
   */
  folders: string[]
  /**
   * The project folder is a symbolic link that leads nowhere now, as when the
   * disk it was moved to is not connected: the worktrees in it are missing,
   * and none of the project's worktrees is cleaned up.
   */
  unreachable: boolean
  /**
   * The real paths, as far as they exist, of the links among the project
   * folders that lead nowhere, and of where they lead.
   */
  dangling: string[]
}

/** The project's worktrees as they were read, and where they are. */
interface ProjectWorktrees extends Omit<ProjectEntries, 'entries'> {
  worktrees: WorktreeInfo[]
}

/** A member of a worktree in its repository. */
interface Member {
  /** The repository's working directory in the project. */
  repository: string
  /** The member's directory. */
  path: string
  /** Relative to the worktree root; empty for the outer member. */
  relativePath: string
  label: string
}

/** A member of a worktree with the branch it has checked out, `null` when detached. */
interface MemberBranch extends Member {
  branch: string | null
}

/**
 * What the checks before merging a worktree came to: what the merge session
 * is to merge, or why there is no merge to make. `nothing-to-merge`: the
 * worktree's branches are merged already; `blocked`: something stops the
 * merge, which the message says.
 */
export type MergePlanResult =
  | { ok: true; plan: MergePlan }
  | { ok: false; reason: 'blocked' | 'nothing-to-merge'; message: string }

/** What the checks before a merge come to when something stops it. */
function blocked(message: string): MergePlanResult {
  return { ok: false, reason: 'blocked', message }
}

/** Deeper relative paths first, as worktree members are deleted. */
export function deepestFirst<T extends { relativePath: string }>(members: readonly T[]): T[] {
  const depth = (member: T) => member.relativePath.split('/').length
  return members.toSorted((a, b) => depth(b) - depth(a))
}

async function isDirectory(directory: string): Promise<boolean> {
  return (await fs.promises.stat(directory).catch(() => null))?.isDirectory() ?? false
}

/**
 * Whether nothing is at a path, as the system says; not when it cannot tell,
 * as for a folder it may not read.
 */
async function absent(file: string): Promise<boolean> {
  try {
    await fs.promises.lstat(file)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}

/** When a folder was created, in milliseconds since the Unix epoch; `0` when it cannot be told. */
async function folderCreatedAt(directory: string): Promise<number> {
  const stats = await fs.promises.stat(directory).catch(() => null)
  return stats?.birthtimeMs ?? 0
}

/** The real path of a file that may not exist: its nearest existing ancestor's, with the rest. */
async function realPath(file: string): Promise<string> {
  try {
    return await fs.promises.realpath(file)
  } catch {
    const parent = path.dirname(file)
    return parent === file ? file : path.join(await realPath(parent), path.basename(file))
  }
}

function sameWorktrees(a: readonly WorktreeInfo[], b: readonly WorktreeInfo[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Lists, creates and deletes the worktrees of the projects in the list. A
 * project's worktrees are the linked worktrees of its repository directly in
 * its project folder, where Hoot creates them, or in another folder that
 * belongs to the project; they are told apart by where they are, so that
 * the worktrees made by any Hoot are listed. Nothing is watched: the
 * worktrees are read from Git when a project is added, when `refreshAll` is
 * called (as the window gets the focus), after Hoot creates or deletes one,
 * before a session starts in one or one is deleted or removed, and once the
 * last open session of one that is gone closes.
 * Inner repositories are looked for when a project is added, when the new
 * worktree dialog opens, and before a worktree is checked, deleted or
 * removed. `changed` reports a project's worktrees once they are first
 * read, also when there are none, and then whenever they change; while Git
 * cannot list them, they stay as they were.
 *
 * Each time they are read, the worktrees that are gone are cleaned up,
 * without asking: one Git lists whose folder is gone, and one Git no longer
 * lists that Hoot still keeps something of (its record, saved sessions or
 * collapsed state). Their registrations in Git go, and so does their record,
 * while their folders, where they are left, and their branches stay;
 * `removed` reports them, for what else Hoot keeps of them to go too, before
 * `changed` reports the worktrees without them. A worktree is kept, as
 * missing, while any of its sessions is open, and while it is locked; none
 * of a project's goes while its project folder is a link that leads nowhere.
 */
export class WorktreeService extends EventEmitter<{
  changed: [projectRoot: string, worktrees: WorktreeInfo[]]
  removed: [projectRoot: string, worktreePaths: string[]]
}> {
  private readonly projects = new Map<string, ProjectState>()
  /** The worktrees being deleted, by root, with the names their rows show. */
  private readonly deleting = new Map<string, string>()

  constructor(private readonly options: WorktreeServiceOptions) {
    super()
  }

  /** Follows the project list: starts on new projects and stops on removed ones. */
  setProjects(roots: readonly string[]): void {
    const wanted = new Set(roots)
    for (const root of this.projects.keys()) if (!wanted.has(root)) this.removeProject(root)
    for (const root of roots) this.addProject(root)
  }

  addProject(root: string): void {
    if (this.projects.has(root)) return
    const state: ProjectState = {
      root,
      name: path.basename(root) || root,
      inner: null,
      discovering: null,
      worktrees: [],
      reported: false,
      refreshing: null,
      refreshAgain: false,
      ready: Promise.resolve(),
      removed: false,
      held: new Set(),
      busy: new Set(),
    }
    this.projects.set(root, state)
    state.ready = this.refresh(state)
    void state.ready.then(() => this.discover(state))
  }

  removeProject(root: string): void {
    const state = this.projects.get(root)
    if (!state) return
    state.removed = true
    this.projects.delete(root)
  }

  /** Forgets every project, as Hoot quits. */
  dispose(): void {
    // Deleting the entry being visited does not disturb the iteration.
    for (const root of this.projects.keys()) this.removeProject(root)
  }

  /** Every project's worktrees, once they have been read. */
  async listAll(): Promise<Record<string, WorktreeInfo[]>> {
    const states = [...this.projects.values()]
    await Promise.all(states.map((state) => state.ready))
    return Object.fromEntries(states.map((state) => [state.root, state.worktrees]))
  }

  /**
   * Reads every project's worktrees again, as when the window gets the focus,
   * with the inner repositories of the last search: what changed outside
   * Hoot, such as a worktree whose directory was deleted, shows then.
   */
  refreshAll(): void {
    for (const state of this.projects.values()) void this.refresh(state)
  }

  /**
   * Cleans up a worktree that was gone once the last of its open sessions has
   * closed, without waiting for the worktrees to be read again for anything
   * else.
   */
  sessionClosed(projectRoot: string, worktreePath: string): void {
    const state = this.projects.get(projectRoot)
    // A read under way may have found the session still open.
    if (state && (state.held.has(worktreePath) || state.refreshing)) void this.refresh(state)
  }

  /**
   * Reads the project's worktrees again, which `changed` then reports, and
   * returns the worktree at a root as it is now, or `null` when there is no
   * such worktree: before a session starts in it, or before it is deleted or
   * removed, which may no longer be possible.
   */
  async currentWorktree(projectRoot: string, worktreePath: string): Promise<WorktreeInfo | null> {
    const state = this.projects.get(projectRoot)
    if (!state) return null
    await this.refresh(state)
    return state.worktrees.find((worktree) => worktree.path === worktreePath) ?? null
  }

  /**
   * Reads the project's worktrees again, which `changed` then reports, and
   * returns them; `null` when the project is not in the list.
   */
  async read(projectRoot: string): Promise<WorktreeInfo[] | null> {
    const state = this.projects.get(projectRoot)
    if (!state) return null
    await this.refresh(state)
    return state.worktrees
  }

  /**
   * Whether a directory is the root of one of the project's worktrees that
   * exists, as Git lists them now, without showing what changed.
   */
  async isWorktreeOf(projectRoot: string, directory: string): Promise<boolean> {
    const state = this.projects.get(projectRoot)
    if (!state) return false
    const context = await this.options.gitContext()
    const read = await this.readEntries(context, state)
    const entry = read?.entries.find((candidate) => candidate.path === directory)
    return entry !== undefined && (await isDirectory(directory))
  }

  /**
   * What the new worktree dialog offers, after looking for inner repositories
   * again; or why it offers nothing, as for a project that is not a Git
   * repository.
   */
  async newWorktreeOptions(projectRoot: string): Promise<NewWorktreeOptionsResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return { ok: false, message: 'This project is no longer in the list.' }
    const context = await this.options.gitContext()
    if (!(await locateRepository(context, projectRoot))) {
      return {
        ok: false,
        message: 'This project is not a Git repository, so it cannot have worktrees.',
      }
    }
    await this.discover(state)
    const [project, nested] = await Promise.all([
      readBranches(context, projectRoot),
      Promise.all(
        (state.inner ?? []).map(async (repository) => ({
          relativePath: repository.relativePath,
          ...(await readBranches(context, repository.path)),
        })),
      ),
    ])
    return { ok: true, options: { branches: project.branches, current: project.current, nested } }
  }

  /** Whether Git accepts a name as a new branch's name. */
  async isValidBranchName(name: string): Promise<boolean> {
    if (name === '') return false
    const context = await this.options.gitContext()
    // Outside any repository, so that `@{-1}` and the like do not refer to a branch.
    const result = await runGit(
      context.git,
      ['-C', '/', 'check-ref-format', '--branch', name],
      context.env,
    )
    return result.code === 0 && result.stdout.trim() === name
  }

  /** Where a new worktree of the branch would be created, without creating anything. */
  async previewPath(
    projectRoot: string,
    branch: string,
  ): Promise<{ path: string; displayPath: string } | null> {
    if (!this.projects.has(projectRoot) || branch === '') return null
    const { layout } = this.options
    const { folder } = await layout.projectFolder(projectRoot, { create: false })
    const root = await layout.worktreeRoot(folder, branch)
    return { path: root, displayPath: layout.displayPath(root) }
  }

  /**
   * The submodules in the base branches' commits of the repositories that
   * would take part, relative to the project root.
   */
  async submodules(
    projectRoot: string,
    participants: ReadonlyArray<{ relativePath: string; base: string }>,
  ): Promise<string[]> {
    const state = this.projects.get(projectRoot)
    if (!state) return []
    const context = await this.options.gitContext()
    const lists = await Promise.all(
      participants.map(async ({ relativePath, base }) => {
        const repository =
          relativePath === ''
            ? projectRoot
            : state.inner?.find((candidate) => candidate.relativePath === relativePath)?.path
        if (!repository || !(await hasBranch(context, repository, base))) return []
        const paths = await submodulesAt(context, repository, `refs/heads/${base}`)
        return paths.map((entry) => (relativePath === '' ? entry : `${relativePath}/${entry}`))
      }),
    )
    return lists.flat().toSorted()
  }

  /**
   * Creates a worktree with the name the user typed: the branch comes from
   * the name with slugify, or is a random name when the name is blank or
   * cannot become one, with `-2`, `-3` and on while any repository taking
   * part has the branch. A blank name is also the worktree's random name.
   * Hoot records the worktree's name and when it made it, which its row shows.
   */
  async createNamed(request: CreateWorktreeRequest): Promise<CreateNamedWorktreeResult> {
    const state = this.projects.get(request.projectRoot)
    if (!state) return { ok: false, reason: 'invalid', message: 'The project is not in the list.' }
    await this.discover(state)
    const context = await this.options.gitContext()
    const typed = request.name.trim()
    const name = typed === '' ? randomWorktreeName() : typed
    const base = worktreeBranchName(name) ?? randomWorktreeName()
    const participants = [state.root]
    for (const entry of request.nested) {
      const inner = state.inner?.find((candidate) => candidate.relativePath === entry.relativePath)
      if (inner) participants.push(inner.path)
    }
    let branch: string | null = null
    for (let attempt = 1; attempt <= WORKTREE_BRANCH_ATTEMPTS; attempt++) {
      const candidate = worktreeBranchAttempt(base, attempt)
      let taken = false
      for (const repository of participants) {
        if (await hasBranch(context, repository, candidate)) {
          taken = true
          break
        }
      }
      if (!taken) {
        branch = candidate
        break
      }
    }
    if (branch === null) {
      return {
        ok: false,
        reason: 'invalid',
        message: `Branches named ${base} with every suffix up to -${WORKTREE_BRANCH_ATTEMPTS} exist already.`,
      }
    }
    const result = await this.create({
      projectRoot: request.projectRoot,
      branch,
      base: request.base,
      nested: request.nested,
    })
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === 'failed' ? 'failed' : 'invalid',
        message: result.message,
      }
    }
    const at = (this.options.now ?? Date.now)()
    this.options.records.record(state.root, result.path, name, at)
    // Read them again, so that the row shows its name and its place.
    await this.refresh(state)
    return { ok: true, path: result.path, branch, name, warning: result.warning }
  }

  /**
   * Creates a worktree: a new branch in the project repository and in each
   * included inner repository, from each one's base branch, checked out in
   * linked worktrees at the root and at the inner repositories' relative paths
   * inside it. When a member cannot be created, the members and branches
   * created so far are removed again.
   */
  async create(request: WorktreeCreation): Promise<CreateWorktreeMembersResult> {
    const state = this.projects.get(request.projectRoot)
    if (!state) return { ok: false, reason: 'invalid', message: 'The project is not in the list.' }
    if (!(await this.isValidBranchName(request.branch))) {
      return { ok: false, reason: 'invalid', message: 'The name is not a valid branch name.' }
    }
    const context = await this.options.gitContext()
    if (request.nested.length > 0 && state.inner === null) await this.discover(state)

    const repositories: Array<{ repository: string; relativePath: string; base: string }> = [
      { repository: state.root, relativePath: '', base: request.base },
    ]
    const included = new Set<string>()
    for (const entry of request.nested) {
      const inner = state.inner?.find((candidate) => candidate.relativePath === entry.relativePath)
      if (!inner || included.has(entry.relativePath)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `${entry.relativePath} is not an inner repository of ${state.name}.`,
        }
      }
      included.add(entry.relativePath)
      repositories.push({
        repository: inner.path,
        relativePath: inner.relativePath,
        base: entry.base,
      })
    }
    // Parents before the repositories inside them.
    repositories.sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))
    const label = (relativePath: string) => (relativePath === '' ? state.name : relativePath)

    for (const { repository, relativePath, base } of repositories) {
      if (!(await hasBranch(context, repository, base))) {
        return {
          ok: false,
          reason: 'invalid',
          message: `${label(relativePath)} has no local branch named ${base}.`,
        }
      }
    }
    const existing: string[] = []
    for (const { repository, relativePath } of repositories) {
      if (await hasBranch(context, repository, request.branch)) existing.push(label(relativePath))
    }
    if (existing.length > 0) {
      return {
        ok: false,
        reason: 'branch-exists',
        message: `A branch named ${request.branch} already exists in ${existing.join(', ')}.`,
      }
    }

    const { layout } = this.options
    let projectFolder: { folder: string; created: boolean }
    let root: string
    try {
      projectFolder = await layout.projectFolder(state.root, { create: true })
      // Git registers a worktree by its real path, which a symbolic link on the
      // way (to move ~/.hoot to another disk, say) changes: the root is the real
      // path too, so that the members can be found among the registrations.
      const folder = await fs.promises.realpath(projectFolder.folder)
      root = await layout.worktreeRoot(folder, request.branch)
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        message: `Could not create the folder for the worktree: ${(error as Error).message}`,
      }
    }

    const created: Member[] = []
    const branched: Member[] = []
    const warnings: string[] = []
    for (const { repository, relativePath, base } of repositories) {
      const member: Member = {
        repository,
        path: relativePath === '' ? root : path.join(root, relativePath),
        relativePath,
        label: label(relativePath),
      }
      // A registration already at the path, of a worktree whose folder is
      // missing, is another worktree's: Git refuses to replace it, and it stays.
      const registeredBefore =
        (await this.registeredPaths(context, repository))?.includes(member.path) ?? false
      const result = await runGit(
        context.git,
        [
          '-C',
          repository,
          'worktree',
          'add',
          '-q',
          '-b',
          request.branch,
          member.path,
          `refs/heads/${base}`,
        ],
        context.env,
        { timeout: WORKTREE_COMMAND_TIMEOUT },
      )
      const registered =
        !registeredBefore &&
        ((await this.registeredPaths(context, repository))?.includes(member.path) ?? false)
      if (registered && (await isDirectory(member.path))) {
        created.push(member)
        branched.push(member)
        // Created, but Git reported a problem, such as a failing post-checkout hook.
        if (result.code !== 0) warnings.push(describeOutput(member.label, result))
        continue
      }
      // Whatever the failed attempt left, a registration or the branch, is undone too.
      if (registered) created.push(member)
      if (await hasBranch(context, repository, request.branch)) branched.push(member)
      const undone = await this.undo(context, created, branched, request.branch)
      if (projectFolder.created) await layout.removeIfEmpty(projectFolder.folder)
      await this.refresh(state)
      return {
        ok: false,
        reason: 'failed',
        message: [gitErrorMessage(result), ...undone].join('\n\n'),
      }
    }
    await this.refresh(state)
    return { ok: true, path: root, warning: warnings.length > 0 ? warnings.join('\n\n') : null }
  }

  /**
   * Creates the worktree of an issue, without asking anything: a new branch
   * named after the issue, from the branch checked out in the main worktree,
   * with the inner repositories the new worktree dialog includes by default
   * (those with commits, each from its branch named like the project's base
   * branch, or else from the branch it has checked out). While a repository
   * that takes part has a branch of the name, the name gets `-2`, `-3` and
   * on. Nothing is created when a base branch cannot be told: the main
   * worktree's HEAD is detached, or an inner repository has neither.
   */
  async createForIssue(
    projectRoot: string,
    issue: Pick<Issue, 'id' | 'title'>,
  ): Promise<CreateIssueWorktreeResult> {
    const offered = await this.newWorktreeOptions(projectRoot)
    // The project is no longer in the list, or not a Git repository.
    if (!offered.ok) return { ok: false, reason: 'invalid', message: offered.message }
    const { options } = offered
    const name = path.basename(projectRoot) || projectRoot
    const base = options.current
    if (base === null) {
      // A branch is checked out that has no commit yet, or none is.
      const unborn = await git(await this.options.gitContext(), [
        '-C',
        projectRoot,
        'symbolic-ref',
        '-q',
        'HEAD',
      ])
      return {
        ok: false,
        reason: 'no-base',
        message:
          unborn.code === 0
            ? `The branch checked out in the main worktree of ${name} has no commits yet, so there is nothing to start the issue's branch from.`
            : `The main worktree of ${name} has no branch checked out (its HEAD is detached), so Hoot cannot tell which branch to start the issue's branch from. ${PICK_BASE_IN_DIALOG}`,
      }
    }
    const nested: CreateWorktreeRequest['nested'] = []
    const undecided: string[] = []
    for (const repository of options.nested) {
      if (!repository.hasCommits) continue
      const nestedBase = defaultNestedBase(repository, base)
      if (nestedBase === null) undecided.push(repository.relativePath)
      else nested.push({ relativePath: repository.relativePath, base: nestedBase })
    }
    if (undecided.length > 0) {
      const which =
        undecided.length === 1
          ? `${undecided[0]} from: it has`
          : `${undecided.join(', ')} from: they have`
      return {
        ok: false,
        reason: 'no-base',
        message: `Hoot cannot tell which branch to start ${which} no branch named ${base}, and no branch checked out. ${PICK_BASE_IN_DIALOG}`,
      }
    }
    const branchName = issueBranchName(issue.id, issue.title)
    for (let attempt = 1; attempt <= ISSUE_BRANCH_ATTEMPTS; attempt++) {
      const branch = issueBranchAttempt(branchName, attempt)
      const result = await this.create({ projectRoot, branch, base, nested })
      if (result.ok) return { ok: true, path: result.path, branch, warning: result.warning }
      // Nothing was created: try the next name.
      if (result.reason === 'branch-exists') continue
      return { ok: false, reason: result.reason, message: result.message }
    }
    return {
      ok: false,
      reason: 'invalid',
      message: `Branches named ${branchName} with every suffix up to -${ISSUE_BRANCH_ATTEMPTS} exist already.`,
    }
  }

  /** Checks what deleting a worktree would delete and lose. */
  async inspect(projectRoot: string, worktreePath: string): Promise<InspectWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return { ok: false, message: 'The project is not in the list.' }
    // Its inner members are the worktrees of the inner repositories there are
    // now, which may not have been looked for yet: right after Hoot starts, say,
    // or since one was made.
    await this.discover(state)
    const context = await this.options.gitContext()
    const entry = (await this.readEntries(context, state))?.entries.find(
      (candidate) => candidate.path === worktreePath,
    )
    if (!entry) return { ok: false, message: 'The worktree no longer exists.' }
    try {
      return { ok: true, inspection: await this.inspectEntry(context, state, entry) }
    } catch (error) {
      if (error instanceof InspectionError) return { ok: false, message: error.message }
      throw error
    }
  }

  /**
   * Checks whether a worktree can be merged into the project folder now, and
   * what a merge session is to merge then: the worktree's branch in each of
   * its repositories, into the branch checked out there in the project
   * folder. Nothing is to be merged when the project folder is gone, Git no
   * longer lists the worktree or its folder is gone; when a repository in the
   * project folder, the project repository or any inner repository (also one
   * the worktree has no member of), is on no branch, has uncommitted changes,
   * or has a merge or rebase under way; when a member of the worktree has
   * uncommitted changes or is on no branch; while sessions run in it, as
   * `runningSessions` counts them once the rest is checked; or while it is
   * locked. Nor, with nothing else in the way, when the worktree's branch is
   * merged already in every repository of it.
   */
  async planMerge(
    projectRoot: string,
    worktreePath: string,
    runningSessions: () => number,
  ): Promise<MergePlanResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return blocked('The project is not in the list.')
    if (!(await isDirectory(state.root))) {
      return blocked(`The project folder is missing: ${state.root}`)
    }
    // The inner repositories there are now, every one of which is checked.
    await this.discover(state)
    // As Git lists it now, which the sidebar then shows.
    const worktree = await this.currentWorktree(projectRoot, worktreePath)
    if (!worktree || worktree.missing) {
      // One whose folder is gone may have been cleaned up as it was read.
      return blocked(
        worktree?.missing || (await absent(worktreePath))
          ? `The folder of the worktree is missing: ${worktreePath}`
          : `The worktree no longer exists: ${worktreePath}`,
      )
    }
    const context = await this.options.gitContext()
    const findings = noFindings()
    const inner = state.inner ?? []
    const innerPaths = inner.map((repository) => repository.relativePath)
    const repositories: MemberToCheck[] = [
      { label: state.name, path: state.root, relativePath: '' },
      ...inner.map((repository) => ({
        label: repository.relativePath,
        path: repository.path,
        relativePath: repository.relativePath,
      })),
    ]
    try {
      const current = new Map<string, string | null>()
      for (const repository of repositories) {
        const branch = await checkedOutBranch(context, repository.path)
        current.set(repository.path, branch)
        if (branch === null) findings.detachedInFolder.push(repository.label)
        const nested = nestedBelow(repository.relativePath, innerPaths)
        if ((await changesBeforeMerge(context, repository, nested)).length > 0) {
          findings.changedInFolder.push(repository.label)
        }
        if (await hasUnfinishedMerge(context, repository.path)) {
          findings.unfinishedInFolder.push(repository.label)
        }
      }
      const members = await this.memberBranches(context, state, worktree.path, worktree.branch)
      const memberPaths = members
        .map((member) => member.relativePath)
        .filter((relativePath) => relativePath !== '')
      for (const member of members) {
        // An inner member whose folder is gone has nothing left uncommitted.
        if (await isDirectory(member.path)) {
          const nested = nestedBelow(member.relativePath, memberPaths)
          if ((await changesBeforeMerge(context, member, nested)).length > 0) {
            findings.changedInWorktree.push(member.label)
          }
        }
        if (member.branch === null) findings.detachedInWorktree.push(member.label)
      }
      findings.runningSessions = runningSessions()
      findings.locked = worktree.locked ? { reason: worktree.lockReason } : null
      const problems = describeMergeFindings(findings)
      if (problems.length > 0) return blocked(problems.join(' '))

      // With nothing in the way, every member and repository is on a branch.
      const plan: MergePlan = {
        worktreeName: worktree.name ?? worktree.displayName,
        worktreePath: worktree.path,
        projectFolder: state.root,
        repositories: members.map((member) => ({
          label: member.label,
          path: member.repository,
          branch: member.branch!,
          into: current.get(member.repository)!,
        })),
      }
      for (const repository of plan.repositories) {
        if (!(await isMergedInto(context, repository.path, repository.branch, repository.into))) {
          return { ok: true, plan }
        }
      }
      return {
        ok: false,
        reason: 'nothing-to-merge',
        message: nothingToMerge(
          plan.worktreeName,
          plan.repositories.map((repository) => repository.into),
        ),
      }
    } catch (error) {
      if (error instanceof InspectionError) return blocked(error.message)
      throw error
    }
  }

  /**
   * Deletes a worktree: its inner members, deeper ones first, then its outer
   * member, with everything in its root, and then the registrations of other
   * linked worktrees that were inside the root. Of each member, what is in
   * its folder goes first, and then Git deletes its `.git` file, its folder
   * and its registration: a deletion that stops partway, as when a file is in
   * use, leaves a worktree that can be deleted again. Branches are kept,
   * except those of `deleteBranches`, which the confirmation said would be
   * deleted: once the worktree is deleted, each of them that its member had
   * checked out and that is merged, as it is then, into the branch checked
   * out in the project folder in its repository is deleted too, and the
   * others are kept. Unless `discard` is set, a worktree with anything to
   * lose is not deleted. Once nothing stops the deletion, `endSessions` ends
   * the sessions running in the worktree, and what they change until they end
   * is deleted with it.
   */
  async delete(
    projectRoot: string,
    worktreePath: string,
    discard: boolean,
    endSessions: () => Promise<void> = async () => {},
    deleteBranches: readonly BranchToDelete[] = [],
  ): Promise<DeleteWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state)
      return { ok: false, reason: 'not-found', message: 'The project is not in the list.' }
    // Not cleaned up meanwhile, as when its folder is gone before its
    // registration while Git deletes it.
    state.busy.add(worktreePath)
    const shown = state.worktrees.find((worktree) => worktree.path === worktreePath)
    this.deleting.set(
      worktreePath,
      shown?.name ?? shown?.displayName ?? path.basename(worktreePath),
    )
    try {
      return await this.deleteMembers(state, worktreePath, discard, endSessions, deleteBranches)
    } finally {
      state.busy.delete(worktreePath)
      this.deleting.delete(worktreePath)
    }
  }

  /** The names of the worktrees being deleted, as their rows show them. */
  deletionsUnderWay(): string[] {
    return [...this.deleting.values()]
  }

  private async deleteMembers(
    state: ProjectState,
    worktreePath: string,
    discard: boolean,
    endSessions: () => Promise<void>,
    deleteBranches: readonly BranchToDelete[],
  ): Promise<DeleteWorktreeResult> {
    // Its inner members are found as when checking it.
    await this.discover(state)
    const context = await this.options.gitContext()
    const entry = (await this.readEntries(context, state))?.entries.find(
      (candidate) => candidate.path === worktreePath,
    )
    if (!entry) return { ok: false, reason: 'not-found', message: 'The worktree no longer exists.' }
    if (entry.locked) {
      return { ok: false, reason: 'locked', message: 'The worktree is locked.' }
    }
    if (!(await isDirectory(entry.path))) {
      return { ok: false, reason: 'missing', message: 'The folder of the worktree is missing.' }
    }
    // Without leave to discard anything, check again: something may have changed
    // since the user was asked.
    if (!discard) {
      let inspection: WorktreeInspection
      try {
        inspection = await this.inspectEntry(context, state, entry)
      } catch (error) {
        if (error instanceof InspectionError) {
          return { ok: false, reason: 'failed', message: error.message }
        }
        throw error
      }
      if (!inspectionIsClean(inspection)) {
        return {
          ok: false,
          reason: 'changed',
          message: 'The worktree has changes that would be lost.',
          inspection,
        }
      }
    }
    // Also a session that started while the worktree was checked.
    await endSessions()
    // The members' branches as they are once nothing changes them any more,
    // which can only be deleted once the worktree is: of those the
    // confirmation named, the ones the members still have checked out.
    const branched =
      deleteBranches.length > 0
        ? (await this.memberBranches(context, state, entry.path, branchOf(entry))).filter(
            (member) =>
              deleteBranches.some(
                (named) =>
                  named.relativePath === member.relativePath && named.branch === member.branch,
              ),
          )
        : []
    const members = await this.membersOf(context, state, entry.path)
    for (const member of [...deepestFirst(members.inner), members.outer]) {
      const problem = await (this.options.deleteContents ?? deleteContents)(member.path)
      if (problem !== null) {
        await this.refresh(state)
        return {
          ok: false,
          reason: 'failed',
          message: `Could not delete ${member.path}: ${problem}`,
        }
      }
      // Only the outer member's lock, checked above, makes the worktree
      // locked: forcing twice removes an inner member that is locked too.
      const force = member.relativePath === '' ? ['--force'] : ['--force', '--force']
      const result = await runGit(
        context.git,
        ['-C', member.repository, 'worktree', 'remove', ...force, member.path],
        context.env,
        { timeout: WORKTREE_COMMAND_TIMEOUT },
      )
      if (result.code !== 0) {
        await this.refresh(state)
        return {
          ok: false,
          reason: 'failed',
          message: `Could not delete ${member.path}: ${gitErrorMessage(result)}`,
        }
      }
    }
    await this.clearRegistrationsWithin(context, state, entry.path)
    this.options.records.remove(entry.path)
    const problems = await this.deleteMergedBranches(context, branched)
    await this.refresh(state)
    return problems.length > 0 ? { ok: true, warning: problems.join('\n\n') } : { ok: true }
  }

  /**
   * Deletes the branches of these members of a worktree just deleted that
   * are merged now into the branch checked out in the project folder in
   * their repository; the others stay. Returns why any could not be deleted.
   */
  private async deleteMergedBranches(
    context: GitContext,
    members: readonly MemberBranch[],
  ): Promise<string[]> {
    const problems: string[] = []
    for (const member of members) {
      if (member.branch === null) continue
      const current = await checkedOutBranch(context, member.repository)
      if (current === null) continue
      if (!(await isMergedInto(context, member.repository, member.branch, current))) continue
      // Forced, as it was just found merged into the branch checked out:
      // without, Git would compare it with its upstream instead, if it has one.
      const result = await git(context, ['-C', member.repository, 'branch', '-D', member.branch])
      if (result.code !== 0) {
        problems.push(
          `Could not delete the branch ${member.branch} in ${member.label}: ${gitErrorMessage(result)}`,
        )
      }
    }
    return problems
  }

  /**
   * Removes a worktree whose folder is missing, or that Git no longer lists
   * while Hoot keeps something of it: its registrations in the project
   * repository and the inner repositories go, keeping every branch, and so
   * does its record. A lock does not stop it: the user asks for the
   * registrations to go. Nothing is deleted or changed in a folder that is
   * there, as for a worktree only the registration of which in the project
   * repository was deleted. The worktrees are read again first: nothing is
   * removed unless the worktree is still missing or no longer listed, and a
   * worktree that is gone already, as when it was cleaned up as its last
   * session closed, needs nothing more. Before anything is removed,
   * `closeSessions` closes the worktree's open sessions.
   */
  async removeMissing(
    projectRoot: string,
    worktreePath: string,
    closeSessions: () => Promise<void> = async () => {},
  ): Promise<RemoveWorktreeResult> {
    const state = this.projects.get(projectRoot)
    if (!state) return { ok: false, message: 'The project is not in the list.' }
    // Not cleaned up meanwhile, by a read of the worktrees.
    state.busy.add(worktreePath)
    try {
      const worktree = await this.currentWorktree(projectRoot, worktreePath)
      if (worktree?.missing === false) {
        return {
          ok: false,
          message: 'The folder of the worktree exists; delete the worktree instead.',
        }
      }
      if (worktree === null && !this.keepsAnything(state, worktreePath)) {
        // Gone already; or never one of the project's worktrees, as another
        // linked worktree of its repository, which is left as it is.
        const registered = await this.registeredPaths(await this.options.gitContext(), state.root)
        if (registered === null) {
          return { ok: false, message: `Could not list the worktrees of ${state.name}.` }
        }
        return registered.includes(worktreePath)
          ? { ok: false, message: 'The worktree no longer exists.' }
          : { ok: true }
      }
      await closeSessions()
      // Its inner members are found as when checking a worktree.
      await this.discover(state)
      const problem = await this.unregister(await this.options.gitContext(), state, worktreePath)
      if (problem !== null) return { ok: false, message: problem }
      this.options.records.remove(worktreePath)
      return { ok: true }
    } finally {
      await this.refresh(state)
      state.busy.delete(worktreePath)
    }
  }

  /** Whether Hoot keeps anything of a worktree of the project: its record, saved sessions or open sessions. */
  private keepsAnything(state: ProjectState, worktreePath: string): boolean {
    const { records, keeping } = this.options
    return (
      records.forProject(state.root).has(worktreePath) ||
      (keeping?.savedSessionPaths(state.root).includes(worktreePath) ?? false) ||
      (keeping?.hasOpenSessions(state.root, worktreePath) ?? false)
    )
  }

  /**
   * Removes the registrations of a worktree that is gone, in the project
   * repository and the inner repositories, inner members first, keeping
   * every branch, also when they are locked. Where a member's folder is still
   * there, nothing in it is deleted or changed. Returns why a registration
   * could not be removed, or `null`.
   */
  private async unregister(
    context: GitContext,
    state: ProjectState,
    root: string,
  ): Promise<string | null> {
    const inner: Member[] = []
    for (const repository of state.inner ?? []) {
      const memberPath = path.join(root, repository.relativePath)
      const registered = await this.registeredPaths(context, repository.path)
      if (registered === null) return `Could not list the worktrees of ${repository.relativePath}.`
      if (registered.includes(memberPath)) {
        inner.push({
          repository: repository.path,
          path: memberPath,
          relativePath: repository.relativePath,
          label: repository.relativePath,
        })
      }
    }
    const members = deepestFirst(inner)
    const outer = await this.registeredPaths(context, state.root)
    if (outer === null) return `Could not list the worktrees of ${state.name}.`
    if (outer.includes(root)) {
      members.push({ repository: state.root, path: root, relativePath: '', label: state.name })
    }
    for (const member of members) {
      if (await absent(member.path)) {
        // Nothing is left to delete: forcing twice only overrides a lock.
        const result = await git(context, [
          '-C',
          member.repository,
          'worktree',
          'remove',
          '--force',
          '--force',
          member.path,
        ])
        if (result.code !== 0) return `Could not remove ${member.path}: ${gitErrorMessage(result)}`
        continue
      }
      const problem = await forgetLinkedWorktree(context, member.repository, member.path)
      if (problem !== null) return problem
    }
    return null
  }

  /**
   * Cleans up the project's worktrees that are gone, as they were just read
   * (see the class comment), unless Hoot is deleting or removing them; those
   * with open sessions are held. Returns the roots of those cleaned up.
   */
  private async cleanUp(state: ProjectState, read: ProjectWorktrees): Promise<string[]> {
    const { records, keeping } = this.options
    state.held = new Set()
    // As when the disk it is on is not connected: the worktrees come back with it.
    if (read.unreachable) return []
    const listed = new Set(read.worktrees.map((worktree) => worktree.path))
    const gone = new Set<string>()
    for (const worktree of read.worktrees) {
      // A locked one is only away for now, as Git's lock says, and one whose
      // folder may be there, but cannot be told, is not gone.
      if (worktree.missing && !worktree.locked && (await absent(worktree.path))) {
        gone.add(worktree.path)
      }
    }
    const kept = [
      ...records.forProject(state.root).keys(),
      ...(keeping?.savedSessionPaths(state.root) ?? []),
    ]
    for (const collapsed of keeping?.collapsedPaths() ?? []) {
      // Collapsed state is kept by root alone: one in a project folder is the project's.
      if (
        !listed.has(collapsed) &&
        read.folders.includes(await realPath(path.dirname(collapsed)))
      ) {
        kept.push(collapsed)
      }
    }
    const unlisted = kept.filter((worktreePath) => !listed.has(worktreePath))
    // Also when Git no longer lists them, as when `git gc` pruned their
    // registrations while the disk was not connected: a worktree Hoot keeps
    // something of in such a folder tells it is the project's.
    if (read.dangling.length > 0) {
      for (const worktreePath of unlisted) {
        if (read.dangling.includes(await realPath(path.dirname(worktreePath)))) return []
      }
    }
    for (const worktreePath of unlisted) gone.add(worktreePath)

    const removed: string[] = []
    let context: GitContext | null = null
    for (const worktreePath of gone) {
      if (state.busy.has(worktreePath)) continue
      if (keeping?.hasOpenSessions(state.root, worktreePath)) {
        state.held.add(worktreePath)
        continue
      }
      context ??= await this.options.gitContext()
      // Its inner members, which may not have been looked for yet, right after Hoot starts.
      state.inner ??= await findInnerRepositories(context, state.root)
      const problem = await this.unregister(context, state, worktreePath)
      if (problem !== null) {
        console.error('Could not clean up the worktree', worktreePath, problem)
        continue
      }
      records.remove(worktreePath)
      removed.push(worktreePath)
    }
    return removed
  }

  /**
   * The project's worktrees as Git lists them now: the project repository's
   * linked worktrees directly in the project folder, or in another folder
   * that belongs to the project. Its other linked worktrees, such as those
   * coding agents make elsewhere, are not Hoot's. `null` when Git does not
   * list them, as when the project repository cannot be read for now.
   */
  private async readEntries(
    context: GitContext,
    state: ProjectState,
  ): Promise<ProjectEntries | null> {
    const result = await git(context, ['-C', state.root, 'worktree', 'list', '--porcelain', '-z'])
    if (result.code !== 0) return null
    // Git lists a worktree by the real path it had when it was made, which a
    // symbolic link added on the way since (to move ~/.hoot to another disk,
    // say) no longer is: folders are compared by their real paths now. The
    // folder may be gone, with its worktrees missing.
    const { layout } = this.options
    const { folder } = await layout.projectFolder(state.root, { create: false })
    // Also a folder made while the first led nowhere: the worktrees made in
    // it meanwhile stay the project's once the first leads somewhere again.
    const folders = [
      ...new Set(
        await Promise.all(
          [folder, ...(await layout.projectFolders(state.root))].map((candidate) =>
            realPath(candidate),
          ),
        ),
      ),
    ]
    // A link in a project folder's place that leads nowhere, whose marker
    // cannot be read, is the project's when Git lists the project's worktrees
    // in it: by the link's path those made before the folder moved behind it,
    // by where it leads those made since.
    const dangling = (
      await Promise.all(
        (await layout.danglingFolders()).map(async (link) => [
          await realPath(link.folder),
          await realPath(link.target),
        ]),
      )
    ).flat()
    const entries = parseWorktreeList(result.stdout)
      .slice(1)
      .filter((entry) => !entry.bare)
    const parents = await Promise.all(entries.map((entry) => realPath(path.dirname(entry.path))))
    let unreachable = false
    const own = entries.filter((_entry, index) => {
      const parent = parents[index]!
      if (folders.includes(parent)) return true
      if (!dangling.includes(parent)) return false
      unreachable = true
      return true
    })
    return { entries: own, folders, unreachable, dangling }
  }

  /** The paths of a repository's linked worktrees; `null` when Git does not list them. */
  private async registeredPaths(context: GitContext, repository: string): Promise<string[] | null> {
    const result = await git(context, ['-C', repository, 'worktree', 'list', '--porcelain', '-z'])
    if (result.code !== 0) return null
    return parseWorktreeList(result.stdout)
      .slice(1)
      .map((entry) => entry.path)
  }

  /**
   * Clears the registrations, in the project repository and the inner
   * repositories, of linked worktrees that were inside a deleted root (such
   * as one an agent made there) and are prunable now: deleting the root
   * deleted their folders too.
   */
  private async clearRegistrationsWithin(
    context: GitContext,
    state: ProjectState,
    root: string,
  ): Promise<void> {
    const repositories = [state.root, ...(state.inner ?? []).map((inner) => inner.path)]
    // Made at different times, the root and a worktree inside it may be
    // registered by paths that differ by a symbolic link added since.
    const realRoot = await realPath(root)
    for (const repository of repositories) {
      const result = await git(context, ['-C', repository, 'worktree', 'list', '--porcelain', '-z'])
      if (result.code !== 0) continue
      for (const entry of parseWorktreeList(result.stdout).slice(1)) {
        if (!entry.prunable || !isWithin(await realPath(entry.path), realRoot)) continue
        const removed = await git(context, ['-C', repository, 'worktree', 'remove', entry.path])
        if (removed.code !== 0) {
          console.error('Could not clear the registration of', entry.path, gitErrorMessage(removed))
        }
      }
    }
  }

  /** The members of the worktree at a root: its outer member and its inner members. */
  private async membersOf(
    context: GitContext,
    state: ProjectState,
    root: string,
  ): Promise<{ outer: Member; inner: Member[] }> {
    const inner: Member[] = []
    for (const repository of state.inner ?? []) {
      const memberPath = path.join(root, repository.relativePath)
      if ((await this.registeredPaths(context, repository.path))?.includes(memberPath)) {
        inner.push({
          repository: repository.path,
          path: memberPath,
          relativePath: repository.relativePath,
          label: repository.relativePath,
        })
      }
    }
    return {
      outer: { repository: state.root, path: root, relativePath: '', label: state.name },
      inner,
    }
  }

  /**
   * The members of the worktree at a root, the outer member first, with the
   * branch each has checked out, as Git lists them in their repositories,
   * also an inner member whose folder is gone.
   */
  private async memberBranches(
    context: GitContext,
    state: ProjectState,
    root: string,
    outerBranch: string | null,
  ): Promise<MemberBranch[]> {
    const members: MemberBranch[] = [
      {
        repository: state.root,
        path: root,
        relativePath: '',
        label: state.name,
        branch: outerBranch,
      },
    ]
    for (const repository of state.inner ?? []) {
      const memberPath = path.join(root, repository.relativePath)
      const result = await git(context, [
        '-C',
        repository.path,
        'worktree',
        'list',
        '--porcelain',
        '-z',
      ])
      if (result.code !== 0) continue
      const entry = parseWorktreeList(result.stdout)
        .slice(1)
        .find((candidate) => candidate.path === memberPath)
      if (!entry) continue
      members.push({
        repository: repository.path,
        path: memberPath,
        relativePath: repository.relativePath,
        label: repository.relativePath,
        branch: branchOf(entry),
      })
    }
    return members
  }

  /**
   * The branches of the members of the worktree at a root, each with the
   * branch checked out in the project folder in its repository, and whether
   * it is merged into that one.
   */
  private async branchesOf(
    context: GitContext,
    state: ProjectState,
    root: string,
    outerBranch: string | null,
  ): Promise<WorktreeBranch[]> {
    const members = await this.memberBranches(context, state, root, outerBranch)
    return Promise.all(
      members.map(async (member): Promise<WorktreeBranch> => {
        const current = await checkedOutBranch(context, member.repository)
        const merged =
          member.branch !== null &&
          current !== null &&
          (await isMergedInto(context, member.repository, member.branch, current))
        return {
          repository: member.label,
          relativePath: member.relativePath,
          branch: member.branch,
          current,
          merged,
        }
      }),
    )
  }

  private async inspectEntry(
    context: GitContext,
    state: ProjectState,
    entry: WorktreeEntry,
  ): Promise<WorktreeInspection> {
    const members = await this.membersOf(context, state, entry.path)
    // An inner member whose folder is gone has nothing left to lose or to
    // delete: deleting the worktree only clears its registration.
    const present: Member[] = []
    for (const member of members.inner) if (await isDirectory(member.path)) present.push(member)
    const toCheck: MemberToCheck[] = [members.outer, ...present]
    const { changes, foreignRepositories } = await inspectMembers(context, entry.path, toCheck)
    return {
      root: entry.path,
      innerMembers: present.map((member) => member.path),
      branch: branchOf(entry),
      branches: await this.branchesOf(context, state, entry.path, branchOf(entry)),
      changes,
      foreignRepositories,
    }
  }

  /**
   * Removes what a failed creation made, inner members (deeper ones first)
   * before the outer member, and then the new branches. Returns messages
   * about anything that could not be removed.
   */
  private async undo(
    context: GitContext,
    created: readonly Member[],
    branched: readonly Member[],
    branch: string,
  ): Promise<string[]> {
    const problems: string[] = []
    const inner = created.filter((member) => member.relativePath !== '')
    const outer = created.filter((member) => member.relativePath === '')
    for (const member of [...deepestFirst(inner), ...outer]) {
      const result = await runGit(
        context.git,
        ['-C', member.repository, 'worktree', 'remove', '--force', '--force', member.path],
        context.env,
        { timeout: WORKTREE_COMMAND_TIMEOUT },
      )
      if (result.code !== 0) {
        problems.push(`Could not remove ${member.path}: ${gitErrorMessage(result)}`)
      }
    }
    for (const member of branched) {
      const result = await git(context, ['-C', member.repository, 'branch', '-D', branch])
      if (result.code !== 0) {
        problems.push(
          `Could not delete the branch ${branch} in ${member.label}: ${gitErrorMessage(result)}`,
        )
      }
    }
    return problems
  }

  /**
   * Reads the project's worktrees and reports them if they changed. Called
   * while a read is under way, it reads once more after it, so that what it
   * settles with is as new as the call.
   */
  private refresh(state: ProjectState): Promise<void> {
    if (state.refreshing) {
      state.refreshAgain = true
      return state.refreshing
    }
    state.refreshing = (async () => {
      do {
        state.refreshAgain = false
        const read = await this.readWorktrees(state)
        if (state.removed) return
        if (read === null) {
          // Git did not list them: they stay as they were, and none is cleaned up.
          if (!state.reported) {
            state.reported = true
            this.emit('changed', state.root, state.worktrees)
          }
          continue
        }
        const removed = await this.cleanUp(state, read)
        // What else Hoot keeps of them goes before the worktrees show without them.
        if (removed.length > 0) this.emit('removed', state.root, removed)
        if (state.removed) return
        const worktrees = read.worktrees.filter((worktree) => !removed.includes(worktree.path))
        if (!state.reported || !sameWorktrees(worktrees, state.worktrees)) {
          state.worktrees = worktrees
          state.reported = true
          this.emit('changed', state.root, worktrees)
        }
      } while (state.refreshAgain)
    })()
      .catch((error: unknown) =>
        console.error('Could not list the worktrees of', state.root, error),
      )
      .finally(() => {
        state.refreshing = null
      })
    return state.refreshing
  }

  /** The project's worktrees as they are now; `null` when Git does not list them. */
  private async readWorktrees(state: ProjectState): Promise<ProjectWorktrees | null> {
    const context = await this.options.gitContext()
    const read = await this.readEntries(context, state)
    if (read === null) return null
    const { entries, ...where } = read
    const inner = state.inner ?? []
    const innerRegistrations = await Promise.all(
      inner.map(async (repository) => (await this.registeredPaths(context, repository.path)) ?? []),
    )
    const records = this.options.records.forProject(state.root)
    const worktrees = await Promise.all(
      entries.map(async (entry): Promise<WorktreeInfo> => {
        const missing = !(await isDirectory(entry.path))
        const recorded = records.get(entry.path)
        return {
          path: entry.path,
          branch: entry.branch ? shortBranchName(entry.branch) : null,
          displayName: entry.branch
            ? shortBranchName(entry.branch)
            : await this.shortCommit(context, state, entry, missing),
          name: recorded?.name ?? null,
          createdAt: recorded?.createdAt ?? (missing ? 0 : await folderCreatedAt(entry.path)),
          missing,
          locked: entry.locked,
          lockReason: entry.lockReason,
          innerMembers: inner
            .filter((repository, index) =>
              innerRegistrations[index]!.includes(path.join(entry.path, repository.relativePath)),
            )
            .map((repository) => repository.relativePath),
        }
      }),
    )
    return { ...where, worktrees: worktrees.toSorted(compareWorktrees) }
  }

  /** The abbreviated commit of a detached HEAD, as `git rev-parse --short HEAD` gives it there. */
  private async shortCommit(
    context: GitContext,
    state: ProjectState,
    entry: WorktreeEntry,
    missing: boolean,
  ): Promise<string> {
    const result = missing
      ? await git(context, ['-C', state.root, 'rev-parse', '--short', entry.head ?? 'HEAD'])
      : await git(context, ['-C', entry.path, 'rev-parse', '--short', 'HEAD'])
    return result.code === 0 ? result.stdout.trim() : (entry.head ?? '').slice(0, 7)
  }

  /** Looks for the project's inner repositories, and reads the worktrees again with them. */
  private discover(state: ProjectState): Promise<void> {
    if (state.discovering) return state.discovering
    state.discovering = (async () => {
      await state.ready
      const context = await this.options.gitContext()
      const inner = await findInnerRepositories(context, state.root)
      if (state.removed) return
      state.inner = inner
      await this.refresh(state)
    })()
      .catch((error: unknown) =>
        console.error('Could not look for the inner repositories of', state.root, error),
      )
      .finally(() => {
        state.discovering = null
      })
    return state.discovering
  }
}

/** The branch a worktree entry has checked out, without `refs/heads/`; `null` when detached. */
function branchOf(entry: WorktreeEntry): string | null {
  return entry.branch ? shortBranchName(entry.branch) : null
}

/** Git's output for a member, introduced by its name. */
function describeOutput(label: string, result: GitResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  return `${label}: git exited with code ${result.code}.${output ? `\n${output}` : ''}`
}
