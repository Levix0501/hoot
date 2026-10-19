import { describe, expect, it } from 'vitest'
import { windowsPtyFor } from './windows-pty'

describe('windowsPtyFor', () => {
  it('is ConPTY on Windows, with the build number of Windows', () => {
    expect(windowsPtyFor('win32', '10.0.26200')).toEqual({ backend: 'conpty', buildNumber: 26200 })
  })

  it('is none on macOS', () => {
    expect(windowsPtyFor('darwin', '26.3.1')).toBeUndefined()
  })
})
