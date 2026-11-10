import { describe, expect, it } from 'vitest'
import {
  compareWorktrees,
  defaultNestedBase,
  initialWorktreeChoices,
  isWithin,
  nestedRepositoryTree,
  repositoriesIn,
  type NestedRepositoryNode,
  type NestedRepositoryOption,
  type NewWorktreeOptions,
  type WorktreeInfo,
} from './worktrees'

describe('defaultNestedBase', () => {
  const repository = { branches: ['develop', 'main'], current: 'main' }

  it("takes the branch named like the project's base branch", () => {
    expect(defaultNestedBase(repository, 'develop')).toBe('develop')
  })

  it('otherwise the checked-out branch, otherwise none', () => {
    expect(defaultNestedBase(repository, 'release')).toBe('main')
    expect(defaultNestedBase(repository, null)).toBe('main')
    expect(defaultNestedBase({ branches: ['trunk'], current: null }, 'main')).toBeNull()
  })
})

describe('initialWorktreeChoices', () => {
  const options: NewWorktreeOptions = {
    branches: ['develop', 'feat/a', 'main'],
    current: 'main',
    nested: [
      {
        relativePath: 'app',
        branches: ['feat/a', 'feat/b', 'main'],
        current: 'main',
        hasCommits: true,
      },
      { relativePath: 'docs', branches: ['develop', 'main'], current: 'develop', hasCommits: true },
      { relativePath: 'empty', branches: [], current: null, hasCommits: false },
    ],
    source: null,
  }

  it("starts from the main worktree's branch, with each inner repository that has commits", () => {
    expect(initialWorktreeChoices(options)).toEqual({
      base: 'main',
      nested: {
        app: { included: true, base: 'main' },
        docs: { included: true, base: 'main' },
        empty: { included: false, base: null },
      },
    })
  })

  it('made from a worktree, starts each of its members from the branch that member has checked out, and leaves out the rest', () => {
    const source = { branch: 'feat/a', innerMembers: [{ relativePath: 'app', branch: 'feat/b' }] }
    expect(initialWorktreeChoices({ ...options, source })).toEqual({
      base: 'feat/a',
      nested: {
        app: { included: true, base: 'feat/b' },
        docs: { included: false, base: 'develop' },
        empty: { included: false, base: null },
      },
    })
  })

  it('leaves the base branch to be picked for a member on a detached HEAD or a branch that is not there', () => {
    const source = { branch: null, innerMembers: [{ relativePath: 'app', branch: 'gone' }] }
    expect(initialWorktreeChoices({ ...options, source })).toEqual({
      base: null,
      nested: {
        app: { included: true, base: null },
        docs: { included: false, base: 'develop' },
        empty: { included: false, base: null },
      },
    })
    expect(
      initialWorktreeChoices({
        ...options,
        source: { branch: 'unborn', innerMembers: [{ relativePath: 'app', branch: null }] },
      }),
    ).toMatchObject({ base: null, nested: { app: { included: true, base: null } } })
  })
})

const made = (path: string, createdAt: number) => ({ path, createdAt }) as WorktreeInfo

describe('compareWorktrees', () => {
  it('orders by creation time, newest first, then by path', () => {
    const sorted = [
      made('/old', 100),
      made('/new-b', 300),
      made('/new-a', 300),
      made('/middle', 200),
    ]
      .toSorted(compareWorktrees)
      .map((worktree) => worktree.path)
    expect(sorted).toEqual(['/new-a', '/new-b', '/middle', '/old'])
  })
})

describe('isWithin', () => {
  it('matches the directory and paths below it only', () => {
    expect(isWithin('/w/G/feat', '/w/G/feat')).toBe(true)
    expect(isWithin('/w/G/feat/inner', '/w/G/feat')).toBe(true)
    expect(isWithin('/w/G/feature', '/w/G/feat')).toBe(false)
    expect(isWithin('/w/G', '/w/G/feat')).toBe(false)
  })

  it('reads the paths of Windows, with \\ between folders', () => {
    expect(isWithin('C:\\w\\G\\feat\\inner', 'C:\\w\\G\\feat')).toBe(true)
    expect(isWithin('C:\\w\\G\\feature', 'C:\\w\\G\\feat')).toBe(false)
    expect(isWithin('C:\\w', 'C:\\')).toBe(true)
  })
})

/** An inner repository with commits, at a path relative to the project root. */
const repository = (relativePath: string): NestedRepositoryOption => ({
  relativePath,
  branches: ['main'],
  current: 'main',
  hasCommits: true,
})

/** Each row of a tree of inner repositories as its label, path and kind, with the rows under it. */
const shape = (nodes: NestedRepositoryNode[]): unknown[] =>
  nodes.map((node) => [
    node.label,
    node.relativePath,
    node.repository === null ? 'folder' : 'repository',
    ...(node.children.length > 0 ? [shape(node.children)] : []),
  ])

describe('nestedRepositoryTree', () => {
  it('puts the repositories that share a folder under a row of that folder', () => {
    const tree = nestedRepositoryTree(
      ['apps/admin', 'apps/web', 'packages/ui', 'packages/utils'].map(repository),
    )
    expect(shape(tree)).toEqual([
      [
        'apps',
        'apps',
        'folder',
        [
          ['admin', 'apps/admin', 'repository'],
          ['web', 'apps/web', 'repository'],
        ],
      ],
      [
        'packages',
        'packages',
        'folder',
        [
          ['ui', 'packages/ui', 'repository'],
          ['utils', 'packages/utils', 'repository'],
        ],
      ],
    ])
  })

  it('gives a folder with only one repository or one folder in it a row together with that', () => {
    const tree = nestedRepositoryTree(
      ['tools/cli', 'services/backend/api', 'services/backend/worker', '.claude/worktrees/mcu'].map(
        repository,
      ),
    )
    expect(shape(tree)).toEqual([
      ['.claude/worktrees/mcu', '.claude/worktrees/mcu', 'repository'],
      [
        'services/backend',
        'services/backend',
        'folder',
        [
          ['api', 'services/backend/api', 'repository'],
          ['worker', 'services/backend/worker', 'repository'],
        ],
      ],
      ['tools/cli', 'tools/cli', 'repository'],
    ])
  })

  it('puts the repositories inside a repository under its row', () => {
    const tree = nestedRepositoryTree(
      ['services', 'services/plugins/a', 'services/plugins/b', 'web'].map(repository),
    )
    expect(shape(tree)).toEqual([
      [
        'services',
        'services',
        'repository',
        [
          [
            'plugins',
            'services/plugins',
            'folder',
            [
              ['a', 'services/plugins/a', 'repository'],
              ['b', 'services/plugins/b', 'repository'],
            ],
          ],
        ],
      ],
      ['web', 'web', 'repository'],
    ])
    expect(repositoriesIn(tree[0]!).map((option) => option.relativePath)).toEqual([
      'services',
      'services/plugins/a',
      'services/plugins/b',
    ])
  })

  it('orders the rows of each folder by name, whatever order the repositories come in', () => {
    // Sorted as whole paths, a-b/x comes before a/x; as rows, a comes before a-b.
    const tree = nestedRepositoryTree(['a-b/x', 'a-b/y', 'a/x', 'a/y', 'B'].map(repository))
    expect(tree.map((node) => node.label)).toEqual(['B', 'a', 'a-b'])
  })

  it('lists one repository on its own row, and none as no rows', () => {
    expect(shape(nestedRepositoryTree([repository('hoot')]))).toEqual([
      ['hoot', 'hoot', 'repository'],
    ])
    expect(nestedRepositoryTree([])).toEqual([])
  })
})
