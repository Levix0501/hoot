import { describe, expect, it } from 'vitest'
import { droppedPathQuotingFor } from './dropped-path-quoting'

describe('droppedPathQuotingFor', () => {
  it('quotes as Windows Terminal on Windows and as a POSIX shell elsewhere', () => {
    expect(droppedPathQuotingFor('win32')).toBe('windows')
    expect(droppedPathQuotingFor('darwin')).toBe('posix')
    expect(droppedPathQuotingFor('linux')).toBe('posix')
  })
})
