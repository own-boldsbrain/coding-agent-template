import { describe, it, expect, beforeEach } from 'vitest'
import { CopilotOutputParser } from './copilot-parser'

describe('CopilotOutputParser', () => {
  let parser: CopilotOutputParser

  beforeEach(() => {
    parser = new CopilotOutputParser()
  })

  it('should accumulate normal text lines', () => {
    parser.processChunk('Line 1\n')
    parser.processChunk('Line 2\n')
    expect(parser.getAccumulatedContent()).toBe('Line 1\nLine 2\n')
  })

  it('should filter out diff box characters', () => {
    const input = `
Normal line
╭──────────╮
│ Diff box │
╰──────────╯
Another normal line
`
    parser.processChunk(input)
    expect(parser.getAccumulatedContent()).toContain('Normal line\n')
    expect(parser.getAccumulatedContent()).toContain('Another normal line\n')
    expect(parser.getAccumulatedContent()).not.toContain('Diff box')
    expect(parser.getAccumulatedContent()).not.toContain('╭')
  })

  it('should add newlines before action lines', () => {
    parser.processChunk('First action\n')
    parser.processChunk('● Second action\n')

    const content = parser.getAccumulatedContent()
    expect(content).toBe('First action\n\n● Second action\n')
  })

  it('should handle completed action lines', () => {
    parser.processChunk('Task started\n')
    parser.processChunk('✓ Task completed\n')

    const content = parser.getAccumulatedContent()
    expect(content).toBe('Task started\n\n✓ Task completed\n')
  })

  it('should handle empty chunks', () => {
    parser.processChunk('')
    expect(parser.getAccumulatedContent()).toBe('')
  })

  it('should handle whitespace-only lines', () => {
    parser.processChunk('   \n')
    expect(parser.getAccumulatedContent()).toBe('')
  })
})
