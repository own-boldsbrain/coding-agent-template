import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('utils', () => {
  describe('cn', () => {
    it('should merge class names correctly', () => {
      expect(cn('c1', 'c2')).toBe('c1 c2')
    })

    it('should handle conditional classes', () => {
      const isTrue = true
      const isFalse = false
      expect(cn('c1', isTrue && 'c2', isFalse && 'c3')).toBe('c1 c2')
    })

    it('should merge tailwind classes', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2')
    })
  })
})
