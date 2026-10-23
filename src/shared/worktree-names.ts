import slugify from '@sindresorhus/slugify'
import transliterate from '@sindresorhus/transliterate'
import { humanId } from 'human-id'

/**
 * A name made of an adjective, a noun and a verb, in lower case, separated by
 * `-`, such as `shy-feet-ask`: the name of a worktree, and the branch to start
 * it with, when the user leaves the name blank, or it cannot become a branch.
 */
export function randomWorktreeName(): string {
  return humanId({ separator: '-', capitalize: false })
}

/** A letter or a digit, of any script. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * Whether a name has a letter or a digit that transliteration leaves as it
 * is, such as Chinese, Japanese or Korean text: the letters and digits of
 * `transliterate`'s result are all ASCII otherwise.
 */
export function hasUntransliterableText(name: string): boolean {
  for (const character of transliterate(name)) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x7f && LETTER_OR_DIGIT.test(character)) return true
  }
  return false
}

/**
 * The branch a worktree named so starts with: the name transliterated and
 * slugified, as `fix-login-bug`; `null` when the name is left blank, has
 * text that cannot become ASCII, or becomes nothing, as when it is only
 * symbols, which then starts the branch with a random name instead.
 */
export function worktreeBranchName(name: string): string | null {
  if (name.trim() === '' || hasUntransliterableText(name)) return null
  const branch = slugify(name)
  return branch === '' ? null : branch
}

/**
 * The branch tried at an attempt, counted from 1: the branch itself first,
 * then the branch with `-2`, `-3` and on, while a branch of the name tried
 * before exists in a repository taking part.
 */
export function worktreeBranchAttempt(branch: string, attempt: number): string {
  return attempt === 1 ? branch : `${branch}-${attempt}`
}
