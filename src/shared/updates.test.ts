import { describe, expect, it } from 'vitest'
import { firstLine } from './updates'

describe('firstLine', () => {
  it('is what comes before the first line break', () => {
    expect(firstLine('404 Not Found\nHeaders: {"server":"GitHub.com"}\nat fetch')).toBe(
      '404 Not Found',
    )
  })

  it('leaves out the carriage return of a Windows line break', () => {
    expect(firstLine('404 Not Found\r\nHeaders: {}')).toBe('404 Not Found')
  })

  it('is the whole message when it has one line, and nothing for none', () => {
    expect(firstLine('net::ERR_INTERNET_DISCONNECTED')).toBe('net::ERR_INTERNET_DISCONNECTED')
    expect(firstLine('')).toBe('')
  })
})
