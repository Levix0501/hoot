import { describe, expect, it } from 'vitest'
import { managesAgents } from './managed-agents'

describe('managesAgents', () => {
  it('tells the platforms Hoot manages agents on', () => {
    expect(managesAgents('darwin')).toBe(true)
    expect(managesAgents('win32')).toBe(true)
    expect(managesAgents('linux')).toBe(false)
  })
})
