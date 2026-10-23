import { describe, expect, it } from 'vitest'
import {
  hasUntransliterableText,
  randomWorktreeName,
  worktreeBranchAttempt,
  worktreeBranchName,
} from './worktree-names'

describe('worktreeBranchName', () => {
  it('turns names into branch names with slugify', () => {
    const cases: Array<[string, string | null]> = [
      ['Fix login bug', 'fix-login-bug'],
      ['Café déjà vu', 'cafe-deja-vu'],
      ['Größe & Maß', 'groesse-and-mass'],
      ['Привет мир', 'privet-mir'],
      ['MyFeature', 'my-feature'],
      ['iOS 18 fix', 'i-os-18-fix'],
      ['feat/new-idea', 'feat-new-idea'],
      ['修复登录 bug', null],
      ['日本語テスト', null],
      ['한국어 테스트', null],
      ['!!!', null],
      ['', null],
      ['   ', null],
    ]
    for (const [name, branch] of cases) {
      expect([name, worktreeBranchName(name)]).toEqual([name, branch])
    }
  })
})

describe('hasUntransliterableText', () => {
  it('finds letters and digits transliteration leaves as they are', () => {
    expect(hasUntransliterableText('修复登录 bug')).toBe(true)
    expect(hasUntransliterableText('日本語テスト')).toBe(true)
    expect(hasUntransliterableText('한국어 테스트')).toBe(true)
    expect(hasUntransliterableText('Привет мир')).toBe(false)
    expect(hasUntransliterableText('Café déjà vu')).toBe(false)
  })

  it('ignores symbols that are not letters or digits', () => {
    expect(hasUntransliterableText('🚀 launch')).toBe(false)
    expect(hasUntransliterableText('!!!')).toBe(false)
  })
})

describe('randomWorktreeName', () => {
  it('gives three lower-case words joined by dashes', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(randomWorktreeName()).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
    }
  })
})

describe('worktreeBranchAttempt', () => {
  it('adds -2, -3 and on after the first attempt', () => {
    expect([1, 2, 3].map((attempt) => worktreeBranchAttempt('fix-login-bug', attempt))).toEqual([
      'fix-login-bug',
      'fix-login-bug-2',
      'fix-login-bug-3',
    ])
  })
})
