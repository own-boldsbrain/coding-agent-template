import { describe, it, expect, beforeEach } from 'vitest'
import { CursorOutputParser } from './cursor-parser'

describe('CursorOutputParser', () => {
  let parser: CursorOutputParser

  beforeEach(() => {
    parser = new CursorOutputParser()
  })

  it('should extract session_id', () => {
    const input = JSON.stringify({ type: 'result', session_id: 'test-session-id' }) + '\n'
    const result = parser.processChunk(input)
    expect(result.sessionId).toBe('test-session-id')
  })

  it('should format tool calls', () => {
    const input =
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: {
          editToolCall: { args: { path: 'src/main.ts' } },
        },
      }) + '\n'

    const result = parser.processChunk(input)
    expect(result.content).toContain('Editing src/main.ts')
  })

  it('should extract assistant text', () => {
    const input =
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'World' },
          ],
        },
      }) + '\n'

    const result = parser.processChunk(input)
    expect(result.content).toContain('Hello World')
  })

  it('should handle multiple lines', () => {
    const input =
      JSON.stringify({ type: 'result', session_id: 'sid-123' }) +
      '\n' +
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }) +
      '\n'

    const result = parser.processChunk(input)
    expect(result.sessionId).toBe('sid-123')
    expect(result.content).toContain('Hi')
  })

  it('should ignore invalid JSON', () => {
    const result = parser.processChunk('invalid json\n')
    expect(result.content).toBe('')
    expect(result.sessionId).toBeUndefined()
  })
})
