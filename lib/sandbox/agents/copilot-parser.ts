export class CopilotOutputParser {
  private accumulatedContent = ''

  processChunk(chunk: string): string {
    const lines = chunk.split('\n')
    let newContent = ''

    for (const line of lines) {
      if (line.trim()) {
        // Skip diff box lines (containing box drawing characters)
        const isDiffBox = /[╭╰│─═╮╯]/.test(line)

        if (!isDiffBox) {
          // Check if this is a new action line (starts with ● or ✓)
          const isActionLine = /^[●✓]/.test(line.trim())

          // Add blank line before action lines for better readability
          if (isActionLine && this.accumulatedContent.length > 0) {
            this.accumulatedContent += '\n'
            newContent += '\n'
          }

          // Append each line to accumulated content
          this.accumulatedContent += `${line}\n`
          newContent += `${line}\n`
        }
      }
    }
    return newContent
  }

  getAccumulatedContent(): string {
    return this.accumulatedContent
  }

  reset(): void {
    this.accumulatedContent = ''
  }
}
