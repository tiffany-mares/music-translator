import type { Job } from '../api/types'

// architecture.md section 5.1: "exponential backoff, 2s -> 15s cap".
// dataUpdateCount is React Query's count of successful fetches.
export function backoffMs(dataUpdateCount: number): number {
  return Math.min(2000 * 2 ** Math.max(0, dataUpdateCount - 1), 15000)
}

export function jobRefetchInterval(query: {
  state: { data?: Job; dataUpdateCount: number }
}): number | false {
  const status = query.state.data?.status
  if (status === 'COMPLETE' || status === 'FAILED') return false
  return backoffMs(query.state.dataUpdateCount)
}
