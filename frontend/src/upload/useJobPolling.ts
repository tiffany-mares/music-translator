import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getJob } from '../api/client'
import type { Job } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useJobSocket } from '../ws/JobSocketContext'
import { jobPollingInterval } from './jobPolling'

export function useJobPolling(jobId: string | null): UseQueryResult<Job, Error> {
  const { getIdToken } = useAuth()
  const { healthy } = useJobSocket() // context default: false -> pure 4.2 polling
  return useQuery({
    queryKey: ['job', jobId],
    enabled: jobId !== null,
    queryFn: async () => getJob(await getIdToken(), jobId!),
    // WS healthy -> 60s safety net (pushes are at-most-once; the socket is the
    // primary path). WS down -> the 4.2 backoff schedule. The mount fetch runs
    // either way, so a frame that raced ahead of mount can't strand us dataless.
    refetchInterval: (query) => jobPollingInterval(healthy, query),
    // A pipeline run outlives the user's attention span; keep the status
    // current while the tab is hidden so it's accurate whenever they return.
    refetchIntervalInBackground: true,
  })
}
