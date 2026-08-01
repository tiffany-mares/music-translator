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

// 6.3: while the WebSocket is healthy it is the PRIMARY status path, but 6.2's
// pushes are at-most-once (Handle returns nil unconditionally; the ESM LATEST
// race dropped a real frame live). A slow safety-net poll bounds the staleness
// of any missed push and keeps polling literally true as "the documented
// fallback" (architecture.md §5.1) rather than dead code behind a flag.
export const SAFETY_NET_MS = 60_000

export function jobPollingInterval(
  healthy: boolean,
  query: { state: { data?: Job; dataUpdateCount: number } },
): number | false {
  if (!healthy) return jobRefetchInterval(query)
  const status = query.state.data?.status
  if (status === 'COMPLETE' || status === 'FAILED') return false
  return SAFETY_NET_MS
}
