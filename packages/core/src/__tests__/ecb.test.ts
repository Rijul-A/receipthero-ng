/**
 * ECB Currency Conversion Service Tests
 */
import { describe, test, expect } from 'bun:test'
import { getWeekBoundaries } from '../services/ecb'

describe('ECB Currency Service', () => {
  describe('getWeekBoundaries', () => {
    test('should calculate correct week boundaries for a Monday', () => {
      // 2025-01-27 is a Monday
      const result = getWeekBoundaries('2025-01-27')
      expect(result.weekStart).toBe('2025-01-27')
      expect(result.weekEnd).toBe('2025-02-02')
    })

    test('should calculate correct week boundaries for a Wednesday', () => {
      // 2025-01-29 is a Wednesday
      const result = getWeekBoundaries('2025-01-29')
      expect(result.weekStart).toBe('2025-01-27')
      expect(result.weekEnd).toBe('2025-02-02')
    })

    test('should calculate correct week boundaries for a Sunday', () => {
      // 2025-02-02 is a Sunday
      const result = getWeekBoundaries('2025-02-02')
      expect(result.weekStart).toBe('2025-01-27')
      expect(result.weekEnd).toBe('2025-02-02')
    })

    test('should calculate correct week boundaries for a Saturday', () => {
      // 2025-02-01 is a Saturday
      const result = getWeekBoundaries('2025-02-01')
      expect(result.weekStart).toBe('2025-01-27')
      expect(result.weekEnd).toBe('2025-02-02')
    })

    test('should handle year boundary correctly', () => {
      // 2024-12-31 is a Tuesday
      const result = getWeekBoundaries('2024-12-31')
      expect(result.weekStart).toBe('2024-12-30')
      expect(result.weekEnd).toBe('2025-01-05')
    })

    test('is independent of the host timezone', () => {
      // Regression test: getWeekBoundaries must use UTC getters throughout.
      // Reading a UTC-parsed date-only string back with local-timezone
      // getters shifts the result on negative-UTC-offset hosts - e.g. a
      // Monday could get bucketed a full week early.
      const originalTz = process.env.TZ
      process.env.TZ = 'America/New_York'
      try {
        // 2026-01-05 is a Monday.
        const result = getWeekBoundaries('2026-01-05')
        expect(result.weekStart).toBe('2026-01-05')
        expect(result.weekEnd).toBe('2026-01-11')
      } finally {
        process.env.TZ = originalTz
      }
    })
  })
})
