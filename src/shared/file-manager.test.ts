import { describe, expect, it } from 'vitest'
import { fileManagerName } from './file-manager'

describe('fileManagerName', () => {
  it('is File Explorer on Windows and Finder on macOS', () => {
    expect(fileManagerName('win32')).toBe('File Explorer')
    expect(fileManagerName('darwin')).toBe('Finder')
  })
})
