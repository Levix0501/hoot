import { describe, expect, it } from 'vitest'
import {
  isIssueBranch,
  issueBranchAttempt,
  issueBranchName,
  issueWorktree,
} from './issue-worktrees'
import type { WorktreeInfo } from './worktrees'

const codePoints = (text: string) => Array.from(text).length

/** A worktree of the project gamma on a branch, or detached for `null`. */
function worktree(branch: string | null, changes: Partial<WorktreeInfo> = {}): WorktreeInfo {
  const name = branch ?? 'abc1234'
  return {
    path: `/home/.hoot/worktrees/gamma/${name}`,
    branch,
    displayName: name,
    name: null,
    createdAt: 0,
    missing: false,
    locked: false,
    lockReason: null,
    innerMembers: [],
    ...changes,
  }
}

describe('issueBranchName', () => {
  it("joins the issue's number and its title's words in lower case with dashes", () => {
    expect(issueBranchName(12, 'Fix the login bug on Safari')).toBe(
      'iss-12-fix-the-login-bug-on-safari',
    )
    expect(issueBranchName(3, 'Fix:  the login—bug!')).toBe('iss-3-fix-the-login-bug')
    expect(issueBranchName(7, 'Suffix')).toBe('iss-7-suffix')
  })

  it('keeps the letters and digits of any script', () => {
    expect(issueBranchName(13, '修复登录页的问题')).toBe('iss-13-修复登录页的问题')
    expect(issueBranchName(14, '在 issues 页面的每一项最后增加一个按钮')).toBe(
      'iss-14-在-issues-页面的每一项最后增加一个按钮',
    )
    expect(issueBranchName(5, 'Ünïcode ÄND Ελληνικά ①Ⅻ٣')).toBe('iss-5-ünïcode-änd-ελληνικά-①ⅻ٣')
  })

  it('is the number alone for a title without letters and digits', () => {
    expect(issueBranchName(4, '!!! ???')).toBe('iss-4')
    expect(issueBranchName(4, '🎉 — ✓')).toBe('iss-4')
  })

  it('merges runs of dashes, also those around and in the title', () => {
    expect(issueBranchName(9, '--a -- b--')).toBe('iss-9-a-b')
    expect(issueBranchName(9, 'a\tb\nc\0d')).toBe('iss-9-a-b-c-d')
  })

  it('keeps the first 60 code points, then drops a dash left at the end', () => {
    const fiftyThree = 'x'.repeat(53)
    // `iss-5-`, 53 x and the dash before "tail" are 60 code points.
    expect(issueBranchName(5, `${fiftyThree} tail`)).toBe(`iss-5-${fiftyThree}`)
    expect(codePoints(issueBranchName(5, `${fiftyThree} tail`))).toBe(59)
    expect(issueBranchName(8, 'y'.repeat(60))).toBe(`iss-8-${'y'.repeat(54)}`)
  })

  it('counts a character outside the Basic Multilingual Plane as one code point, and never cuts it', () => {
    const name = issueBranchName(6, '𠀀'.repeat(70))
    expect(name).toBe(`iss-6-${'𠀀'.repeat(54)}`)
    expect(codePoints(name)).toBe(60)
    expect(name.length).toBe(6 + 54 * 2)
    expect(name.isWellFormed()).toBe(true)
  })
})

describe('issueBranchAttempt', () => {
  it('tries the name itself first, then with -2, -3 and on, beyond the 60 code points', () => {
    const name = `iss-8-${'y'.repeat(54)}`
    expect(issueBranchAttempt(name, 1)).toBe(name)
    expect(issueBranchAttempt(name, 2)).toBe(`${name}-2`)
    expect(issueBranchAttempt('iss-7-suffix', 3)).toBe('iss-7-suffix-3')
    expect(codePoints(issueBranchAttempt(name, 2))).toBe(62)
  })
})

describe('isIssueBranch', () => {
  it("takes the issue's number alone, or followed by a dash and anything", () => {
    expect(isIssueBranch('iss-1', 1)).toBe(true)
    expect(isIssueBranch('iss-1-fix', 1)).toBe(true)
    expect(isIssueBranch('iss-1-aaa', 1)).toBe(true)
    expect(isIssueBranch('iss-1-', 1)).toBe(true)
  })

  it('leaves out the branches of other numbers and other names', () => {
    expect(isIssueBranch('iss-10', 1)).toBe(false)
    expect(isIssueBranch('iss-10-fix', 1)).toBe(false)
    expect(isIssueBranch('iss-1x', 1)).toBe(false)
    expect(isIssueBranch('ISS-1', 1)).toBe(false)
    expect(isIssueBranch('feat/iss-1-fix', 1)).toBe(false)
    expect(isIssueBranch('iss-01', 1)).toBe(false)
  })
})

describe('issueWorktree', () => {
  it("is the worktree on one of the issue's branches", () => {
    const own = worktree('iss-1-fix-the-login-bug-on-safari')
    expect(issueWorktree([worktree('main'), own, worktree('iss-10')], 1)).toBe(own)
    expect(issueWorktree([worktree('iss-1')], 1)?.branch).toBe('iss-1')
  })

  it("is none without a worktree on one of the issue's branches", () => {
    expect(issueWorktree([], 1)).toBeNull()
    expect(issueWorktree([worktree('iss-10'), worktree('iss-12-a'), worktree(null)], 1)).toBeNull()
  })

  it('leaves out a worktree whose folder is missing', () => {
    const missing = worktree('iss-1-moving', { missing: true })
    expect(issueWorktree([missing], 1)).toBeNull()
    const second = worktree('iss-1-moving-2')
    expect(issueWorktree([missing, second], 1)).toBe(second)
  })

  it('is the first of several in the order of the sidebar, whatever order they are given in', () => {
    const fix = worktree('iss-1-fix-the-login-bug-on-safari')
    const aaa = worktree('iss-1-aaa')
    expect(issueWorktree([fix, aaa], 1)).toBe(aaa)
    expect(issueWorktree([aaa, fix], 1)).toBe(aaa)
    // Two worktrees of a branch are told apart by their paths, as the sidebar does.
    const other = worktree('iss-1-aaa', { path: '/home/.hoot/worktrees/gamma/iss-1-aaa-2' })
    expect(issueWorktree([other, aaa], 1)).toBe(aaa)
  })
})
