import { describe, expect, it } from 'vitest'
import type { Job } from '../api/types'
import { backoffMs, jobRefetchInterval } from './jobPolling'

function queryWith(status: Job['status'] | undefined, dataUpdateCount: number) {
  return {
    state: {
      data: status ? ({ jobId: 'a.b', songId: 'a', status } as Job) : undefined,
      dataUpdateCount,
    },
  }
}

describe('backoffMs', () => {
  it('doubles from 2s and caps at 15s', () => {
    expect(backoffMs(1)).toBe(2000)
    expect(backoffMs(2)).toBe(4000)
    expect(backoffMs(3)).toBe(8000)
    expect(backoffMs(4)).toBe(15000)
    expect(backoffMs(10)).toBe(15000)
  })
})

describe('jobRefetchInterval', () => {
  it('stops on terminal states', () => {
    expect(jobRefetchInterval(queryWith('COMPLETE', 3))).toBe(false)
    expect(jobRefetchInterval(queryWith('FAILED', 3))).toBe(false)
  })

  it('returns backoff for live states and before first data', () => {
    expect(jobRefetchInterval(queryWith('QUEUED', 1))).toBe(2000)
    expect(jobRefetchInterval(queryWith('PROCESSING', 3))).toBe(8000)
    expect(jobRefetchInterval(queryWith(undefined, 0))).toBe(2000)
  })
})
