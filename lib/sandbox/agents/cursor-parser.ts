export interface CursorParseResult {
  sessionId?: string
  content?: string
}

export class CursorOutputParser {
  processChunk(chunk: string): CursorParseResult {
    const lines = chunk.split('\n')
    let newContent = ''
    let sessionId: string | undefined

    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line)

          // Always extract session_id from result
          if (parsed.type === 'result' && parsed.session_id) {
            sessionId = parsed.session_id
          }

          // Handle different chunk types from Cursor's stream-json format
          if (parsed.type === 'tool_call') {
            const statusMsg = this.formatToolCall(parsed)
            if (statusMsg) {
              newContent += statusMsg
            }
          } else if (parsed.type === 'assistant' && parsed.message?.content) {
            const textContent = this.extractAssistantText(parsed)
            if (textContent) {
              newContent += '\n\n' + textContent
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    return { sessionId, content: newContent }
  }

  private formatToolCall(parsed: any): string {
    if (parsed.subtype === 'started') {
      const toolName = Object.keys(parsed.tool_call || {})[0]
      let statusMsg = ''

      if (toolName === 'editToolCall') {
        const path = parsed.tool_call?.editToolCall?.args?.path || 'file'
        statusMsg = `\n\nEditing ${path}`
      } else if (toolName === 'readToolCall') {
        const path = parsed.tool_call?.readToolCall?.args?.path || 'file'
        statusMsg = `\n\nReading ${path}`
      } else if (toolName === 'runCommandToolCall') {
        statusMsg = `\n\nRunning command`
      } else if (toolName === 'listDirectoryToolCall') {
        statusMsg = `\n\nListing directory`
      } else if (toolName === 'shellToolCall') {
        const command = parsed.tool_call?.shellToolCall?.args?.command || 'command'
        statusMsg = `\n\nRunning: ${command}`
      } else if (toolName === 'grepToolCall') {
        const pattern = parsed.tool_call?.grepToolCall?.args?.pattern || 'pattern'
        statusMsg = `\n\nSearching for: ${pattern}`
      } else if (toolName === 'semSearchToolCall') {
        const query = parsed.tool_call?.semSearchToolCall?.args?.query || 'code'
        statusMsg = `\n\nSearching codebase: ${query}`
      } else if (toolName === 'globToolCall') {
        const pattern = parsed.tool_call?.globToolCall?.args?.glob_pattern || 'files'
        statusMsg = `\n\nFinding files: ${pattern}`
      } else {
        const cleanToolName = toolName.replace(/ToolCall$/, '')
        statusMsg = `\n\nExecuting ${cleanToolName}`
      }

      return statusMsg
    }
    return ''
  }

  private extractAssistantText(parsed: any): string {
    return parsed.message.content
      .filter((item: { type: string; text?: string }) => item.type === 'text')
      .map((item: { text?: string }) => item.text)
      .join('')
  }
}
